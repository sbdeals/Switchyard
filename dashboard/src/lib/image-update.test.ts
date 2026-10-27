import { describe, expect, it, vi } from "vitest";
import { checkServiceImageUpdates, matchingRepoDigests, type ImageUpdateDependencies, type RunningServiceImage } from "./image-update";

const current = `sha256:${"a".repeat(64)}`;
const previous = `sha256:${"b".repeat(64)}`;
const platform = `sha256:${"c".repeat(64)}`;
const checkedAt = "2026-10-26T12:00:00.000Z";

function fixture(options: {
  tree?: unknown[];
  detail?: Record<string, unknown>;
  containers?: RunningServiceImage[];
  registry?: { digest: string | null; reason: string | null };
} = {}) {
  const request = vi.fn(async (path: string) => path === "project.all"
    ? options.tree ?? [{ environments: [{ applications: [{ applicationId: "owned" }] }] }]
    : options.detail ?? { appName: "owned-app", sourceType: "docker", dockerImage: "nginx:alpine" });
  const inspect = vi.fn(async () => options.containers ?? [{ image: "nginx:alpine", repoDigests: [`nginx@${current}`] }]);
  const lookup = vi.fn(async () => ({ ...(options.registry ?? { digest: current, reason: null }), checkedAt }));
  const dependencies: ImageUpdateDependencies = { request: request as ImageUpdateDependencies["request"], inspect, lookup };
  return { request, inspect, lookup, dependencies };
}

describe("matchingRepoDigests", () => {
  it("normalizes repository names and excludes other repositories and image IDs", () => {
    expect(matchingRepoDigests("nginx:alpine", [
      `docker.io/library/nginx@${current}`,
      `registry-1.docker.io/library/nginx@${current}`,
      `ghcr.io/library/nginx@${previous}`,
      `redis@${previous}`,
      current,
    ])).toEqual([current]);
  });
});

describe("checkServiceImageUpdates", () => {
  it("rejects unowned IDs before service details, Docker or registry access", async () => {
    const f = fixture();
    expect(await checkServiceImageUpdates("application", "someone-elses", f.dependencies)).toBeNull();
    expect(f.request.mock.calls).toEqual([["project.all"]]);
    expect(f.inspect).not.toHaveBeenCalled();
    expect(f.lookup).not.toHaveBeenCalled();
  });

  it("checks ownership again on every request and keeps service kinds isolated", async () => {
    const f = fixture();
    expect(await checkServiceImageUpdates("database", "owned", f.dependencies)).toBeNull();
    f.request.mockResolvedValueOnce([]);
    expect(await checkServiceImageUpdates("application", "owned", f.dependencies)).toBeNull();
    expect(f.request.mock.calls).toEqual([["project.all"], ["project.all"]]);
    expect(f.inspect).not.toHaveBeenCalled();
  });

  it("fails closed if the user's project tree is unavailable", async () => {
    const f = fixture();
    f.request.mockRejectedValueOnce(new Error("session expired"));
    await expect(checkServiceImageUpdates("application", "owned", f.dependencies)).rejects.toThrow("session expired");
    expect(f.inspect).not.toHaveBeenCalled();
    expect(f.lookup).not.toHaveBeenCalled();
  });

  it("does not check Git-built applications", async () => {
    const f = fixture({ detail: { appName: "owned-app", sourceType: "github", dockerImage: "nginx:alpine" } });
    expect(await checkServiceImageUpdates("application", "owned", f.dependencies)).toEqual({ images: [] });
    expect(f.inspect).not.toHaveBeenCalled();
    expect(f.lookup).not.toHaveBeenCalled();
  });

  it("reports a missing image configuration without registry access", async () => {
    const f = fixture({ detail: { sourceType: "docker", dockerImage: null } });
    expect((await checkServiceImageUpdates("application", "owned", f.dependencies))?.images[0]).toMatchObject({
      image: "", status: "unknown", reason: "No Docker image is configured.",
    });
    expect(f.lookup).not.toHaveBeenCalled();
    expect(f.inspect).not.toHaveBeenCalled();
  });

  it("resolves database engines from the owned project tree", async () => {
    const f = fixture({ tree: [{ environments: [{ postgres: [{ postgresId: "owned" }] }] }] });
    const result = await checkServiceImageUpdates("database", "owned", f.dependencies);
    expect(f.request.mock.calls).toEqual([["project.all"], ["postgres.one?postgresId=owned"]]);
    expect(f.inspect).toHaveBeenCalledWith("owned-app", "database");
    expect(result?.images[0].status).toBe("up-to-date");
  });

  it("compares the index digest in RepoDigests, even beside a platform digest", async () => {
    const f = fixture({ containers: [{ image: "nginx:alpine", repoDigests: [`nginx@${platform}`, `nginx@${current}`] }] });
    expect((await checkServiceImageUpdates("application", "owned", f.dependencies))?.images[0]).toEqual({
      image: "nginx:alpine", runningDigest: current, registryDigest: current,
      status: "up-to-date", reason: null, checkedAt,
    });
    expect(f.lookup).toHaveBeenCalledWith("nginx:alpine");
  });

  it("reports an update when the same tag resolves to a different digest", async () => {
    const f = fixture({ containers: [{ image: "nginx:alpine", repoDigests: [`nginx@${previous}`] }] });
    expect((await checkServiceImageUpdates("application", "owned", f.dependencies))?.images[0]).toMatchObject({
      runningDigest: previous, registryDigest: current, status: "update-available", reason: null,
    });
  });

  it("does not compare a digest from an unrelated repository", async () => {
    const f = fixture({ containers: [{ image: "nginx:alpine", repoDigests: [`redis@${previous}`] }] });
    expect((await checkServiceImageUpdates("application", "owned", f.dependencies))?.images[0]).toMatchObject({
      runningDigest: null, registryDigest: current, status: "unknown",
      reason: "The running image has no matching registry digest.",
    });
  });

  it("reports no running container without claiming an update", async () => {
    const f = fixture({ containers: [] });
    expect((await checkServiceImageUpdates("application", "owned", f.dependencies))?.images[0]).toMatchObject({
      runningDigest: null, registryDigest: current, status: "unknown", reason: "No running container was found.",
    });
  });

  it("keeps registry results useful when Docker inspection fails", async () => {
    const f = fixture();
    f.inspect.mockRejectedValueOnce(new Error("daemon unavailable"));
    expect((await checkServiceImageUpdates("application", "owned", f.dependencies))?.images[0]).toMatchObject({
      status: "unknown", registryDigest: current, reason: "The running image could not be inspected.",
    });
  });

  it.each(["Pinned by digest.", "This image requires registry authentication.", "The registry rate limit was reached."])(
    "keeps unknown registry reasons: %s", async (reason) => {
      const f = fixture({ registry: { digest: null, reason } });
      expect((await checkServiceImageUpdates("application", "owned", f.dependencies))?.images[0]).toMatchObject({
        status: "unknown", runningDigest: current, registryDigest: null, reason,
      });
    },
  );

  it("does not call mixed running replicas up to date", async () => {
    const f = fixture({ containers: [
      { image: "nginx:alpine", repoDigests: [`nginx@${current}`] },
      { image: "nginx:alpine", repoDigests: [`nginx@${previous}`] },
    ] });
    expect((await checkServiceImageUpdates("application", "owned", f.dependencies))?.images[0]).toMatchObject({
      status: "unknown", runningDigest: null, reason: "Running replicas use different image digests.",
    });
  });

  it("uses each compose service's deployed reference and groups identical replicas", async () => {
    const f = fixture({
      tree: [{ environments: [{ compose: [{ composeId: "owned" }] }] }],
      containers: [
        { image: "nginx:alpine", repoDigests: [`nginx@${current}`], serviceName: "web" },
        { image: "nginx:alpine", repoDigests: [`nginx@${current}`], serviceName: "web" },
        { image: "redis:7", repoDigests: [`redis@${previous}`], serviceName: "cache" },
      ],
    });
    const result = await checkServiceImageUpdates("compose", "owned", f.dependencies);
    expect(f.inspect).toHaveBeenCalledWith("owned-app", "compose");
    expect(result?.images).toHaveLength(2);
    expect(result?.images[0]).toMatchObject({ image: "nginx:alpine", serviceName: "web", status: "up-to-date" });
    expect(result?.images[1]).toMatchObject({ image: "redis:7", serviceName: "cache", status: "update-available" });
  });

  it("does not describe an inspection failure as an empty compose stack", async () => {
    const f = fixture({ tree: [{ environments: [{ compose: [{ composeId: "owned" }] }] }] });
    f.inspect.mockRejectedValueOnce(new Error("daemon unavailable"));
    await expect(checkServiceImageUpdates("compose", "owned", f.dependencies)).rejects.toThrow("could not be inspected");
    expect(f.lookup).not.toHaveBeenCalled();
  });
});
