import { afterEach, describe, expect, it, vi } from "vitest";
import type { ContainerSample } from "./container-stats";
import {
  appendLiveSample,
  LIVE_METRICS_INTERVAL_MS,
  LIVE_METRICS_WINDOW_MS,
  startVisiblePolling,
} from "./service-metrics-client";

const sample = (ts: number): ContainerSample => ({ ts, cpu: 25, memUsed: 100, memLimit: 200, memPct: 50 });

describe("appendLiveSample", () => {
  it("keeps the last five minutes with a fixed upper bound", () => {
    const now = LIVE_METRICS_WINDOW_MS + 10_000;
    const old = [sample(0), sample(9_999), sample(10_000), sample(20_000)];
    expect(appendLiveSample(old, sample(now), now).map((point) => point.ts)).toEqual([10_000, 20_000, now]);

    const dense = Array.from({ length: 100 }, (_, i) => sample(now - 100 + i));
    const result = appendLiveSample(dense, sample(now), now);
    expect(result).toHaveLength(61);
    expect(result.at(-1)?.ts).toBe(now);
  });

  it("ignores cached, stale and out-of-order samples", () => {
    const current = [sample(400_000), sample(405_000)];
    expect(appendLiveSample(current, sample(405_000), 405_000)).toEqual(current);
    expect(appendLiveSample(current, sample(402_000), 405_000)).toEqual(current);
    expect(appendLiveSample([], sample(0), 405_000)).toEqual([]);
  });

  it("preserves unavailable measurements as gaps instead of zeroes", () => {
    const unavailable = { ts: 10_000, cpu: null, memUsed: null, memLimit: null, memPct: null };
    expect(appendLiveSample([sample(5_000)], unavailable, 10_000)).toEqual([sample(5_000), unavailable]);
  });
});

class PageVisibility extends EventTarget {
  hidden = false;

  change(hidden: boolean) {
    this.hidden = hidden;
    this.dispatchEvent(new Event("visibilitychange"));
  }
}

describe("startVisiblePolling", () => {
  afterEach(() => vi.useRealTimers());

  it("samples immediately and every five seconds while visible", async () => {
    vi.useFakeTimers();
    const visibility = new PageVisibility();
    const load = vi.fn(async () => "running");
    const onValue = vi.fn();
    const stop = startVisiblePolling({ load, onValue, onError: vi.fn(), visibility });
    expect(load).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(LIVE_METRICS_INTERVAL_MS - 1);
    expect(load).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(load).toHaveBeenCalledTimes(2);
    expect(onValue).toHaveBeenLastCalledWith("running");
    stop();
  });

  it("does not overlap requests and retries after errors", async () => {
    vi.useFakeTimers();
    const visibility = new PageVisibility();
    let reject!: (error: Error) => void;
    const load = vi.fn(() => new Promise<string>((_, fail) => { reject = fail; }));
    const onError = vi.fn();
    const stop = startVisiblePolling({ load, onValue: vi.fn(), onError, visibility });
    await vi.advanceTimersByTimeAsync(15_000);
    expect(load).toHaveBeenCalledTimes(1);
    reject(new Error("Docker unavailable"));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledTimes(2);
    stop();
  });

  it("pauses hidden pages, aborts pending reads and ignores their late responses", async () => {
    vi.useFakeTimers();
    const visibility = new PageVisibility();
    const pending: Array<{ signal: AbortSignal; resolve: (value: string) => void }> = [];
    const load = vi.fn((signal: AbortSignal) => new Promise<string>((resolve) => pending.push({ signal, resolve })));
    const onValue = vi.fn();
    const onError = vi.fn();
    const stop = startVisiblePolling({ load, onValue, onError, visibility });
    visibility.change(true);
    expect(pending[0].signal.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(load).toHaveBeenCalledTimes(1);

    visibility.change(false);
    expect(load).toHaveBeenCalledTimes(2);
    pending[0].resolve("stale");
    pending[1].resolve("current");
    await vi.advanceTimersByTimeAsync(0);
    expect(onValue).toHaveBeenCalledExactlyOnceWith("current");
    expect(onError).not.toHaveBeenCalled();
    stop();
  });

  it("waits for visibility before starting and removes all work when inactive or unmounted", async () => {
    vi.useFakeTimers();
    const visibility = new PageVisibility();
    visibility.hidden = true;
    let resolve!: (value: string) => void;
    let signal!: AbortSignal;
    const load = vi.fn((requestSignal: AbortSignal) => {
      signal = requestSignal;
      return new Promise<string>((done) => { resolve = done; });
    });
    const onValue = vi.fn();
    const stop = startVisiblePolling({ load, onValue, onError: vi.fn(), visibility });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(load).not.toHaveBeenCalled();

    visibility.change(false);
    stop();
    expect(signal.aborted).toBe(true);
    resolve("late");
    visibility.change(true);
    visibility.change(false);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(load).toHaveBeenCalledTimes(1);
    expect(onValue).not.toHaveBeenCalled();
  });

  it("supports a single history read each time the page becomes visible", async () => {
    vi.useFakeTimers();
    const visibility = new PageVisibility();
    const load = vi.fn(async () => []);
    const stop = startVisiblePolling({ load, onValue: vi.fn(), onError: vi.fn(), visibility, intervalMs: null });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(load).toHaveBeenCalledTimes(1);
    visibility.change(true);
    visibility.change(false);
    expect(load).toHaveBeenCalledTimes(2);
    stop();
  });
});
