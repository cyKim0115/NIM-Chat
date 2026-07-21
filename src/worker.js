import { sseResponse } from "./lib/sse.js";
import { runAgentLoop } from "./agent/loop.js";
import { agentConfig } from "./agent/bundled-content.js";

const NVIDIA_URL = "https://integrate.api.nvidia.com/v1/chat/completions";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Authorization, Content-Type, Accept, X-Brave-Api-Key",
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

async function handleChat(request) {
  if (request.method === "OPTIONS") return corsOk();
  if (request.method !== "POST") return jsonError("Method not allowed", 405);

  const auth = request.headers.get("Authorization");
  if (!auth || !auth.startsWith("Bearer ")) {
    return jsonError("Authorization Bearer token required", 401);
  }

  let body;
  try {
    body = await request.text();
    JSON.parse(body);
  } catch {
    return jsonError("Invalid JSON body");
  }

  let upstream;
  try {
    upstream = await fetch(NVIDIA_URL, {
      method: "POST",
      headers: {
        Authorization: auth,
        "Content-Type": "application/json",
        Accept: request.headers.get("Accept") || "text/event-stream",
      },
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

async function handleAgent(request, env) {
  if (request.method === "OPTIONS") return corsOk();
  if (request.method !== "POST") return jsonError("Method not allowed", 405);

  const auth = request.headers.get("Authorization");
  if (!auth || !auth.startsWith("Bearer ")) {
    return jsonError("Authorization Bearer token required", 401);
  }
  const apiKey = auth.slice("Bearer ".length).trim();
  if (!apiKey) return jsonError("Authorization Bearer token required", 401);

  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonError("Invalid JSON body");
  }

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
          apiKey,
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

    if (pathname === "/api/agent" || pathname === "/api/agent/") {
      return handleAgent(request, env);
    }

    return env.ASSETS.fetch(request);
  },
};
