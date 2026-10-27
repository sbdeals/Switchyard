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

const MAX_PENDING_CHARS = 64 * 1024;

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
 * Oversized partial lines are emitted in bounded fragments; `continuation`
 * indicates that an earlier fragment of the same line has already been emitted.
 */
export function sseFromLines(
  src: SseSource,
  request: Request,
  toEvent: (line: string, continuation: boolean) => string | null,
  initialEvent = ""
): Response {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let buf = "";
  let continuation = false;
  let closed = false;
  let cancel = () => {};
  const stream = new ReadableStream({
    start(controller) {
      if (initialEvent) controller.enqueue(encoder.encode(initialEvent));
      const emitLine = (line: string, forced = false) => {
        if (!line || (!forced && !continuation && !line.trim())) return;
        const event = toEvent(line, continuation);
        if (event !== null) controller.enqueue(encoder.encode(event));
      };
      const onData = (chunk: Buffer) => {
        if (closed) return;
        buf += decoder.decode(chunk, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          emitLine(line);
          continuation = false;
        }
        while (buf.length > MAX_PENDING_CHARS) {
          let end = MAX_PENDING_CHARS;
          // Keep a surrogate pair together when splitting a decoded string.
          const last = buf.charCodeAt(end - 1);
          if (last >= 0xd800 && last <= 0xdbff) end--;
          emitLine(buf.slice(0, end), true);
          continuation = true;
          buf = buf.slice(end);
        }
      };
      const cleanup = () => {
        src.stream.removeListener("data", onData);
        src.stream.removeListener("end", close);
        src.stream.removeListener("close", close);
        request.signal.removeEventListener("abort", close);
      };
      const close = () => {
        if (closed) return;
        closed = true;
        cleanup();
        emitLine(buf + decoder.decode());
        buf = "";
        src.close();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      cancel = () => {
        if (closed) return;
        closed = true;
        cleanup();
        buf = "";
        src.close();
      };
      src.stream.on("data", onData);
      src.stream.on("end", close);
      src.stream.on("close", close);
      src.stream.on("error", close);
      request.signal.addEventListener("abort", close);
      if (request.signal.aborted) close();
    },
    cancel() {
      cancel();
    },
  });
  return new Response(stream, { headers: SSE_HEADERS });
}
