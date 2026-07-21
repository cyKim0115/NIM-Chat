const NVIDIA_URL = "https://integrate.api.nvidia.com/v1/chat/completions";

/**
 * @param {object} opts
 * @param {string} opts.apiKey
 * @param {object} opts.body
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<Response>}
 */
export async function nimChatCompletions({ apiKey, body, signal }) {
  return fetch(NVIDIA_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: body.stream ? "text/event-stream" : "application/json",
    },
    body: JSON.stringify(body),
    signal,
  });
}

/**
 * Non-streaming chat completion → parsed JSON.
 * @param {object} opts
 * @param {string} opts.apiKey
 * @param {object} opts.body
 * @param {AbortSignal} [opts.signal]
 */
export async function nimChatJson({ apiKey, body, signal }) {
  const res = await nimChatCompletions({
    apiKey,
    body: { ...body, stream: false },
    signal,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`NIM invalid JSON (${res.status}): ${text.slice(0, 400)}`);
  }
  if (!res.ok) {
    const msg = json?.error?.message || json?.error || text.slice(0, 400);
    throw new Error(`NIM error (${res.status}): ${msg}`);
  }
  return json;
}

/**
 * Parse OpenAI-style SSE stream; yield content deltas.
 * @param {ReadableStream} body
 * @returns {AsyncGenerator<string>}
 */
export async function* parseNimSseContent(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try {
        const json = JSON.parse(data);
        const delta =
          json.choices?.[0]?.delta?.content ??
          json.choices?.[0]?.message?.content ??
          "";
        if (delta) yield delta;
      } catch {
        // ignore partial JSON
      }
    }
  }
}
