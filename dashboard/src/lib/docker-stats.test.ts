import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  stats: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("dockerode", () => ({
  default: class {
    listContainers = mocks.list;
    getContainer(id: string) {
      return { stats: (options: unknown) => mocks.stats(id, options) };
    }
  },
}));

const rawStats = {
  cpu_stats: { cpu_usage: { total_usage: 200 }, system_cpu_usage: 1_000, online_cpus: 2 },
  precpu_stats: { cpu_usage: { total_usage: 100 }, system_cpu_usage: 600 },
  memory_stats: { usage: 512, limit: 1_024, stats: { inactive_file: 128 } },
};

function container(id: string, appName: string, state = "running") {
  return { Id: id, Names: [`/${id}`], State: state, Labels: { "com.docker.compose.project": appName } };
}

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.useFakeTimers();
  mocks.list.mockResolvedValue([container("one", "app")]);
  mocks.stats.mockResolvedValue(rawStats);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("readServiceStats", () => {
  it("uses non-streaming reads and sums every running container in an exact compose project", async () => {
    mocks.list.mockResolvedValue([
      container("one", "app"),
      container("two", "app"),
      container("stopped", "app", "exited"),
      container("foreign", "app-other"),
      { ...container("spoof", "other"), Names: ["/app"] },
    ]);
    const { readServiceStats } = await import("./docker");
    const result = await readServiceStats("app", new Set(["app"]));
    expect(result).toMatchObject({
      status: "running",
      containers: 2,
      sample: { cpu: 100, memUsed: 768, memLimit: 2_048, memPct: 37.5 },
    });
    expect(mocks.list).toHaveBeenCalledWith({ all: false, abortSignal: expect.any(AbortSignal) });
    expect(mocks.stats.mock.calls.map(([id]) => id)).toEqual(["one", "two"]);
    for (const [, options] of mocks.stats.mock.calls) {
      expect(options).toEqual({ stream: false, abortSignal: expect.any(AbortSignal) });
    }
  });

  it("matches exact swarm service labels and legacy names without prefix collisions", async () => {
    mocks.list.mockResolvedValue([
      { Id: "swarm", Names: ["/custom"], State: "running", Labels: { "com.docker.swarm.service.name": "app" } },
      { Id: "task", Names: ["/app.1.abcdef"], State: "running", Labels: {} },
      { Id: "exact", Names: ["/app"], State: "running", Labels: {} },
      { Id: "prefix", Names: ["/app-other.1.abcdef"], State: "running", Labels: {} },
      { Id: "suffix", Names: ["/app.1.abcdef.extra"], State: "running", Labels: {} },
    ]);
    const { readServiceStats } = await import("./docker");
    expect((await readServiceStats("app", new Set(["app"]))).containers).toBe(3);
    expect(mocks.stats.mock.calls.map(([id]) => id)).toEqual(["swarm", "task", "exact"]);
  });

  it("does not let an unauthorized caller read Docker or a cached authorized sample", async () => {
    const { readServiceStats } = await import("./docker");
    const denied = { status: "unavailable", sample: null, containers: 0 };
    expect(await readServiceStats("app", new Set())).toEqual(denied);
    expect(mocks.list).not.toHaveBeenCalled();
    await readServiceStats("app", new Set(["app"]));
    expect(await readServiceStats("app", new Set(["other"]))).toEqual(denied);
    expect(mocks.list).toHaveBeenCalledTimes(1);
    expect(mocks.stats).toHaveBeenCalledTimes(1);
  });

  it("deduplicates in-flight reads and refreshes the cache after 4.5 seconds", async () => {
    let finish!: (stats: typeof rawStats) => void;
    mocks.stats.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const { readServiceStats } = await import("./docker");
    const allowed = new Set(["app"]);
    const first = readServiceStats("app", allowed);
    const concurrent = readServiceStats("app", allowed);
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.list).toHaveBeenCalledTimes(1);
    expect(mocks.stats).toHaveBeenCalledTimes(1);
    finish(rawStats);
    expect(await concurrent).toEqual(await first);
    await vi.advanceTimersByTimeAsync(4_499);
    await readServiceStats("app", allowed);
    expect(mocks.stats).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await readServiceStats("app", allowed);
    expect(mocks.stats).toHaveBeenCalledTimes(2);
  });

  it("refreshes a five-second poll arriving 250ms early after a slow Docker sample", async () => {
    mocks.stats.mockImplementation(() => new Promise((resolve) => {
      setTimeout(() => resolve(rawStats), 1_000);
    }));
    const { readServiceStats } = await import("./docker");
    const allowed = new Set(["app"]);
    const first = readServiceStats("app", allowed);
    await vi.advanceTimersByTimeAsync(1_000);
    const firstResult = await first;
    await vi.advanceTimersByTimeAsync(3_750);
    const second = readServiceStats("app", allowed);
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.stats).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1_000);
    expect((await second).sample!.ts - firstResult.sample!.ts).toBe(4_750);
  });

  it("caps concurrent Docker stats reads globally across different services", async () => {
    const apps = Array.from({ length: 8 }, (_, i) => `app-${i}`);
    mocks.list.mockResolvedValue(apps.map((app) => container(app, app)));
    let active = 0;
    let peak = 0;
    const finish: (() => void)[] = [];
    mocks.stats.mockImplementation(() => new Promise((resolve) => {
      active++;
      peak = Math.max(peak, active);
      finish.push(() => { active--; resolve(rawStats); });
    }));
    const { readServiceStats } = await import("./docker");
    const requests = apps.map((app) => readServiceStats(app, new Set(apps)));
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.stats).toHaveBeenCalledTimes(4);
    while (finish.length) {
      finish.shift()!();
      await vi.advanceTimersByTimeAsync(0);
    }
    expect((await Promise.all(requests)).every((result) => result.status === "running")).toBe(true);
    expect(peak).toBe(4);
  });

  it("aborts stalled reads and does not free their slots before the underlying call settles", async () => {
    const signals: AbortSignal[] = [];
    mocks.list.mockImplementation(({ abortSignal }: { abortSignal: AbortSignal }) => {
      signals.push(abortSignal);
      return new Promise(() => {});
    });
    const { readServiceStats } = await import("./docker");
    const apps = new Set(["one", "two", "three", "four", "five"]);
    const requests = [...apps].map((app) => readServiceStats(app, apps));
    await vi.advanceTimersByTimeAsync(12_000);
    expect((await Promise.all(requests)).every((result) => result.status === "unavailable")).toBe(true);
    expect(mocks.list).toHaveBeenCalledTimes(4);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    expect(mocks.stats).not.toHaveBeenCalled();
  });

  it("reports no matching running containers as not running", async () => {
    mocks.list.mockResolvedValue([container("other", "foreign"), container("stopped", "app", "exited")]);
    const { readServiceStats } = await import("./docker");
    expect(await readServiceStats("app", new Set(["app"]))).toEqual({ status: "not-running", sample: null, containers: 0 });
    expect(mocks.stats).not.toHaveBeenCalled();
  });

  it("reports a failed list or one failed container read as unavailable, never a partial sum", async () => {
    const { readServiceStats } = await import("./docker");
    mocks.list.mockRejectedValueOnce(new Error("socket unavailable"));
    expect(await readServiceStats("absent", new Set(["absent"]))).toEqual({ status: "unavailable", sample: null, containers: 0 });
    mocks.list.mockResolvedValue([container("one", "app"), container("two", "app")]);
    mocks.stats.mockRejectedValueOnce(new Error("container disappeared"));
    expect(await readServiceStats("app", new Set(["app"]))).toEqual({ status: "unavailable", sample: null, containers: 2 });
  });
});
