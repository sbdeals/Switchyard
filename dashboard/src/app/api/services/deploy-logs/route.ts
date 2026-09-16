import { unstable_rethrow } from "next/navigation";

import {
  deploymentLogTarget,
  openDeploymentLogSocket,
  type DeployableKind,
  type DeploymentLogTarget,
} from "@/lib/dokploy";
import { SSE_HEADERS, sseOnce } from "@/lib/sse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** How often the deploy's status is re-read while its log streams. */
const STATUS_POLL_MS = 2_000;
/** After the deploy settles, keep reading this long so the log tail lands. */
const SETTLE_FLUSH_MS = 1_200;
/** Giving up on the log socket if it hasn't opened by now. */
const OPEN_TIMEOUT_MS = 10_000;
/** A running deploy silent this long gets a "may be stuck" notice. */
const STALL_MS = 120_000;
/** Reconnects to the log socket while the deploy is still running. */
const MAX_REOPENS = 3;
/** Consecutive status-lookup failures before the stream gives up. */
const MAX_POLL_FAILURES = 5;

const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;

const event = (name: string, data: unknown) =>
  `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;

/**
 * Stream one deployment's build/deploy log as Server-Sent Events.
 *
 *   data: {"text"}                         one log line
 *   event: status  {"status","errorMessage"} deploy status changed
 *   event: notice  {"message"}              honest side-channel (stalled, no log…)
 *   event: end     {"status","errorMessage"} the deploy settled; stream closes
 *
 * The log socket is a `tail -f` that never ends, so the deploy's status is
 * polled alongside it and the stream closes once the deploy is no longer
 * running. Clients must close their EventSource on `end` (a reconnect would
 * replay the whole log).
 */
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const kind = q.get("kind");
  const serviceId = q.get("id");
  const deploymentId = q.get("deployment");
  if ((kind !== "application" && kind !== "compose") || !serviceId || !deploymentId) {
    return new Response("expected ?kind=application|compose&id=&deployment=", { status: 400 });
  }
  const lookup = () => deploymentLogTarget(kind as DeployableKind, serviceId, deploymentId);

  let target: DeploymentLogTarget | null;
  try {
    target = await lookup();
  } catch (e) {
    unstable_rethrow(e);
    return sseOnce(
      event("notice", { message: "Couldn't load this deploy right now — try again shortly." }) +
        event("end", { status: "unknown", errorMessage: null })
    );
  }
  if (!target) return new Response("unknown deployment", { status: 404 });
  if (!target.logPath) {
    return sseOnce(
      event("notice", { message: "No build log was recorded for this deploy." }) +
        event("end", { status: target.status, errorMessage: target.errorMessage })
    );
  }
  const { logPath, serverId } = target;

  const encoder = new TextEncoder();
  let closed = false;
  let ws: WebSocket | null = null;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const later = (fn: () => void, ms: number) => {
    const t = setTimeout(() => {
      timers.delete(t);
      fn();
    }, ms);
    timers.add(t);
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let status = target.status;
      let errorMessage = target.errorMessage;
      let buf = "";
      let opened = false;
      let reopens = 0;
      let lastOutput = Date.now();
      let stallNoticed = false;
      let finishing = false;
      let failures = 0;

      const send = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };
      const emitLines = (flushAll: boolean) => {
        const parts = buf.split("\n");
        buf = flushAll ? "" : (parts.pop() ?? "");
        for (const raw of parts) {
          const text = raw.replace(ANSI, "").replace(/\r/g, "").trimEnd();
          if (text) send(`data: ${JSON.stringify({ text })}\n\n`);
        }
      };
      const shutdown = () => {
        if (closed) return;
        emitLines(true);
        send(event("end", { status, errorMessage }));
        cleanup();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      const cleanup = () => {
        closed = true;
        for (const t of timers) clearTimeout(t);
        timers.clear();
        try {
          ws?.close();
        } catch {
          /* ignore */
        }
      };
      // The deploy settled. Once the socket is open, give the tail a moment to
      // land, then end; if it isn't open yet, onopen (or its timeout) does it.
      const finish = () => {
        if (finishing) return;
        finishing = true;
        if (opened) later(shutdown, SETTLE_FLUSH_MS);
      };

      const connect = async () => {
        let socket: WebSocket;
        try {
          socket = await openDeploymentLogSocket(logPath, serverId);
        } catch (e) {
          send(
            event("notice", {
              message: `Live build log unavailable: ${e instanceof Error ? e.message : String(e)}`,
            })
          );
          shutdown();
          return;
        }
        if (closed) {
          socket.close();
          return;
        }
        ws = socket;
        later(() => {
          if (!opened && ws === socket && !closed) {
            send(event("notice", { message: "Couldn't attach to the build log (timed out)." }));
            shutdown();
          }
        }, OPEN_TIMEOUT_MS);
        socket.onopen = () => {
          opened = true;
          if (finishing) later(shutdown, SETTLE_FLUSH_MS);
        };
        socket.onmessage = (m) => {
          lastOutput = Date.now();
          stallNoticed = false;
          buf += typeof m.data === "string" ? m.data : String(m.data);
          emitLines(false);
        };
        socket.onerror = () => {
          /* onclose follows and decides */
        };
        socket.onclose = (e) => {
          if (closed || ws !== socket) return;
          emitLines(true);
          if (status === "running" && !finishing && reopens < MAX_REOPENS) {
            // The log file may not exist yet right after the deploy is queued.
            reopens++;
            later(() => void connect(), STATUS_POLL_MS);
            return;
          }
          if (!opened || e.code === 4000) {
            send(
              event("notice", {
                message: "The build log for this deploy isn't available (it may have been cleaned up).",
              })
            );
          }
          shutdown();
        };
      };

      const poll = async () => {
        if (closed || finishing) return;
        try {
          const next = await lookup();
          if (next && (next.status !== status || next.errorMessage !== errorMessage)) {
            status = next.status;
            errorMessage = next.errorMessage;
            send(event("status", { status, errorMessage }));
          }
          failures = 0;
        } catch {
          // Transient API failure: keep streaming and retry — but don't spin
          // forever if the session expired or the API went away.
          if (++failures >= MAX_POLL_FAILURES) {
            send(event("notice", { message: "Lost track of this deploy's status — refresh to retry." }));
            shutdown();
            return;
          }
        }
        if (status !== "running") {
          finish();
          return;
        }
        if (!stallNoticed && Date.now() - lastOutput > STALL_MS) {
          stallNoticed = true;
          send(
            event("notice", {
              message: `No build output for ${Math.round(STALL_MS / 60_000)} minutes — this deploy may be stuck.`,
            })
          );
        }
        later(() => void poll(), STATUS_POLL_MS);
      };

      request.signal.addEventListener("abort", cleanup);
      send(event("status", { status, errorMessage }));
      void connect();
      later(() => void poll(), status === "running" ? STATUS_POLL_MS : 0);
    },
    cancel() {
      closed = true;
      for (const t of timers) clearTimeout(t);
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
    },
  });
  return new Response(stream, { headers: SSE_HEADERS });
}
