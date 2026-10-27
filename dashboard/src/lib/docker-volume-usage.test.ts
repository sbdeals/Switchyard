import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DockerModem from "docker-modem";
import http from "node:http";

const { dial } = vi.hoisted(() => ({
  dial: vi.fn<(options: DockerModem.DialOptions, callback?: DockerModem.RequestCallback) => void>(),
}));

vi.mock("server-only", () => ({}));
vi.mock("dockerode", () => ({
  default: class {
    modem = { dial };
  },
}));

describe("listVolumeDiskUsage", () => {
  beforeEach(() => {
    vi.resetModules();
    dial.mockReset();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    vi.stubEnv("DOCKER_OP_TIMEOUT_MS", "12000");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("uses only the read-only volume df endpoint on the existing Docker client", async () => {
    const volumes = [{ Name: "data", UsageData: { Size: 50 * 1024 * 1024 } }];
    dial.mockImplementation((_options, callback) => callback?.(null, { Volumes: volumes }));
    const { listVolumeDiskUsage } = await import("./docker");

    await expect(listVolumeDiskUsage()).resolves.toEqual(volumes);
    expect(dial).toHaveBeenCalledTimes(1);
    expect(dial.mock.calls[0][0]).toEqual({
      path: "/system/df?",
      method: "GET",
      options: { type: "volume" },
      statusCodes: { 200: true, 500: "server error" },
      abortSignal: expect.any(AbortSignal),
    });
    expect(dial.mock.calls[0][0].abortSignal?.aborted).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("serializes the volume filter through docker-modem into the HTTP request", async () => {
    const modem = new DockerModem({ socketPath: "/volume-usage-test.sock" });
    dial.mockImplementation((options, callback) => modem.dial(options, callback));
    const request = vi.spyOn(http, "request").mockImplementation(() => {
      throw new Error("test intercept: no socket connection");
    });
    const { listVolumeDiskUsage } = await import("./docker");

    await expect(listVolumeDiskUsage()).resolves.toBeNull();
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      path: "/system/df?type=volume",
      method: "GET",
      socketPath: "/volume-usage-test.sock",
    }), expect.any(Function));
  });

  it("caches results for 30 seconds and refreshes when the cache expires", async () => {
    const volumes = [{ Name: "data", UsageData: { Size: 100 } }];
    dial.mockImplementationOnce((_options, callback) => callback?.(null, { Volumes: volumes }));
    dial.mockImplementationOnce((_options, callback) => callback?.(null, { Volumes: [] }));
    const { listVolumeDiskUsage } = await import("./docker");

    await expect(listVolumeDiskUsage()).resolves.toEqual(volumes);
    await vi.advanceTimersByTimeAsync(29_999);
    await expect(listVolumeDiskUsage()).resolves.toEqual(volumes);
    expect(dial).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(listVolumeDiskUsage()).resolves.toEqual([]);
    expect(dial).toHaveBeenCalledTimes(2);
  });

  it("shares an in-flight request between concurrent callers", async () => {
    const { listVolumeDiskUsage } = await import("./docker");
    const first = listVolumeDiskUsage();
    const second = listVolumeDiskUsage();
    expect(dial).toHaveBeenCalledTimes(1);

    const volumes = [{ Name: "shared", UsageData: { Size: 42 } }];
    dial.mock.calls[0][1]?.(null, { Volumes: volumes });
    await expect(Promise.all([first, second])).resolves.toEqual([volumes, volumes]);
  });

  it("caches daemon failures as unknown, then retries after 30 seconds", async () => {
    dial.mockImplementationOnce((_options, callback) => callback?.(new Error("socket unavailable"), null));
    dial.mockImplementationOnce((_options, callback) => callback?.(null, { Volumes: [] }));
    const { listVolumeDiskUsage } = await import("./docker");

    await expect(listVolumeDiskUsage()).resolves.toBeNull();
    await expect(listVolumeDiskUsage()).resolves.toBeNull();
    expect(dial).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30_000);
    await expect(listVolumeDiskUsage()).resolves.toEqual([]);
    expect(dial).toHaveBeenCalledTimes(2);
  });

  it.each([null, {}, { Volumes: null }, { Volumes: {} }, { Volumes: [null] }])(
    "treats an invalid df response as unknown: %j",
    async (data) => {
      dial.mockImplementation((_options, callback) => callback?.(null, data));
      const { listVolumeDiskUsage } = await import("./docker");

      await expect(listVolumeDiskUsage()).resolves.toBeNull();
      await expect(listVolumeDiskUsage()).resolves.toBeNull();
      expect(dial).toHaveBeenCalledTimes(1);
    },
  );

  it("aborts a stalled request at the Docker timeout and caches the unknown result", async () => {
    const { listVolumeDiskUsage } = await import("./docker");
    const pending = listVolumeDiskUsage();
    const signal = dial.mock.calls[0][0].abortSignal;

    await vi.advanceTimersByTimeAsync(12_000);
    await expect(pending).resolves.toBeNull();
    expect(signal?.aborted).toBe(true);
    await expect(listVolumeDiskUsage()).resolves.toBeNull();
    expect(dial).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
