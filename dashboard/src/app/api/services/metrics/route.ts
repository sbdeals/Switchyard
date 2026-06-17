import { followStats } from "@/lib/docker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const sseHeaders = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
};

// Stream container resource samples as SSE: data: {"ts","cpu","memUsed","memLimit","memPct"}.
export async function GET(request: Request) {
  const app = new URL(request.url).searchParams.get("app");
  if (!app) return new Response("missing ?app", { status: 400 });

  const src = await followStats(app);
  const encoder = new TextEncoder();

  if (!src) {
    return new Response(encoder.encode(`event: idle\ndata: {}\n\n`), { headers: sseHeaders });
  }

  let buf = "";
  const stream = new ReadableStream({
    start(controller) {
      const onData = (chunk: Buffer) => {
        buf += chunk.toString("utf8");
        // Docker emits one JSON stats object per line.
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const sample = src.toSample(JSON.parse(line));
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(sample)}\n\n`));
          } catch {
            /* partial / non-JSON chunk, skip */
          }
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
