import { PassThrough, Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ request: vi.fn(), listContainers: vi.fn(), dial: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("./dokploy", () => ({ request: mocks.request }));
vi.mock("next/navigation", () => ({ unstable_rethrow: () => {} }));
vi.mock("dockerode", () => ({ default: class {
  listContainers = mocks.listContainers;
  modem = { dial: mocks.dial };
} }));

import { collectDockerLogs, containerLogSource, getProjectLogs, logRangeMs, projectLogRefs } from "./project-logs";

const tree = [{ projectId: "project", environments: [
  { environmentId: "production", applications: [{ applicationId: "web" }], compose: [{ composeId: "stack" }] },
  { environmentId: "staging", applications: [{ applicationId: "other" }] },
] }];
const services = [
  { id: "compose:stack", name: "Stack", appName: "stack-exact", kind: "compose", remote: false },
  { id: "application:web", name: "Web", appName: "web-exact", kind: "application", remote: false },
];
const frame = (text: string | Buffer, channel = 1) => {
  const payload = Buffer.isBuffer(text) ? text : Buffer.from(text);
  const header = Buffer.alloc(8);
  header[0] = channel;
  header.writeUInt32BE(payload.length, 4);
  return Buffer.concat([header, payload]);
};
const signal = () => new AbortController().signal;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.request.mockImplementation(async (path: string) => path === "project.all"
    ? tree
    : { name: "Stack", appName: "stack-exact" });
  mocks.listContainers.mockResolvedValue([]);
});

describe("project log authorization", () => {
  it("requires both project and environment to be in the current user's tree", () => {
    expect(projectLogRefs(tree, "project", "production")).toEqual([
      { id: "web", kind: "application" }, { id: "stack", kind: "compose" },
    ]);
    expect(() => projectLogRefs(tree, "other", "production")).toThrow("Unknown project");
    expect(() => projectLogRefs(tree, "project", "missing")).toThrow("Unknown project");
  });

  it("fails closed without reading Docker when scope cannot be authorized", async () => {
    await expect(getProjectLogs("other", "production", 900_000, signal())).rejects.toThrow("Unknown project");
    expect(mocks.listContainers).not.toHaveBeenCalled();
    mocks.request.mockRejectedValue(new Error("Dokploy unavailable"));
    await expect(getProjectLogs("project", "production", 900_000, signal())).rejects.toThrow("Dokploy unavailable");
    expect(mocks.listContainers).not.toHaveBeenCalled();
  });

  it("accepts only exact owner labels and separates compose child services", () => {
    const source = containerLogSource({ Labels: { "com.docker.compose.project": "stack-exact", "com.docker.compose.service": "worker" } }, services);
    expect(source).toEqual({ id: "compose:stack:worker", name: "Stack / worker", appName: "stack-exact" });
    expect(containerLogSource({ Labels: { "com.docker.compose.project": "stack-exact-extra" } }, services)).toBeUndefined();
    expect(containerLogSource({ Labels: {} }, services)).toBeUndefined();
    expect(containerLogSource({ Labels: { "com.docker.swarm.service.name": "web-exact" } }, services)?.id).toBe("application:web");
    expect(containerLogSource({ Labels: { "com.docker.compose.project": "web-exact" } }, services)).toBeUndefined();
    expect(containerLogSource({ Labels: { "com.docker.compose.project": "stack-exact" } }, services.map((s) => ({ ...s, remote: true })))).toBeUndefined();
  });

  it("allows only the three bounded time ranges", () => {
    expect(["15m", "1h", "6h"].map(logRangeMs)).toEqual([900_000, 3_600_000, 21_600_000]);
    expect(logRangeMs("all")).toBeUndefined();
    expect(logRangeMs("constructor")).toBeUndefined();
  });
});

describe("bounded Docker log reader", () => {
  it("decodes split headers and UTF-8, keeping stdout/stderr lines distinct", async () => {
    const emoji = Buffer.from("🚀");
    const raw = Buffer.concat([frame(Buffer.concat([Buffer.from("INFO "), emoji.subarray(0, 2)])), frame("ERROR other\n", 2), frame(Buffer.concat([emoji.subarray(2), Buffer.from(" ready\n")]))]);
    const chunks = Array.from(raw, (byte) => Buffer.from([byte]));
    expect(await collectDockerLogs(Readable.from(chunks), signal())).toEqual({
      lines: ["ERROR other", "INFO 🚀 ready"], truncated: false,
    });
  });

  it("supports TTY output, short streams, and final unterminated lines", async () => {
    expect(await collectDockerLogs(Readable.from([Buffer.from("info hello\nlast")]), signal())).toEqual({ lines: ["info hello", "last"], truncated: false });
    expect(await collectDockerLogs(Readable.from([Buffer.from("short")]), signal())).toEqual({ lines: ["short"], truncated: false });
  });

  it("bounds retained lines and oversized payloads", async () => {
    const result = await collectDockerLogs(Readable.from([frame(Array.from({ length: 350 }, (_, i) => `INFO ${i}\n`).join(""))]), signal());
    expect(result.lines).toHaveLength(300);
    expect(result.lines[0]).toBe("INFO 50");
    expect(result.truncated).toBe(true);
    const oversized = await collectDockerLogs(Readable.from([frame("x".repeat(500_000))]), signal());
    expect(oversized.lines[0].length).toBeLessThanOrEqual(8192 + 128);
    expect(oversized.truncated).toBe(true);
  });

  it("destroys the stream and removes the abort listener on cancellation", async () => {
    const stream = new PassThrough();
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const result = collectDockerLogs(stream, controller.signal);
    controller.abort();
    await expect(result).rejects.toThrow("aborted");
    expect(stream.destroyed).toBe(true);
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
  });

  it("does not silently accept a broken response", async () => {
    const stream = new PassThrough();
    const result = collectDockerLogs(stream, signal());
    stream.destroy(new Error("socket disconnected"));
    await expect(result).rejects.toThrow("socket disconnected");
    expect(stream.destroyed).toBe(true);
  });
});

describe("project snapshots", () => {
  it("reads all matching compose children including stopped containers and merges by time", async () => {
    const now = Date.now();
    mocks.listContainers.mockResolvedValue(["a", "b"].map((id, i) => ({ Id: id, Created: i, State: i ? "exited" : "running", Labels: {
      "com.docker.compose.project": "stack-exact", "com.docker.compose.service": `logx-${id}`,
    } })));
    mocks.dial.mockImplementation((options, callback) => {
      const a = options.path.includes("/a/");
      callback(null, Readable.from([frame(`${new Date(now - (a ? 1000 : 500)).toISOString()} INFO ${a ? "first" : "second"}\n`)]));
    });
    const result = await getProjectLogs("project", "production", 900_000, signal());
    expect(result.sources.map((source) => source.name).sort()).toEqual(["Stack / logx-a", "Stack / logx-b"]);
    expect(result.lines.map((line) => line.text)).toEqual(["INFO first", "INFO second"]);
    expect(mocks.listContainers).toHaveBeenCalledWith({ all: true, abortSignal: expect.any(AbortSignal) });
    expect(mocks.dial).toHaveBeenCalledWith(expect.objectContaining({
      isStream: true,
      options: expect.objectContaining({ follow: false, tail: 300, timestamps: true, since: expect.any(Number) }),
    }), expect.any(Function));
    expect(mocks.request.mock.calls.some(([path]) => path.includes("other"))).toBe(false);
  });

  it("reports container failures while preserving readable services", async () => {
    mocks.listContainers.mockResolvedValue(["a", "b"].map((id) => ({ Id: id, Created: 1, Labels: {
      "com.docker.compose.project": "stack-exact", "com.docker.compose.service": id,
    } })));
    mocks.dial.mockImplementation((options, callback) => options.path.includes("/a/")
      ? callback(new Error("unreadable"))
      : callback(null, Readable.from([frame(`${new Date().toISOString()} INFO ready\n`)])));
    const result = await getProjectLogs("project", "production", 900_000, signal());
    expect(result.lines).toHaveLength(1);
    expect(result.warnings).toContain("Stack / a: container logs unavailable.");
  });

  it("caps container fanout and reports omitted containers and remote services", async () => {
    mocks.request.mockImplementation(async (path: string) => path === "project.all" ? tree
      : path.startsWith("application") ? { name: "Remote", appName: "remote", serverId: "server" }
      : { name: "Stack", appName: "stack-exact" });
    mocks.listContainers.mockResolvedValue(Array.from({ length: 40 }, (_, i) => ({ Id: `container-${i}`, Created: i, Labels: {
      "com.docker.compose.project": "stack-exact", "com.docker.compose.service": "worker",
    } })));
    mocks.dial.mockImplementation((options, callback) => callback(null, Readable.from([])));
    const result = await getProjectLogs("project", "production", 900_000, signal());
    expect(mocks.dial).toHaveBeenCalledTimes(32);
    expect(result.warnings).toContain("Only the newest 32 containers are included.");
    expect(result.warnings.some((warning) => warning.includes("Remote: remote-server logs"))).toBe(true);
  });
});
