import { revalidatePath } from "next/cache";
import { verifySessionForRequest } from "@/lib/dokploy";
import { authorizationFailure } from "@/lib/api-auth";
import { duplicateError, duplicateOptions, executeEnvironmentDuplicate } from "@/lib/environment-duplicate-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  // Unlike Server Actions, Route Handlers need their own same-origin guard.
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  let sameOrigin = false;
  try { sameOrigin = !!origin && new URL(origin).host === host; } catch { /* Invalid origin. */ }
  if (!sameOrigin) {
    return Response.json({ error: "The request must come from this dashboard.", code: "forbidden" }, { status: 403 });
  }
  let options;
  let fingerprint: string;
  try {
    const body = await request.json();
    options = duplicateOptions(body.options);
    if (typeof body.fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(body.fingerprint)) {
      return Response.json({ error: "Review a preflight before duplicating." }, { status: 400 });
    }
    fingerprint = body.fingerprint;
  } catch (error) {
    return Response.json({ error: duplicateError(error) }, { status: 400 });
  }
  // Authenticate and authorize before opening a stream or starting mutations.
  try {
    const { tree } = await verifySessionForRequest(request);
    const project = tree.find((p) => p.projectId === options.projectId);
    if (!project?.environments.some((e) => e.environmentId === options.sourceEnvironmentId)) {
      return Response.json({ error: "Unknown project or environment.", code: "forbidden" }, { status: 403 });
    }
  } catch (error) {
    return authorizationFailure(error);
  }
  const encoder = new TextEncoder();
  let connected = true;
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: unknown) => {
        if (connected) controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      try {
        await executeEnvironmentDuplicate(options, fingerprint, emit);
      } catch (error) {
        emit({ type: "error", error: duplicateError(error) });
      } finally {
        revalidatePath("/");
        if (connected) controller.close();
      }
    },
    // Complete the operation even if the tab closes; never roll back services.
    cancel() { connected = false; },
  });
  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store", "X-Accel-Buffering": "no" },
  });
}
