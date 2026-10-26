import { describe, expect, it, vi } from "vitest";
import type { Service } from "./dokploy";
import {
  canConfirmBulkAction,
  requiresStopConfirmation,
  runBulkAction,
  runServiceAction,
  type BulkAction,
  type BulkActionResult,
  type BulkProgress,
} from "./bulk-actions";

function deferred() {
  let resolve!: (value: BulkActionResult) => void;
  const promise = new Promise<BulkActionResult>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("bulk runner", () => {
  it("runs two services at a time and starts the next as soon as a slot opens", async () => {
    const pending = [deferred(), deferred(), deferred(), deferred()];
    const started: number[] = [];
    const snapshots: BulkProgress[][] = [];
    const done = runBulkAction([0, 1, 2, 3], (item) => {
      started.push(item);
      return pending[item].promise;
    }, (progress) => snapshots.push(progress));

    expect(started).toEqual([0, 1]);
    expect(snapshots[0].map((entry) => entry.status)).toEqual(["queued", "queued", "queued", "queued"]);
    pending[1].resolve({ ok: false, error: "Service was deleted" });
    await vi.waitFor(() => expect(started).toEqual([0, 1, 2]));
    pending[2].resolve({ ok: true });
    await vi.waitFor(() => expect(started).toEqual([0, 1, 2, 3]));
    pending[3].resolve({ ok: true });
    pending[0].resolve({ ok: true });

    expect(await done).toEqual([
      { status: "ok", message: "Completed" },
      { status: "failed", message: "Service was deleted" },
      { status: "ok", message: "Completed" },
      { status: "ok", message: "Completed" },
    ]);
    expect(snapshots[0].every((entry) => entry.status === "queued")).toBe(true);
    expect(snapshots[1].map((entry) => entry.status)).toEqual(["running", "queued", "queued", "queued"]);
    expect(snapshots).toHaveLength(9);
  });

  it("isolates synchronous throws, rejected promises, and reported failures", async () => {
    const execute = vi.fn((item: number): Promise<BulkActionResult> => {
      if (item === 0) throw new Error("Synchronous failure");
      if (item === 1) return Promise.reject(new Error("Rejected request"));
      if (item === 2) return Promise.resolve({ ok: false, error: "Not owned" });
      if (item === 3) return Promise.reject("Offline");
      return Promise.resolve({ ok: true });
    });
    const result = await runBulkAction([0, 1, 2, 3, 4], execute, () => {});
    expect(execute).toHaveBeenCalledTimes(5);
    expect(result.map((entry) => entry.message)).toEqual([
      "Synchronous failure", "Rejected request", "Not owned", "Offline", "Completed",
    ]);
    expect(result.map((entry) => entry.status)).toEqual(["failed", "failed", "failed", "failed", "ok"]);
  });

  it("does not let consumers mutate its internal progress", async () => {
    const result = await runBulkAction(["a"], async () => ({ ok: true }), (progress) => {
      progress[0].status = "failed";
      progress.pop();
    });
    expect(result).toEqual([{ status: "ok", message: "Completed" }]);
  });

  it("handles an empty batch without executing anything", async () => {
    const execute = vi.fn(async (): Promise<BulkActionResult> => ({ ok: true }));
    const progress = vi.fn();
    expect(await runBulkAction([], execute, progress)).toEqual([]);
    expect(execute).not.toHaveBeenCalled();
    expect(progress).toHaveBeenCalledExactlyOnceWith([]);
  });
});

describe("service action dispatch", () => {
  const service = (kind: Service["kind"]) => ({ kind, id: "service-id", engine: "postgres" }) as Service;
  const handlers = () => ({
    database: vi.fn(async (): Promise<BulkActionResult> => ({ ok: true })),
    application: vi.fn(async (): Promise<BulkActionResult> => ({ ok: true })),
    compose: vi.fn(async (): Promise<BulkActionResult> => ({ ok: true })),
  });

  it.each(["database", "application", "compose"] as const)("routes each action for %s through its existing handler", async (kind) => {
    for (const action of ["redeploy", "stop", "start"] as const) {
      const calls = handlers();
      expect(await runServiceAction(service(kind), action, calls)).toEqual({ ok: true });
      const lifecycle = action === "redeploy" ? "deploy" : action;
      expect(calls[kind]).toHaveBeenCalledExactlyOnceWith(
        ...(kind === "database" ? ["postgres", "service-id", lifecycle] : ["service-id", lifecycle])
      );
      for (const other of ["database", "application", "compose"] as const) {
        if (other !== kind) expect(calls[other]).not.toHaveBeenCalled();
      }
    }
  });

  it.each(["database", "application", "compose"] as const)("restarts %s by awaiting stop before start", async (kind) => {
    const calls = handlers();
    const stop = deferred();
    calls[kind].mockImplementationOnce(() => stop.promise);
    const done = runServiceAction(service(kind), "restart", calls);
    expect(calls[kind]).toHaveBeenCalledTimes(1);
    stop.resolve({ ok: true });
    expect(await done).toEqual({ ok: true });
    expect(calls[kind].mock.calls.map((args: unknown[]) => args[args.length - 1]))
      .toEqual(["stop", "start"]);
  });

  it("does not start a service when its stop fails", async () => {
    const calls = handlers();
    calls.compose.mockResolvedValueOnce({ ok: false, error: "Cannot stop" });
    expect(await runServiceAction(service("compose"), "restart", calls))
      .toEqual({ ok: false, error: "Cannot stop" });
    expect(calls.compose).toHaveBeenCalledTimes(1);
  });

  it("reports a failed start after a successful stop", async () => {
    const calls = handlers();
    calls.compose.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: false, error: "Cannot start" });
    expect(await runServiceAction(service("compose"), "restart", calls))
      .toEqual({ ok: false, error: "Cannot start" });
  });
});

describe("bulk confirmation", () => {
  it("requires the exact word stop only when stopping more than three services", () => {
    expect(requiresStopConfirmation("stop", 3)).toBe(false);
    expect(requiresStopConfirmation("stop", 4)).toBe(true);
    expect(canConfirmBulkAction("stop", 3, "")).toBe(true);
    for (const text of ["", "Stop", "stop ", " stop", "stopped"]) {
      expect(canConfirmBulkAction("stop", 4, text)).toBe(false);
    }
    expect(canConfirmBulkAction("stop", 4, "stop")).toBe(true);
  });

  it.each(["redeploy", "restart", "start"] satisfies BulkAction[])("does not require a typed confirmation for %s", (action) => {
    expect(requiresStopConfirmation(action, 4)).toBe(false);
    expect(canConfirmBulkAction(action, 4, "")).toBe(true);
  });

  it("never confirms an empty selection", () => {
    for (const action of ["redeploy", "restart", "stop", "start"] as const) {
      expect(canConfirmBulkAction(action, 0, "stop")).toBe(false);
    }
  });
});
