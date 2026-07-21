import { agentConfig } from "../bundled-content.js";

const MAX_RESULT = agentConfig.maxToolResultChars || 8000;

/**
 * @param {string} text
 * @param {number} [max]
 */
export function truncate(text, max = MAX_RESULT) {
  const s = String(text ?? "");
  if (s.length <= max) return s;
  return `${s.slice(0, max)}\n\n…[truncated ${s.length - max} chars]`;
}

/**
 * Strip HTML to readable text (best-effort).
 * @param {string} html
 */
function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * @param {object} ctx
 * @param {string} [ctx.braveApiKey]
 * @param {Record<string, string>} [ctx.env]
 */
export function createBuiltinTools(ctx) {
  const env = ctx.env || {};
  const braveKey = (ctx.braveApiKey || env.BRAVE_API_KEY || "").trim();

  /** @type {Record<string, { definition: object, execute: (args: any) => Promise<string> }>} */
  const tools = {
    web_search: {
      definition: {
        type: "function",
        function: {
          name: "web_search",
          description:
            "Search the web for current information. Returns titles, URLs, and snippets.",
          parameters: {
            type: "object",
            properties: {
              query: {
                type: "string",
                description: "Search query",
              },
              count: {
                type: "integer",
                description: "Number of results (1-10)",
                minimum: 1,
                maximum: 10,
              },
            },
            required: ["query"],
          },
        },
      },
      async execute(args) {
        if (!braveKey) {
          return truncate(
            "web_search unavailable: no Brave API key. Set BRAVE_API_KEY on the Worker or enter a Brave key in app settings."
          );
        }
        const query = String(args?.query || "").trim();
        if (!query) return "Error: query is required";
        const count = Math.min(10, Math.max(1, Number(args?.count) || 5));

        const url = new URL("https://api.search.brave.com/res/v1/web/search");
        url.searchParams.set("q", query);
        url.searchParams.set("count", String(count));

        const res = await fetch(url.toString(), {
          headers: {
            Accept: "application/json",
            "X-Subscription-Token": braveKey,
          },
        });
        const text = await res.text();
        if (!res.ok) {
          return truncate(`Brave search failed (${res.status}): ${text}`);
        }
        let json;
        try {
          json = JSON.parse(text);
        } catch {
          return truncate(`Brave search invalid JSON: ${text}`);
        }
        const results = (json.web?.results || []).map((r, i) => ({
          rank: i + 1,
          title: r.title,
          url: r.url,
          description: r.description,
        }));
        return truncate(JSON.stringify({ query, results }, null, 2));
      },
    },

    fetch_url: {
      definition: {
        type: "function",
        function: {
          name: "fetch_url",
          description:
            "Fetch a URL and return plain text extracted from HTML (size-capped).",
          parameters: {
            type: "object",
            properties: {
              url: {
                type: "string",
                description: "Absolute http(s) URL to fetch",
              },
            },
            required: ["url"],
          },
        },
      },
      async execute(args) {
        const rawUrl = String(args?.url || "").trim();
        let parsed;
        try {
          parsed = new URL(rawUrl);
        } catch {
          return "Error: invalid URL";
        }
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          return "Error: only http/https URLs are allowed";
        }

        const res = await fetch(parsed.toString(), {
          headers: {
            "User-Agent": "NIM-Chat-Agent/1.0",
            Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
          },
          redirect: "follow",
        });
        const contentType = res.headers.get("Content-Type") || "";
        const body = await res.text();
        if (!res.ok) {
          return truncate(`fetch_url failed (${res.status}): ${body.slice(0, 500)}`);
        }

        let text;
        if (contentType.includes("application/json")) {
          text = body;
        } else if (contentType.includes("text/plain")) {
          text = body;
        } else {
          text = htmlToText(body);
        }

        const titleMatch = body.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
        const title = titleMatch ? htmlToText(titleMatch[1]) : "";
        return truncate(
          JSON.stringify(
            {
              url: parsed.toString(),
              status: res.status,
              title,
              text,
            },
            null,
            2
          )
        );
      },
    },
  };

  return tools;
}

/**
 * OpenAI tools array for builtins.
 * @param {ReturnType<typeof createBuiltinTools>} tools
 */
export function builtinToolDefinitions(tools) {
  return Object.values(tools).map((t) => t.definition);
}
