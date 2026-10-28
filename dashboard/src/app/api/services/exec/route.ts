import { runExec } from "@/lib/docker";
import { requireAppAccess } from "@/lib/api-auth";
import { runConsoleCommand } from "@/lib/console-exec";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Run a single command inside a Dokploy-managed service's container and return
 * its captured output: { stdout, stderr, exitCode, truncated }.
 *
 * Non-interactive (one command per request) by design: Next 16 route handlers
 * have no WebSocket upgrade path and the dashboard ships as a standalone
 * `next start` server (no custom Node server to attach a socket to), so a real
 * PTY over WS isn't available without changing the deploy model. The
 * command-runner still delivers the core value — running commands inside the
 * container — and the ConsoleTab renders it as a terminal.
 */
export async function POST(request: Request) {
  let body: { app?: unknown; command?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const app = typeof body.app === "string" ? body.app : "";
  const command = typeof body.command === "string" ? body.command : "";
  if (!app || !command.trim()) {
    return Response.json({ error: "missing app or command" }, { status: 400 });
  }

  const allowed = await requireAppAccess(request, app);
  if (allowed instanceof Response) return allowed;

  try {
    const result = await runConsoleCommand(command, (argv) => runExec(app, argv));
    if (!result) {
      return Response.json({ error: "container is not running" }, { status: 409 });
    }
    return Response.json(result);
  } catch (e) {
    // Preserve other Docker errors in the transcript instead of returning a 500.
    const message = e instanceof Error ? e.message : String(e);
    return Response.json({ stdout: "", stderr: message, exitCode: null, truncated: false });
  }
}
