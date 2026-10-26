import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDockerSwarmState: vi.fn(),
  getDokployVersion: vi.fn(),
  rethrow: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("./docker", () => ({ getDockerSwarmState: mocks.getDockerSwarmState }));
vi.mock("./dokploy", () => ({ getDokployVersion: mocks.getDokployVersion }));
vi.mock("next/navigation", () => ({ unstable_rethrow: mocks.rethrow }));

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-26T00:00:00Z"));
  mocks.getDockerSwarmState.mockResolvedValue({ LocalNodeState: "inactive", ControlAvailable: false });
  mocks.getDokployVersion.mockResolvedValue("0.30.10");
});

afterEach(() => {
  vi.useRealTimers();
});

describe("getHostCapabilities", () => {
  it("briefly caches reads and refreshes a changed engine after 30 seconds", async () => {
    const { getHostCapabilities } = await import("./host-capabilities-server");
    expect(await getHostCapabilities()).toEqual({ mode: "bridge", dokployVersion: "0.30.10" });
    mocks.getDockerSwarmState.mockResolvedValue({ LocalNodeState: "active", ControlAvailable: true });
    vi.advanceTimersByTime(29_999);
    expect((await getHostCapabilities()).mode).toBe("bridge");
    expect(mocks.getDockerSwarmState).toHaveBeenCalledTimes(1);
    expect(mocks.getDokployVersion).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect((await getHostCapabilities()).mode).toBe("swarm");
    expect(mocks.getDockerSwarmState).toHaveBeenCalledTimes(2);
    expect(mocks.getDokployVersion).toHaveBeenCalledTimes(2);
  });

  it("shares a pending engine read between concurrent renders", async () => {
    let finish!: (value: { LocalNodeState: string; ControlAvailable: boolean }) => void;
    mocks.getDockerSwarmState.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const { getHostCapabilities } = await import("./host-capabilities-server");
    const first = getHostCapabilities();
    const second = getHostCapabilities();
    expect(mocks.getDockerSwarmState).toHaveBeenCalledTimes(1);
    finish({ LocalNodeState: "active", ControlAvailable: false });
    expect(await first).toEqual({ mode: "worker", dokployVersion: "0.30.10" });
    expect(await second).toEqual(await first);
  });

  it("caches a Docker failure for 5 seconds while retaining the 30-second version cache", async () => {
    mocks.getDockerSwarmState.mockRejectedValueOnce(new Error("socket unavailable"));
    const { getHostCapabilities } = await import("./host-capabilities-server");
    expect(await getHostCapabilities()).toEqual({ mode: "unknown", dokployVersion: "0.30.10" });
    vi.advanceTimersByTime(4_999);
    expect((await getHostCapabilities()).mode).toBe("unknown");
    expect(mocks.getDockerSwarmState).toHaveBeenCalledTimes(1);
    expect(mocks.getDokployVersion).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect((await getHostCapabilities()).mode).toBe("bridge");
    expect(mocks.getDockerSwarmState).toHaveBeenCalledTimes(2);
    expect(mocks.getDokployVersion).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(25_000);
    expect((await getHostCapabilities()).mode).toBe("bridge");
    expect(mocks.getDockerSwarmState).toHaveBeenCalledTimes(2);
    expect(mocks.getDokployVersion).toHaveBeenCalledTimes(2);
  });

  it("retains engine truth when the version endpoint is unavailable", async () => {
    mocks.getDokployVersion.mockRejectedValue(new Error("version endpoint unavailable"));
    const { getHostCapabilities } = await import("./host-capabilities-server");
    expect(await getHostCapabilities()).toEqual({ mode: "bridge", dokployVersion: null });
    expect(mocks.rethrow).toHaveBeenCalledOnce();
  });

  it("preserves login redirects without sharing or caching another user's failure", async () => {
    const redirect = new Error("NEXT_REDIRECT");
    mocks.getDokployVersion.mockRejectedValueOnce(redirect);
    mocks.rethrow.mockImplementation((error) => { if (error === redirect) throw error; });
    const { getHostCapabilities } = await import("./host-capabilities-server");
    const first = getHostCapabilities();
    const second = getHostCapabilities();
    await expect(first).rejects.toBe(redirect);
    expect(await second).toEqual({ mode: "bridge", dokployVersion: "0.30.10" });
    expect(mocks.getDokployVersion).toHaveBeenCalledTimes(2);
  });
});
