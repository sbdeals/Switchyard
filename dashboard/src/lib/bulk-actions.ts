import type { Action, Engine, Service } from "./dokploy";
import { redactErrorMessage } from "./error-redaction";

export type BulkAction = "redeploy" | "restart" | "stop" | "start";
export type BulkProgress = {
  status: "queued" | "running" | "ok" | "failed";
  message: string;
};
export type BulkActionResult = { ok: true } | { ok: false; error: string };

export const BULK_ACTION_LABELS: Record<BulkAction, string> = {
  redeploy: "Redeploy",
  restart: "Restart",
  stop: "Stop",
  start: "Start",
};

export function requiresStopConfirmation(action: BulkAction, count: number): boolean {
  return action === "stop" && count > 3;
}

export function canConfirmBulkAction(action: BulkAction, count: number, text: string): boolean {
  return count > 0 && (!requiresStopConfirmation(action, count) || text === "stop");
}

type LifecycleHandlers = {
  database: (engine: Engine, id: string, action: Action) => Promise<BulkActionResult>;
  application: (id: string, action: Action) => Promise<BulkActionResult>;
  compose: (id: string, action: Action) => Promise<BulkActionResult>;
};

/** Dispatch through the same ownership-checked server actions as each service. */
export async function runServiceAction(
  service: Service,
  action: BulkAction,
  handlers: LifecycleHandlers
): Promise<BulkActionResult> {
  const run = (lifecycle: Action) => {
    if (service.kind === "database") return handlers.database(service.engine, service.id, lifecycle);
    if (service.kind === "compose") return handlers.compose(service.id, lifecycle);
    return handlers.application(service.id, lifecycle);
  };
  if (action === "restart") {
    const stopped = await run("stop");
    if (!stopped.ok) return stopped;
    return run("start");
  }
  return run(action === "redeploy" ? "deploy" : action);
}

/** Two services run at a time; each result and snapshot retains input order. */
export async function runBulkAction<T>(
  items: readonly T[],
  execute: (item: T) => Promise<BulkActionResult>,
  onProgress: (progress: BulkProgress[]) => void
): Promise<BulkProgress[]> {
  const progress: BulkProgress[] = items.map(() => ({ status: "queued", message: "Waiting" }));
  const snapshot = () => progress.map((entry) => ({ ...entry }));
  const publish = () => onProgress(snapshot());
  let nextIndex = 0;
  publish();

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      progress[index] = { status: "running", message: "Running" };
      publish();
      try {
        const result = await execute(items[index]);
        progress[index] = result.ok
          ? { status: "ok", message: "Completed" }
          : { status: "failed", message: redactErrorMessage(result.error, "Service action failed") };
      } catch (error) {
        progress[index] = {
          status: "failed",
          message: redactErrorMessage(error, "Service action failed"),
        };
      }
      publish();
    }
  }

  await Promise.all(Array.from({ length: Math.min(2, items.length) }, () => worker()));
  return snapshot();
}
