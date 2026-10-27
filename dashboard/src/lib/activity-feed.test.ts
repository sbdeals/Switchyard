import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActivityEntry } from "./activity";
import { watchActivity } from "./activity-feed";

const fetchMock = vi.fn<typeof fetch>();
const stops: Array<() => void> = [];
const entry: ActivityEntry = {
  deploymentId: "deployment-1",
  serviceId: "service-1",
  serviceKind: "compose",
  serviceName: "demo",
  projectId: "project-1",
  projectName: "Demo",
  environmentName: "production",
  status: "done",
  title: "Deploy demo",
  startedAt: "2026-10-26T04:00:00Z",
  finishedAt: "2026-10-26T04:00:15Z",
};

function watch() {
  const onUpdate = vi.fn();
  const onError = vi.fn();
  const stop = watchActivity(onUpdate, onError);
  stops.push(stop);
  return { onUpdate, onError, stop };
}

function response(body: unknown = { entries: [] }, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  stops.splice(0).forEach((stop) => stop());
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("watchActivity", () => {
  it("fetches immediately with browser caching and waits ten seconds before refreshing", async () => {
    fetchMock.mockImplementation(async () => response({ entries: [entry] }));
    const { onUpdate, onError } = watch();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/activity", { signal: expect.any(AbortSignal) });
    await vi.advanceTimersByTimeAsync(0);
    expect(onUpdate).toHaveBeenCalledWith([entry]);
    expect(onError).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(9_999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not overlap slow requests and waits ten seconds after they finish", async () => {
    const pending = deferred<Response>();
    fetchMock.mockReturnValueOnce(pending.promise).mockImplementation(async () => response());
    watch();

    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    pending.resolve(response());
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(9_999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("aborts an in-flight request and suppresses late results after cleanup", async () => {
    const pending = deferred<Response>();
    fetchMock.mockReturnValue(pending.promise);
    const { onUpdate, onError, stop } = watch();
    const signal = fetchMock.mock.calls[0][1]?.signal;

    stop();
    expect(signal?.aborted).toBe(true);
    pending.resolve(response());
    await vi.advanceTimersByTimeAsync(30_000);
    expect(onUpdate).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("suppresses an abort rejection after cleanup", async () => {
    const pending = deferred<Response>();
    fetchMock.mockReturnValue(pending.promise);
    const { onUpdate, onError, stop } = watch();

    stop();
    pending.reject(new DOMException("Aborted", "AbortError"));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(onUpdate).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("clears scheduled refreshes when the panel closes", async () => {
    fetchMock.mockImplementation(async () => response());
    const { stop } = watch();
    await vi.advanceTimersByTimeAsync(0);

    stop();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["server error", () => Promise.resolve(response({ error: "private backend detail" }, 500))],
    ["network error", () => Promise.reject(new Error("private backend detail"))],
    ["invalid response", () => Promise.resolve(response({ error: "private backend detail" }))],
    ["invalid JSON", () => Promise.resolve(new Response("private backend detail"))],
  ])("reports a generic %s and retries", async (_label, fail) => {
    fetchMock.mockImplementationOnce(fail).mockImplementation(async () => response());
    const { onUpdate, onError } = watch();
    await vi.advanceTimersByTimeAsync(0);

    expect(onError).toHaveBeenCalledWith("Could not load activity. Retrying in 10 seconds.");
    expect(onUpdate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(9_999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(onUpdate).toHaveBeenCalledWith([]);
  });

  it.each(["unauthorized", "login redirect"])("identifies an expired session from %s", async (kind) => {
    const result = kind === "unauthorized" ? response({}, 401) : response();
    if (kind === "login redirect") {
      Object.defineProperties(result, {
        redirected: { value: true },
        url: { value: "http://localhost:3050/login" },
      });
    }
    fetchMock.mockResolvedValue(result);
    const { onUpdate, onError } = watch();
    await vi.advanceTimersByTimeAsync(0);

    expect(onError).toHaveBeenCalledWith("Your session has expired. Sign in again to view activity.");
    expect(onUpdate).not.toHaveBeenCalled();
  });
});
