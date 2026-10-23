import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const docker = vi.hoisted(() => ({
  getImage: vi.fn(),
  inspect: vi.fn(),
  pull: vi.fn(),
  followProgress: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("dockerode", () => ({
  default: class {
    getImage = docker.getImage;
    pull = docker.pull;
    modem = { followProgress: docker.followProgress };
  },
}));

let inspectImageExposedPorts: typeof import("./docker").inspectImageExposedPorts;

beforeEach(async () => {
  vi.resetAllMocks();
  vi.resetModules();
  vi.stubEnv("DOCKER_PULL_TIMEOUT_MS", "50");
  docker.getImage.mockReturnValue({ inspect: docker.inspect });
  ({ inspectImageExposedPorts } = await import("./docker"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("inspectImageExposedPorts", () => {
  it.each([
    "nginx",
    "traefik/whoami:latest",
    "registry.example:5000/team/nested/app:Release_1.2-3",
    "localhost:5000/team/app",
    "[2001:db8::1]:5000/team/app:latest",
    `ghcr.io/team/app@sha256:${"a".repeat(64)}`,
    `ghcr.io/team/app:release@sha256:${"a".repeat(64)}`,
    "team/my__app--image:v1",
  ])("allows a Docker reference before pulling: %s", async (image) => {
    docker.inspect.mockRejectedValue({ statusCode: 404 });
    docker.pull.mockRejectedValue(new Error("Registry unavailable"));
    expect(await inspectImageExposedPorts(image, { pullIfMissing: true })).toEqual([]);
    expect(docker.getImage).toHaveBeenCalledExactlyOnceWith(image);
    expect(docker.pull).toHaveBeenCalledExactlyOnceWith(image);
  });

  it.each([
    "",
    "https://registry.example/team/app",
    "user:secret@registry.example/team/app",
    "registry.example/team/app?token=secret",
    "registry.example/team/app#secret",
    "nginx latest",
    "nginx\n",
    "${IMAGE}",
    "team/$IMAGE:latest",
    "../images/nginx",
    "team//app",
    "team/App:latest",
    "app:",
    "app@sha256:invalid",
    `${"a".repeat(256)}:latest`,
  ])("rejects unsafe or malformed references before Docker access: %s", async (image) => {
    expect(await inspectImageExposedPorts(image, { pullIfMissing: true })).toEqual([]);
    expect(docker.getImage).not.toHaveBeenCalled();
    expect(docker.pull).not.toHaveBeenCalled();
  });

  it.each([
    { Config: { ExposedPorts: { "80/tcp": {} } } },
    { Config: {} },
  ])("uses cached metadata without pulling, including images without EXPOSE", async (info) => {
    docker.inspect.mockResolvedValue(info);
    expect(await inspectImageExposedPorts("traefik/whoami", { pullIfMissing: true }))
      .toEqual(Object.keys(info.Config.ExposedPorts ?? {}));
    expect(docker.pull).not.toHaveBeenCalled();
  });

  it("pulls a missing image to completion before inspecting its exposed port", async () => {
    const stream = new PassThrough();
    docker.inspect.mockRejectedValueOnce({ statusCode: 404 })
      .mockResolvedValueOnce({ Config: { ExposedPorts: { "80/tcp": {} } } });
    docker.pull.mockResolvedValue(stream);
    docker.followProgress.mockImplementation((_stream, finished) => finished(null, []));

    expect(await inspectImageExposedPorts("traefik/whoami", { pullIfMissing: true })).toEqual(["80/tcp"]);
    expect(docker.pull).toHaveBeenCalledExactlyOnceWith("traefik/whoami");
    expect(docker.followProgress).toHaveBeenCalledWith(stream, expect.any(Function));
    expect(docker.inspect).toHaveBeenCalledTimes(2);
    expect(docker.getImage).toHaveBeenCalledWith("traefik/whoami");
  });

  it("remains local-only unless pulling is requested", async () => {
    docker.inspect.mockRejectedValue({ statusCode: 404 });
    expect(await inspectImageExposedPorts("repo-app:latest")).toEqual([]);
    expect(docker.pull).not.toHaveBeenCalled();
  });

  it("does not pull when inspecting fails for a reason other than a missing image", async () => {
    docker.inspect.mockRejectedValue({ statusCode: 500 });
    expect(await inspectImageExposedPorts("traefik/whoami", { pullIfMissing: true })).toEqual([]);
    expect(docker.pull).not.toHaveBeenCalled();
  });

  it("leaves port selection to the fallback when the pull request fails", async () => {
    docker.inspect.mockRejectedValue({ statusCode: 404 });
    docker.pull.mockRejectedValue(new Error("Registry unavailable"));
    expect(await inspectImageExposedPorts("traefik/whoami", { pullIfMissing: true })).toEqual([]);
    expect(docker.inspect).toHaveBeenCalledTimes(1);
  });

  it("leaves port selection to the fallback when the progress stream reports failure", async () => {
    const stream = new PassThrough();
    docker.inspect.mockRejectedValue({ statusCode: 404 });
    docker.pull.mockResolvedValue(stream);
    docker.followProgress.mockImplementation((_stream, finished) => finished(new Error("Pull failed"), []));

    expect(await inspectImageExposedPorts("traefik/whoami", { pullIfMissing: true })).toEqual([]);
    expect(stream.destroyed).toBe(true);
    expect(docker.inspect).toHaveBeenCalledTimes(1);
  });

  it("bounds a stalled progress stream by DOCKER_PULL_TIMEOUT_MS and closes it", async () => {
    vi.useFakeTimers();
    const stream = new PassThrough();
    docker.inspect.mockRejectedValue({ statusCode: 404 });
    docker.pull.mockResolvedValue(stream);
    const result = inspectImageExposedPorts("traefik/whoami", { pullIfMissing: true });

    await vi.advanceTimersByTimeAsync(50);
    expect(await result).toEqual([]);
    expect(stream.destroyed).toBe(true);
    expect(docker.inspect).toHaveBeenCalledTimes(1);
  });

  it("also bounds pull request setup and closes a stream that arrives after the deadline", async () => {
    vi.useFakeTimers();
    const stream = new PassThrough();
    let finishPull!: (stream: PassThrough) => void;
    docker.inspect.mockRejectedValue({ statusCode: 404 });
    docker.pull.mockReturnValue(new Promise<PassThrough>((resolve) => { finishPull = resolve; }));
    const result = inspectImageExposedPorts("traefik/whoami", { pullIfMissing: true });

    await vi.advanceTimersByTimeAsync(50);
    expect(await result).toEqual([]);
    finishPull(stream);
    await vi.advanceTimersByTimeAsync(0);
    expect(stream.destroyed).toBe(true);
    expect(docker.followProgress).not.toHaveBeenCalled();
    expect(docker.inspect).toHaveBeenCalledTimes(1);
  });
});
