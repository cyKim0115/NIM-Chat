import { sseResponse } from "./lib/sse.js";
import { resolveChatEndpoint } from "./lib/nim.js";
import { polishReplyText } from "./lib/text-guard.js";
import { runAgentLoop } from "./agent/loop.js";
import { agentConfig } from "./agent/bundled-content.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Authorization, Content-Type, Accept, X-Brave-Api-Key, X-Api-Base",
  "Access-Control-Max-Age": "86400",
};

function jsonError(message, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
    },
  });
}

function corsOk() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

/**
 * Bearer 키와 커스텀 Base URL을 읽습니다.
 * @param {Request} request
 * @param {{ baseUrl?: string }} [extra]
 */
function readLlmAuth(request, extra = {}) {
  const baseUrl =
    request.headers.get("X-Api-Base") ||
    (extra.baseUrl ? String(extra.baseUrl) : "") ||
    "";
  const auth = request.headers.get("Authorization") || "";
  const apiKey = auth.startsWith("Bearer ")
    ? auth.slice("Bearer ".length).trim()
    : "";
  const hasCustomBase = Boolean(String(baseUrl).trim());
  if (!apiKey && !hasCustomBase) {
    return { error: "Authorization Bearer token required" };
  }
  return { apiKey: apiKey || "local", baseUrl: String(baseUrl).trim() };
}

async function handleChat(request) {
  if (request.method === "OPTIONS") return corsOk();
  if (request.method !== "POST") return jsonError("Method not allowed", 405);

  const authInfo = readLlmAuth(request);
  if (authInfo.error) return jsonError(authInfo.error, 401);

  let body;
  try {
    body = await request.text();
    JSON.parse(body);
  } catch {
    return jsonError("Invalid JSON body");
  }

  const endpoint = resolveChatEndpoint(authInfo.baseUrl);

  /** @type {Record<string, string>} */
  const upstreamHeaders = {
    "Content-Type": "application/json",
    Accept: request.headers.get("Accept") || "text/event-stream",
  };
  if (authInfo.apiKey && authInfo.apiKey !== "local") {
    upstreamHeaders.Authorization = `Bearer ${authInfo.apiKey}`;
  }

  let upstream;
  try {
    upstream = await fetch(endpoint, {
      method: "POST",
      headers: upstreamHeaders,
      body,
    });
  } catch (err) {
    return jsonError(`Upstream fetch failed: ${err.message}`, 502);
  }

  const headers = new Headers(corsHeaders);
  const contentType = upstream.headers.get("Content-Type");
  if (contentType) headers.set("Content-Type", contentType);
  headers.set("Cache-Control", "no-store");

  return new Response(upstream.body, {
    status: upstream.status,
    headers,
  });
}

async function handlePolish(request) {
  if (request.method === "OPTIONS") return corsOk();
  if (request.method !== "POST") return jsonError("Method not allowed", 405);

  const authInfo = readLlmAuth(request);
  if (authInfo.error) return jsonError(authInfo.error, 401);

  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonError("Invalid JSON body");
  }

  const text = payload.text != null ? String(payload.text) : "";
  if (!text.trim()) return jsonError("text required");

  const model =
    (payload.model && String(payload.model)) ||
    agentConfig.defaultAgentModel ||
    "meta/llama-3.1-70b-instruct";

  const endpoint = resolveChatEndpoint(authInfo.baseUrl);

  try {
    const result = await polishReplyText({
      text,
      apiKey: authInfo.apiKey,
      model,
      endpoint,
      signal: request.signal,
    });
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders,
      },
    });
  } catch (err) {
    return jsonError(err?.message || String(err), 502);
  }
}

async function handleAgent(request, env) {
  if (request.method === "OPTIONS") return corsOk();
  if (request.method !== "POST") return jsonError("Method not allowed", 405);

  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonError("Invalid JSON body");
  }

  const authInfo = readLlmAuth(request, {
    baseUrl: payload.baseUrl ? String(payload.baseUrl) : "",
  });
  if (authInfo.error) return jsonError(authInfo.error, 401);

  const messages = Array.isArray(payload.messages) ? payload.messages : null;
  if (!messages || messages.length === 0) {
    return jsonError("messages array required");
  }

  const model =
    (payload.model && String(payload.model)) ||
    agentConfig.defaultAgentModel ||
    "meta/llama-3.1-70b-instruct";

  const braveApiKey =
    (payload.braveApiKey && String(payload.braveApiKey)) ||
    request.headers.get("X-Brave-Api-Key") ||
    "";

  const customInstructions = payload.customInstructions
    ? String(payload.customInstructions)
    : "";

  return sseResponse(
    async (emit, close) => {
      const abort = new AbortController();
      request.signal?.addEventListener("abort", () => abort.abort(), {
        once: true,
      });

      try {
        await runAgentLoop({
          apiKey: authInfo.apiKey,
          baseUrl: authInfo.baseUrl,
          model,
          messages,
          braveApiKey,
          customInstructions,
          env,
          emit,
          signal: abort.signal,
        });
      } catch (err) {
        if (err?.name === "AbortError") {
          emit("status", { message: "Aborted" });
        } else {
          emit("error", { message: err?.message || String(err) });
        }
      } finally {
        emit("done", {});
        close();
      }
    },
    corsHeaders
  );
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);

    if (pathname === "/api/chat" || pathname === "/api/chat/") {
      return handleChat(request);
    }

    if (pathname === "/api/polish" || pathname === "/api/polish/") {
      return handlePolish(request);
    }

    if (pathname === "/api/agent" || pathname === "/api/agent/") {
      return handleAgent(request, env);
    }

    return env.ASSETS.fetch(request);
  },
};
