import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startLogPolling } from "./log-polling";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function setup(live = true) {
  const requests: (ReturnType<typeof deferred<string>> & { signal: AbortSignal })[] = [];
  const load = vi.fn((signal: AbortSignal) => {
    const request = { ...deferred<string>(), signal };
    requests.push(request);
    return request.promise;
  });
  const onData = vi.fn();
  const onError = vi.fn();
  const poller = startLogPolling({ load, onData, onError, live });
  return { poller, requests, load, onData, onError };
}

describe("startLogPolling", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("loads a snapshot immediately when paused and refreshes once on demand", async () => {
    const { poller, requests, load, onData } = setup(false);
    expect(load).toHaveBeenCalledTimes(1);
    requests[0].resolve("initial");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(onData).toHaveBeenCalledWith("initial");
    expect(load).toHaveBeenCalledTimes(1);

    poller.refresh();
    requests[1].resolve("refreshed");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(onData).toHaveBeenLastCalledWith("refreshed");
    expect(load).toHaveBeenCalledTimes(2);
    poller.close();
  });

  it("waits three seconds after settlement and never overlaps a slow request", async () => {
    const { poller, requests, load } = setup();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(load).toHaveBeenCalledTimes(1);
    requests[0].resolve("first");
    await vi.advanceTimersByTimeAsync(2999);
    expect(load).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(load).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(load).toHaveBeenCalledTimes(2);
    poller.close();
  });

  it("pauses scheduled polling and resumes immediately", async () => {
    const { poller, requests, load, onData } = setup();
    requests[0].resolve("snapshot");
    await vi.advanceTimersByTimeAsync(0);
    poller.setLive(false);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(load).toHaveBeenCalledTimes(1);
    expect(onData).toHaveBeenCalledTimes(1);
    poller.setLive(true);
    expect(load).toHaveBeenCalledTimes(2);
    poller.close();
  });

  it("aborts on pause, ignores stale results, and waits before resuming", async () => {
    const { poller, requests, load, onData } = setup();
    poller.setLive(false);
    expect(requests[0].signal.aborted).toBe(true);
    poller.setLive(true);
    poller.refresh();
    poller.refresh();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(load).toHaveBeenCalledTimes(1);
    requests[0].resolve("stale");
    await vi.advanceTimersByTimeAsync(0);
    expect(onData).not.toHaveBeenCalled();
    expect(load).toHaveBeenCalledTimes(2);
    requests[1].resolve("fresh");
    await vi.advanceTimersByTimeAsync(0);
    expect(onData).toHaveBeenCalledExactlyOnceWith("fresh");
    poller.close();
  });

  it("allows a paused refresh after an aborted request settles", async () => {
    const { poller, requests, load, onData, onError } = setup();
    poller.setLive(false);
    poller.refresh();
    requests[0].reject(new Error("aborted"));
    await vi.advanceTimersByTimeAsync(0);
    expect(onError).not.toHaveBeenCalled();
    expect(load).toHaveBeenCalledTimes(2);
    requests[1].resolve("manual snapshot");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(onData).toHaveBeenCalledExactlyOnceWith("manual snapshot");
    expect(load).toHaveBeenCalledTimes(2);
    poller.close();
  });

  it("reports failures and retries while live", async () => {
    const { poller, requests, load, onError } = setup();
    const error = new Error("offline");
    requests[0].reject(error);
    await vi.advanceTimersByTimeAsync(3000);
    expect(onError).toHaveBeenCalledExactlyOnceWith(error);
    expect(load).toHaveBeenCalledTimes(2);
    poller.close();
  });

  it.each(["resolve", "reject"] as const)("suppresses late %s after cleanup", async (settle) => {
    const { poller, requests, load, onData, onError } = setup();
    poller.refresh();
    poller.close();
    expect(requests[0].signal.aborted).toBe(true);
    poller.refresh();
    poller.setLive(false);
    poller.setLive(true);
    requests[0][settle]("late");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(load).toHaveBeenCalledTimes(1);
    expect(onData).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it("clears scheduled retries on cleanup", async () => {
    const { poller, requests, load } = setup();
    requests[0].resolve("snapshot");
    await vi.advanceTimersByTimeAsync(0);
    poller.close();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(load).toHaveBeenCalledTimes(1);
  });
});
