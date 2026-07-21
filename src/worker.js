const NVIDIA_URL = "https://integrate.api.nvidia.com/v1/chat/completions";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept",
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

async function handleChat(request) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return jsonError("Method not allowed", 405);
  }

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

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);

    if (pathname === "/api/chat" || pathname === "/api/chat/") {
      return handleChat(request);
    }

    return env.ASSETS.fetch(request);
  },
};
