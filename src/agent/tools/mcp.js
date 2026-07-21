import mcpConfig from "../../../config/mcp.json";
import { agentConfig } from "../bundled-content.js";
import { truncate } from "./builtin.js";

/**
 * Lightweight Streamable HTTP MCP client (JSON-RPC over POST).
 * Avoids Node-only SDK transports so the Worker bundle stays Workers-safe.
 */
class McpHttpClient {
  /**
   * @param {string} url
   * @param {Record<string, string>} [headers]
   */
  constructor(url, headers = {}) {
    this.url = url;
    this.headers = headers;
    this.sessionId = null;
    this.requestId = 0;
    this.serverInfo = null;
  }

  async connect() {
    const init = await this.#rpc("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "nim-chat", version: "1.0.0" },
    });
    this.serverInfo = init?.result?.serverInfo || null;
    await this.#notify("notifications/initialized", {});
    return init;
  }

  async listTools() {
    const res = await this.#rpc("tools/list", {});
    return res?.result?.tools || [];
  }

  /**
   * @param {string} name
   * @param {object} args
   */
  async callTool(name, args) {
    const res = await this.#rpc("tools/call", {
      name,
      arguments: args || {},
    });
    if (res?.error) {
      return {
        isError: true,
        content: [{ type: "text", text: JSON.stringify(res.error) }],
      };
    }
    return res?.result || { content: [] };
  }

  async close() {
    this.sessionId = null;
  }

  async #notify(method, params) {
    await this.#post({ jsonrpc: "2.0", method, params });
  }

  async #rpc(method, params) {
    const id = ++this.requestId;
    const payload = { jsonrpc: "2.0", id, method, params };
    const raw = await this.#post(payload);
    if (!raw) {
      throw new Error(`MCP empty response for ${method}`);
    }
    let msg;
    try {
      msg = typeof raw === "string" ? JSON.parse(raw) : raw;
    } catch {
      // SSE-style response: take last data JSON
      msg = parseSseJson(String(raw));
    }
    if (!msg) throw new Error(`MCP unparseable response for ${method}`);
    if (msg.error) {
      throw new Error(`MCP ${method}: ${msg.error.message || JSON.stringify(msg.error)}`);
    }
    return msg;
  }

  /**
   * @param {object} payload
   */
  async #post(payload) {
    /** @type {Record<string, string>} */
    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...this.headers,
    };
    if (this.sessionId) {
      headers["Mcp-Session-Id"] = this.sessionId;
    }

    const res = await fetch(this.url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });

    const sid = res.headers.get("Mcp-Session-Id");
    if (sid) this.sessionId = sid;

    const text = await res.text();
    if (!res.ok) {
      throw new Error(`MCP HTTP ${res.status}: ${text.slice(0, 400)}`);
    }
    return text;
  }
}

/**
 * @param {string} text
 */
function parseSseJson(text) {
  const lines = text.split(/\r?\n/);
  let last = null;
  for (const line of lines) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    try {
      last = JSON.parse(data);
    } catch {
      // keep scanning
    }
  }
  if (last) return last;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Format MCP tool result content to string.
 * @param {any} result
 */
export function formatMcpResult(result) {
  if (!result) return "";
  if (typeof result === "string") return truncate(result);
  const parts = Array.isArray(result.content) ? result.content : [];
  const texts = parts.map((p) => {
    if (!p) return "";
    if (p.type === "text") return p.text || "";
    return JSON.stringify(p);
  });
  const joined = texts.filter(Boolean).join("\n");
  if (result.isError) {
    return truncate(`MCP tool error:\n${joined || JSON.stringify(result)}`);
  }
  return truncate(joined || JSON.stringify(result));
}

/**
 * Connect configured remote MCP servers and collect tools.
 * @param {Record<string, any>} env
 */
export async function loadMcpTools(env = {}) {
  const servers = mcpConfig?.mcpServers || {};
  const names = Object.keys(servers).slice(0, agentConfig.maxMcpServers || 3);

  /** @type {Map<string, { client: McpHttpClient, serverName: string, toolName: string }>} */
  const executors = new Map();
  /** @type {object[]} */
  const definitions = [];
  /** @type {McpHttpClient[]} */
  const clients = [];
  /** @type {string[]} */
  const errors = [];

  for (const serverName of names) {
    const cfg = servers[serverName];
    if (!cfg?.url) continue;
    if (cfg.transport && cfg.transport !== "streamable-http") {
      errors.push(`${serverName}: unsupported transport ${cfg.transport}`);
      continue;
    }

    /** @type {Record<string, string>} */
    const headers = {};
    if (cfg.authEnv && env[cfg.authEnv]) {
      headers.Authorization = `Bearer ${env[cfg.authEnv]}`;
    }
    if (cfg.headers && typeof cfg.headers === "object") {
      Object.assign(headers, cfg.headers);
    }

    const client = new McpHttpClient(cfg.url, headers);
    try {
      await client.connect();
      const tools = await client.listTools();
      clients.push(client);
      for (const tool of tools) {
        const namespaced = `mcp__${serverName}__${tool.name}`;
        definitions.push({
          type: "function",
          function: {
            name: namespaced,
            description: `[MCP:${serverName}] ${tool.description || tool.name}`,
            parameters: tool.inputSchema || { type: "object", properties: {} },
          },
        });
        executors.set(namespaced, {
          client,
          serverName,
          toolName: tool.name,
        });
      }
    } catch (err) {
      errors.push(`${serverName}: ${err?.message || String(err)}`);
      try {
        await client.close();
      } catch {
        // ignore
      }
    }
  }

  return {
    definitions,
    executors,
    clients,
    errors,
    async closeAll() {
      await Promise.all(
        clients.map(async (c) => {
          try {
            await c.close();
          } catch {
            // ignore
          }
        })
      );
    },
  };
}
