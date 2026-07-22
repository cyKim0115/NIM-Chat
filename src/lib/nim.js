export const DEFAULT_CHAT_ENDPOINT =
  "https://integrate.api.nvidia.com/v1/chat/completions";

/**
 * 사용자가 지정한 Base URL(엔드포인트)을 OpenAI 호환 `chat/completions` URL로 정규화합니다.
 * 빈 값이면 NVIDIA NIM 기본값을 씁니다.
 * - `.../chat/completions` → 그대로
 * - `.../v1` (또는 `/v2` 등) → `/chat/completions` 추가
 * - 그 외 → `/v1/chat/completions` 추가
 * @param {string} [baseUrl]
 * @returns {string}
 */
export function resolveChatEndpoint(baseUrl) {
  const raw = String(baseUrl || "").trim();
  if (!raw) return DEFAULT_CHAT_ENDPOINT;
  const url = raw.replace(/\/+$/, "");
  if (/\/chat\/completions$/.test(url)) return url;
  if (/\/v\d+$/.test(url)) return `${url}/chat/completions`;
  return `${url}/v1/chat/completions`;
}

function explainFetchFailure(err, endpoint) {
  const msg = err?.message || String(err);
  const ep = String(endpoint || "");
  if (/127\.0\.0\.1|localhost/i.test(ep)) {
    return (
      `${msg} — 로컬 LLM(${ep})에 연결하지 못했습니다. ` +
      `서버(Ollama/LM Studio 등)가 켜져 있는지 확인하세요. ` +
      `Cloudflare에 배포된 앱에서는 127.0.0.1에 닿지 않으니 ` +
      `npm run dev로 로컬 실행하거나 터널/LAN URL을 사용하세요.`
    );
  }
  return msg;
}

/**
 * @param {object} opts
 * @param {string} opts.apiKey
 * @param {object} opts.body
 * @param {AbortSignal} [opts.signal]
 * @param {string} [opts.endpoint] OpenAI 호환 chat/completions URL (기본: NVIDIA NIM)
 * @returns {Promise<Response>}
 */
export async function nimChatCompletions({ apiKey, body, signal, endpoint }) {
  /** @type {Record<string, string>} */
  const headers = {
    "Content-Type": "application/json",
    Accept: body.stream ? "text/event-stream" : "application/json",
  };
  const key = String(apiKey || "").trim();
  if (key && key !== "local") {
    headers.Authorization = `Bearer ${key}`;
  }
  const url = endpoint || DEFAULT_CHAT_ENDPOINT;
  try {
    return await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    throw new Error(explainFetchFailure(err, url));
  }
}

/**
 * Non-streaming chat completion → parsed JSON.
 * @param {object} opts
 * @param {string} opts.apiKey
 * @param {object} opts.body
 * @param {AbortSignal} [opts.signal]
 * @param {string} [opts.endpoint]
 */
export async function nimChatJson({ apiKey, body, signal, endpoint }) {
  const res = await nimChatCompletions({
    apiKey,
    body: { ...body, stream: false },
    signal,
    endpoint,
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
