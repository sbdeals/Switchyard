import { followLogs } from "@/lib/docker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const sseHeaders = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
};

// Stream a container's logs as Server-Sent Events: data: {"ts","text"}.
export async function GET(request: Request) {
  const app = new URL(request.url).searchParams.get("app");
  if (!app) return new Response("missing ?app", { status: 400 });

  const src = await followLogs(app, 300);
  const encoder = new TextEncoder();

  if (!src) {
    const body = `data: ${JSON.stringify({ ts: Date.now(), text: "— container is not running —" })}\n\n`;
    return new Response(encoder.encode(body), { headers: sseHeaders });
  }

  let buf = "";
  const stream = new ReadableStream({
    start(controller) {
      const send = (ts: number, text: string) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ ts, text })}\n\n`));

      const onData = (chunk: Buffer) => {
        buf += chunk.toString("utf8");
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          // Lines are prefixed with an RFC3339 docker timestamp.
          const m = line.match(/^(\S+)\s([\s\S]*)$/);
          const parsed = m ? Date.parse(m[1]) : NaN;
          send(Number.isNaN(parsed) ? Date.now() : parsed, m ? m[2] : line);
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

  return new Response(stream, { headers: sseHeaders });
}
