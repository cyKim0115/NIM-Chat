import { agentConfig } from "./bundled-content.js";
import {
  buildSystemPrompt,
  buildPlannerPrompt,
  buildExecutorPlanMessage,
  latestUserText,
  parsePlannerOutput,
  formatPlanForDisplay,
} from "./prompts.js";
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

function assertNotAborted(signal) {
  if (signal?.aborted) {
    const err = new Error("Aborted");
    err.name = "AbortError";
    throw err;
  }
}

/**
 * Phase 1: plan only (no tools, no user-facing answer).
 */
async function runPlannerPhase({
  apiKey,
  model,
  historyMessages,
  userText,
  customInstructions,
  toolCatalog,
  emit,
  signal,
}) {
  emit("phase", { phase: "plan", message: "1/2 계획 수립 중…" });
  emit("status", { message: "1/2 계획 수립 중…", phase: "plan" });

  const plannerSystem = buildPlannerPrompt({
    userText,
    customInstructions,
    toolCatalog,
  });

  const plannerMessages = [
    { role: "system", content: plannerSystem },
    ...historyMessages.filter((m) => m.role !== "system"),
    {
      role: "user",
      content:
        "위 사용자 질문에 대해 답변하지 말고, 지정된 JSON 계획만 출력하세요.",
    },
  ];

  const json = await nimChatJson({
    apiKey,
    signal,
    body: {
      model,
      messages: plannerMessages,
      temperature: 0.3,
      top_p: 0.9,
      max_tokens: Math.min(1024, agentConfig.max_tokens ?? 2048),
      stream: false,
    },
  });

  const raw = json.choices?.[0]?.message?.content || "";
  const { plan, raw: planRaw } = parsePlannerOutput(raw);
  const display = formatPlanForDisplay(plan, planRaw);

  emit("plan", {
    plan: plan || { raw: planRaw },
    display,
    raw: planRaw,
  });
  emit("status", { message: "1/2 계획 완료", phase: "plan" });

  return { plan, planRaw, display };
}

/**
 * Phase 2: execute tools + final answer following the plan.
 */
async function runExecutorPhase({
  apiKey,
  model,
  historyMessages,
  userText,
  customInstructions,
  planDisplay,
  registry,
  emit,
  signal,
}) {
  const maxSteps = agentConfig.maxSteps || 8;
  const system = buildSystemPrompt({ userText, customInstructions });
  const tools = registry.definitions;

  /** @type {Array<object>} */
  const conversation = [
    { role: "system", content: system },
    ...historyMessages.filter((m) => m.role !== "system"),
    buildExecutorPlanMessage(planDisplay),
  ];

  emit("phase", { phase: "execute", message: "2/2 계획 실행 중…" });
  emit("status", {
    message: `2/2 실행 · ${tools.length} tools · max ${maxSteps} steps`,
    phase: "execute",
  });

  let finalText = "";

  for (let step = 1; step <= maxSteps; step++) {
    assertNotAborted(signal);

    emit("status", {
      message: `2/2 실행 중 (step ${step}/${maxSteps})…`,
      step,
      phase: "execute",
    });

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

        emit("tool_start", { id, name, args, step, phase: "execute" });
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
          phase: "execute",
        });

        conversation.push({
          role: "tool",
          tool_call_id: id,
          content: String(result),
        });
      }
      continue;
    }

    const content = message.content || "";
    if (content) {
      emit("text", { delta: content, phase: "execute" });
      finalText = content;
      conversation.push({ role: "assistant", content });
    } else {
      emit("status", { message: "2/2 답변 작성 중…", phase: "execute" });
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
        emit("text", { delta, phase: "execute" });
      }
      finalText = full;
      conversation.push({ role: "assistant", content: full });
    }

    emit("status", { message: "완료", phase: "execute" });
    return { finalText, steps: step };
  }

  emit("status", { message: "도구 단계 상한 도달 — 최종 답변 요청", phase: "execute" });
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
            "도구 사용 횟수 상한에 도달했습니다. 지금까지 모은 정보로 최선의 최종 답변만 작성하세요. 도구를 호출하지 마세요.",
        },
      ],
      temperature: agentConfig.temperature ?? 0.7,
      top_p: agentConfig.top_p ?? 0.9,
      max_tokens: agentConfig.max_tokens ?? 2048,
      stream: false,
    },
  });
  const wrapText = wrap.choices?.[0]?.message?.content || "";
  if (wrapText) emit("text", { delta: wrapText, phase: "execute" });
  return { finalText: wrapText, steps: maxSteps };
}

/**
 * Two-phase agent: (1) plan without answering, (2) execute + answer.
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
  const toolModels = agentConfig.toolModels || [];
  if (toolModels.length && !toolModels.includes(model)) {
    throw new Error(
      `Model "${model}" is not enabled for agent tool use. Choose one of: ${toolModels.join(", ")}`
    );
  }

  const userText = latestUserText(messages);
  const historyMessages = messages.filter((m) => m.role !== "system");

  const registry = await createToolRegistry({ braveApiKey, env });
  try {
    if (registry.mcpErrors?.length) {
      emit("status", {
        message: `MCP warnings: ${registry.mcpErrors.join("; ")}`,
      });
    }

    const toolCatalog = registry.definitions.map((d) => ({
      name: d.function?.name || d.name,
      description: d.function?.description || "",
    }));

    assertNotAborted(signal);
    const { display: planDisplay } = await runPlannerPhase({
      apiKey,
      model,
      historyMessages,
      userText,
      customInstructions,
      toolCatalog,
      emit,
      signal,
    });

    assertNotAborted(signal);
    return await runExecutorPhase({
      apiKey,
      model,
      historyMessages,
      userText,
      customInstructions,
      planDisplay,
      registry,
      emit,
      signal,
    });
  } finally {
    await registry.close();
  }
}
