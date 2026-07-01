/**
 * Server-Sent-Events plumbing shared by the logs and metrics routes: response
 * headers, line-buffering of the source stream, and teardown on client abort.
 */
import "server-only";

export const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
};

/** A one-shot SSE response (e.g. a placeholder when there is no container). */
export function sseOnce(body: string): Response {
  return new Response(new TextEncoder().encode(body), { headers: SSE_HEADERS });
}

export interface SseSource {
  stream: NodeJS.ReadableStream;
  close: () => void;
}

/**
 * Stream a line-oriented source as SSE. `toEvent` maps each complete line to a
 * full SSE chunk (e.g. `data: {...}\n\n`), or null to skip the line.
 */
export function sseFromLines(
  src: SseSource,
  request: Request,
  toEvent: (line: string) => string | null
): Response {
  const encoder = new TextEncoder();
  let buf = "";
  const stream = new ReadableStream({
    start(controller) {
      const onData = (chunk: Buffer) => {
        buf += chunk.toString("utf8");
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = toEvent(line);
          if (event !== null) controller.enqueue(encoder.encode(event));
        }
      };
      const close = () => {
        src.close();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      src.stream.on("data", onData);
      src.stream.on("end", close);
      src.stream.on("error", close);
      request.signal.addEventListener("abort", close);
    },
    cancel() {
      src.close();
    },
  });
  return new Response(stream, { headers: SSE_HEADERS });
}
