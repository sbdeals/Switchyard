import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const fixture = vi.hoisted(() => ({
  start: vi.fn(), wait: vi.fn(), logs: vi.fn(), remove: vi.fn(), create: vi.fn(),
}));
vi.mock("dockerode", () => ({ default: class { createContainer = fixture.create; } }));
vi.mock("./docker", () => ({ inspectImageExposedPorts: vi.fn(async () => []) }));

import { parsePrivateRepoFiles, privateRepoFilesCommand, readPrivateRepoFiles } from "./private-repo-files";
import { detectBuildPlan } from "./build-plan";

const row = (file: string, content = "") => `SYFILE\t${file}\t${Buffer.from(content).toString("base64")}\n`;
const path = "/etc/dokploy/patch-repos/compose/proof-abc";

beforeEach(() => {
  vi.clearAllMocks();
  fixture.create.mockResolvedValue(fixture);
  fixture.start.mockResolvedValue(undefined);
  fixture.wait.mockResolvedValue({ StatusCode: 0 });
  fixture.logs.mockResolvedValue(Buffer.from(row("index.html")));
  fixture.remove.mockResolvedValue(undefined);
});
afterEach(() => vi.useRealTimers());

describe("private manifest projection", () => {
  it("detects the same Node lockfile and Django rules from staged files", () => {
    const node = parsePrivateRepoFiles(row("package.json", '{"scripts":{"start":"node index.js"}}') + row("pnpm-lock.yaml"));
    expect(detectBuildPlan(node).dockerfileInline).toContain("corepack pnpm install --frozen-lockfile");
    const django = parsePrivateRepoFiles(row("requirements.txt", "django") + row("manage.py") + row("demo/wsgi.py"));
    expect(detectBuildPlan(django)).toMatchObject({ kind: "python", port: 8000 });
    expect(detectBuildPlan(django).dockerfileInline).toContain("demo.wsgi:application");
  });

  it("honors an explicit Dockerfile and rejects a missing one", () => {
    const files = parsePrivateRepoFiles(row("docker/Production", "FROM nginx:alpine\nEXPOSE 80"), "docker/Production");
    expect(detectBuildPlan(files).kind).toBe("dockerfile");
    expect(files.contents.Dockerfile).toContain("EXPOSE 80");
    expect(() => parsePrivateRepoFiles(row("index.html"), "docker/Production")).toThrow("selected Dockerfile was not found");
  });

  it("rejects unrequested files, oversized manifests and invalid output without echoing content", () => {
    for (const output of [row(".git/config", "SECRET"), row(".env", "SECRET"), "SECRET", row("package.json", "x".repeat(128 * 1024 + 1)), "x".repeat(2 * 1024 * 1024 + 1)]) {
      expect(() => parsePrivateRepoFiles(output)).toThrow();
      try { parsePrivateRepoFiles(output); } catch (e) { expect(String(e)).not.toContain("SECRET"); }
    }
  });

  it("archives before reading and guards all manifest paths against symlinks and command injection", () => {
    const command = privateRepoFilesCommand("apps/web", "docker/Production");
    expect(command.indexOf("git -c safe.directory=/repo -C /repo archive HEAD")).toBeLessThan(command.indexOf("base64 <"));
    expect(command).toContain('test "$(readlink -f "$1")" = "$PWD/$1"');
    expect(command).toContain('test "$(wc -c < "$file")" -le 131072');
    expect(() => privateRepoFilesCommand("../secret")).toThrow();
    expect(() => privateRepoFilesCommand(undefined, "Dockerfile;env")).toThrow();
    expect(() => privateRepoFilesCommand(undefined, "../secret")).toThrow();
  });
});

describe("isolated manifest reader", () => {
  it("mounts only the authorized clone read-only, without a network, and removes its helper", async () => {
    expect(await readPrivateRepoFiles(path, "proof-abc")).toEqual({ files: ["index.html"], contents: { "index.html": "" } });
    expect(fixture.create).toHaveBeenCalledWith(expect.objectContaining({
      Image: "alpine/git:2.49.1",
      HostConfig: expect.objectContaining({ NetworkMode: "none", ReadonlyRootfs: true,
        Mounts: [{ Type: "bind", Source: path, Target: "/repo", ReadOnly: true }] }),
    }));
    expect(fixture.remove).toHaveBeenCalledWith({ force: true, v: true });
  });

  it.each(["/etc/dokploy", "/etc/dokploy/patch-repos/compose/another-app", "/etc/dokploy/patch-repos/compose/../secret"])("rejects a path outside this service's patch clone", async (repoPath) => {
    await expect(readPrivateRepoFiles(repoPath, "proof-abc")).rejects.toThrow("local clone directory");
    expect(fixture.create).not.toHaveBeenCalled();
  });

  it("cleans up without reading output after staging fails", async () => {
    fixture.wait.mockResolvedValue({ StatusCode: 1 });
    await expect(readPrivateRepoFiles(path, "proof-abc")).rejects.toThrow("Could not stage");
    expect(fixture.logs).not.toHaveBeenCalled();
    expect(fixture.remove).toHaveBeenCalledWith({ force: true, v: true });
  });

  it("bounds staging time and removes a stalled helper", async () => {
    vi.useFakeTimers();
    fixture.wait.mockReturnValue(new Promise(() => {}));
    const pending = expect(readPrivateRepoFiles(path, "proof-abc")).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(30_000);
    await pending;
    expect(fixture.remove).toHaveBeenCalledWith({ force: true, v: true });
  });
});
