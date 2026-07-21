import { createBuiltinTools, builtinToolDefinitions } from "./builtin.js";
import { loadMcpTools, formatMcpResult } from "./mcp.js";

/**
 * Merge builtin + MCP tools into one registry.
 * @param {object} opts
 * @param {string} [opts.braveApiKey]
 * @param {Record<string, any>} [opts.env]
 */
export async function createToolRegistry({ braveApiKey, env } = {}) {
  const builtins = createBuiltinTools({ braveApiKey, env });
  const mcp = await loadMcpTools(env || {});

  /** @type {object[]} */
  const definitions = [
    ...builtinToolDefinitions(builtins),
    ...mcp.definitions,
  ];

  /**
   * @param {string} name
   * @param {any} args
   */
  async function execute(name, args) {
    if (builtins[name]) {
      return builtins[name].execute(args || {});
    }
    const mcpTool = mcp.executors.get(name);
    if (mcpTool) {
      const result = await mcpTool.client.callTool(mcpTool.toolName, args || {});
      return formatMcpResult(result);
    }
    return `Unknown tool: ${name}`;
  }

  return {
    definitions,
    execute,
    mcpErrors: mcp.errors,
    close: () => mcp.closeAll(),
  };
}
