import { agentConfig } from "./bundled-content.js";
import { buildSystemPrompt, latestUserText } from "./prompts.js";
import { createToolRegistry } from "./tools/registry.js";
import { nimChatJson, nimChatCompletions, parseNimSseContent } from "../lib/nim.js";

/**
 * @param {string} raw
 */
function safeJsonParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/**
 * Normalize tool_calls from a NIM/OpenAI message.
 * @param {any} message
 */
function getToolCalls(message) {
  if (!message) return [];
  if (Array.isArray(message.tool_calls) && message.tool_calls.length) {
    return message.tool_calls;
  }
  return [];
}

/**
 * Run the agent tool loop, emitting SSE-style events via `emit`.
 * @param {object} opts
 * @param {string} opts.apiKey
 * @param {string} opts.model
 * @param {Array<object>} opts.messages
 * @param {string} [opts.braveApiKey]
 * @param {string} [opts.customInstructions]
 * @param {Record<string, any>} [opts.env]
 * @param {(event: string, data: object) => void} opts.emit
 * @param {AbortSignal} [opts.signal]
 */
export async function runAgentLoop({
  apiKey,
  model,
  messages,
  braveApiKey,
  customInstructions,
  env,
  emit,
  signal,
}) {
  const maxSteps = agentConfig.maxSteps || 8;
  const toolModels = agentConfig.toolModels || [];
  if (toolModels.length && !toolModels.includes(model)) {
    throw new Error(
      `Model "${model}" is not enabled for agent tool use. Choose one of: ${toolModels.join(", ")}`
    );
  }

  const userText = latestUserText(messages);
  const system = buildSystemPrompt({ userText, customInstructions });

  /** @type {Array<object>} */
  const conversation = [
    { role: "system", content: system },
    ...messages.filter((m) => m.role !== "system"),
  ];

  const registry = await createToolRegistry({ braveApiKey, env });
  try {
    if (registry.mcpErrors?.length) {
      emit("status", {
        message: `MCP warnings: ${registry.mcpErrors.join("; ")}`,
      });
    }

    const tools = registry.definitions;
    emit("status", {
      message: `Agent ready · ${tools.length} tools · max ${maxSteps} steps`,
    });

    let finalText = "";

    for (let step = 1; step <= maxSteps; step++) {
      if (signal?.aborted) {
        const err = new Error("Aborted");
        err.name = "AbortError";
        throw err;
      }

      emit("status", { message: `Thinking (step ${step}/${maxSteps})…`, step });

      const json = await nimChatJson({
        apiKey,
        signal,
        body: {
          model,
          messages: conversation,
          tools,
          tool_choice: "auto",
          temperature: agentConfig.temperature ?? 0.7,
          top_p: agentConfig.top_p ?? 0.9,
          max_tokens: agentConfig.max_tokens ?? 2048,
          stream: false,
        },
      });

      const message = json.choices?.[0]?.message;
      if (!message) {
        throw new Error("NIM returned no message");
      }

      const toolCalls = getToolCalls(message);
      if (toolCalls.length > 0) {
        conversation.push({
          role: "assistant",
          content: message.content || null,
          tool_calls: toolCalls,
        });

        for (const call of toolCalls) {
          const name = call.function?.name || call.name || "unknown";
          const argStr = call.function?.arguments ?? call.arguments ?? "{}";
          const args = typeof argStr === "string" ? safeJsonParse(argStr) : argStr || {};
          const id = call.id || `call_${step}_${name}`;

          emit("tool_start", { id, name, args, step });
          let result;
          try {
            result = await registry.execute(name, args);
          } catch (err) {
            result = `Tool error: ${err?.message || String(err)}`;
          }
          emit("tool_result", {
            id,
            name,
            result: String(result).slice(0, 4000),
            step,
          });

          conversation.push({
            role: "tool",
            tool_call_id: id,
            content: String(result),
          });
        }
        continue;
      }

      // No tool calls — stream a final answer for better UX
      const content = message.content || "";
      if (content) {
        // Already have full content from non-stream turn; emit as text chunks
        emit("text", { delta: content });
        finalText = content;
        conversation.push({ role: "assistant", content });
      } else {
        // Fallback streaming pass without tools for token UX
        emit("status", { message: "Writing reply…", step });
        const streamRes = await nimChatCompletions({
          apiKey,
          signal,
          body: {
            model,
            messages: conversation,
            temperature: agentConfig.temperature ?? 0.7,
            top_p: agentConfig.top_p ?? 0.9,
            max_tokens: agentConfig.max_tokens ?? 2048,
            stream: true,
          },
        });
        if (!streamRes.ok) {
          const errText = await streamRes.text();
          throw new Error(`NIM stream failed (${streamRes.status}): ${errText.slice(0, 400)}`);
        }
        let full = "";
        for await (const delta of parseNimSseContent(streamRes.body)) {
          full += delta;
          emit("text", { delta });
        }
        finalText = full;
        conversation.push({ role: "assistant", content: full });
      }

      emit("status", { message: "Done", step });
      return { finalText, steps: step };
    }

    emit("status", { message: "Reached max tool steps" });
    const wrap = await nimChatJson({
      apiKey,
      signal,
      body: {
        model,
        messages: [
          ...conversation,
          {
            role: "user",
            content:
              "You have reached the maximum number of tool steps. Provide the best final answer you can with the information gathered so far. Do not call tools.",
          },
        ],
        temperature: agentConfig.temperature ?? 0.7,
        top_p: agentConfig.top_p ?? 0.9,
        max_tokens: agentConfig.max_tokens ?? 2048,
        stream: false,
      },
    });
    const wrapText = wrap.choices?.[0]?.message?.content || "";
    if (wrapText) emit("text", { delta: wrapText });
    return { finalText: wrapText, steps: maxSteps };
  } finally {
    await registry.close();
  }
}
