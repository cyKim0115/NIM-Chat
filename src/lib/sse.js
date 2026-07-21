/**
 * Create an SSE Response that streams agent events.
 * @param {(emit: (event: string, data: object) => void, close: () => void) => Promise<void>} run
 * @param {HeadersInit} [extraHeaders]
 */
export function sseResponse(run, extraHeaders = {}) {
  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event, data) => {
        if (closed) return;
        const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        controller.enqueue(encoder.encode(payload));
      };

      const close = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      try {
        await run(emit, close);
      } catch (err) {
        emit("error", { message: err?.message || String(err) });
      } finally {
        if (!closed) {
          emit("done", {});
          close();
        }
      }
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-cache",
      Connection: "keep-alive",
      ...extraHeaders,
    },
  });
}
