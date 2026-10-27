import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mount, Service } from "./dokploy";
import { readProjectVolumeUsage, readServiceVolumes } from "./volume-usage.server";

const { listMounts, listVolumeDiskUsage, unstable_rethrow } = vi.hoisted(() => ({
  listMounts: vi.fn<typeof import("./dokploy").listMounts>(),
  listVolumeDiskUsage: vi.fn<typeof import("./docker").listVolumeDiskUsage>(),
  unstable_rethrow: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("./dokploy", () => ({ listMounts }));
vi.mock("./docker", () => ({ listVolumeDiskUsage }));
vi.mock("next/navigation", () => ({ unstable_rethrow }));

function service(
  kind: Service["kind"],
  id = "service-1",
  projectId = "project-1",
  environmentId = "environment-1",
): Service {
  return { kind, id, projectId, environmentId, appName: `app-${id}`, engine: "postgres" } as Service;
}

function mount(volumeName: string): Mount {
  return {
    mountId: `mount-${volumeName}`, type: "volume", volumeName, mountPath: "/data",
    hostPath: null, filePath: null, content: null,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  listMounts.mockResolvedValue([]);
  listVolumeDiskUsage.mockResolvedValue([]);
});

describe("readServiceVolumes", () => {
  it.each(["application", "compose", "postgres", "mysql", "mariadb", "mongo", "redis"] as const)(
    "requests mounts using the Dokploy service type %s",
    async (type) => {
      const target = type === "application" || type === "compose"
        ? service(type)
        : { ...service("database"), kind: "database" as const, engine: type } as Service;

      await readServiceVolumes(target);

      expect(listMounts).toHaveBeenCalledExactlyOnceWith(type, "service-1");
      expect(listVolumeDiskUsage).toHaveBeenCalledTimes(1);
    },
  );

  it("returns mount rows with their measured usage", async () => {
    const mounts = [mount("data")];
    listMounts.mockResolvedValue(mounts);
    listVolumeDiskUsage.mockResolvedValue([{ Name: "data", UsageData: { Size: 50 * 1024 ** 2 } }]);

    await expect(readServiceVolumes(service("application"))).resolves.toEqual({
      mounts,
      usage: [{ mountId: "mount-data", volumeName: "data", dockerName: "data", sizeBytes: 50 * 1024 ** 2 }],
      usageAvailable: true,
    });
  });

  it("discovers Compose YAML volumes using the service's appName", async () => {
    listVolumeDiskUsage.mockResolvedValue([
      {
        Name: "app-service-1_data", UsageData: { Size: 42 },
        Labels: { "com.docker.compose.project": "app-service-1", "com.docker.compose.volume": "data" },
      },
      {
        Name: "other_data", UsageData: { Size: 999 },
        Labels: { "com.docker.compose.project": "other", "com.docker.compose.volume": "data" },
      },
    ]);

    await expect(readServiceVolumes(service("compose"))).resolves.toEqual({
      mounts: [],
      usage: [{ volumeName: "data", dockerName: "app-service-1_data", sizeBytes: 42 }],
      usageAvailable: true,
    });
    expect((await readServiceVolumes(service("application"))).usage).toEqual([]);
  });

  it("reports unknown usage when Docker is unavailable", async () => {
    const mounts = [mount("data")];
    listMounts.mockResolvedValue(mounts);
    listVolumeDiskUsage.mockResolvedValue(null);

    await expect(readServiceVolumes(service("compose"))).resolves.toEqual({
      mounts,
      usage: [{ mountId: "mount-data", volumeName: "data", dockerName: null, sizeBytes: null }],
      usageAvailable: false,
    });
  });

  it("preserves mount API failures", async () => {
    const error = new Error("mount API unavailable");
    listMounts.mockRejectedValue(error);

    await expect(readServiceVolumes(service("application"))).rejects.toBe(error);
  });
});

describe("readProjectVolumeUsage", () => {
  it("deduplicates shared volumes across environments and keeps project totals separate", async () => {
    const services = [
      service("application", "first", "project-1", "production"),
      service("application", "second", "project-1", "preview"),
      service("database", "third", "project-2", "production"),
    ];
    listMounts.mockImplementation(async (_type, id) =>
      id === "second" ? [mount("shared"), mount("preview-data")] : [mount("shared")],
    );
    listVolumeDiskUsage.mockResolvedValue([
      { Name: "shared", UsageData: { Size: 50 } },
      { Name: "preview-data", UsageData: { Size: 20 } },
    ]);

    await expect(readProjectVolumeUsage(services)).resolves.toEqual({ "project-1": 70, "project-2": 50 });
    expect(listVolumeDiskUsage).toHaveBeenCalledTimes(1);
    expect(listMounts).toHaveBeenCalledTimes(3);
  });

  it("includes Compose YAML volumes in the project total", async () => {
    listVolumeDiskUsage.mockResolvedValue([{
      Name: "custom-data", UsageData: { Size: 50 },
      Labels: { "com.docker.compose.project": "app-service-1", "com.docker.compose.volume": "data" },
    }]);

    await expect(readProjectVolumeUsage([service("compose")])).resolves.toEqual({ "project-1": 50 });
  });

  it("marks the project unknown if any named mount is absent from Docker", async () => {
    listMounts.mockResolvedValue([mount("data"), mount("missing")]);
    listVolumeDiskUsage.mockResolvedValue([{ Name: "data", UsageData: { Size: 50 } }]);

    await expect(readProjectVolumeUsage([service("application")])).resolves.toEqual({ "project-1": null });
  });

  it("limits mount API failures to the affected project", async () => {
    const error = new Error("mount API unavailable");
    listMounts.mockImplementation(async (_type, id) => {
      if (id === "failed") throw error;
      return [mount("data")];
    });
    listVolumeDiskUsage.mockResolvedValue([{ Name: "data", UsageData: { Size: 50 } }]);

    await expect(readProjectVolumeUsage([
      service("application", "failed"),
      service("application", "healthy"),
      service("application", "other", "project-2"),
    ])).resolves.toEqual({ "project-1": null, "project-2": 50 });
    expect(unstable_rethrow).toHaveBeenCalledExactlyOnceWith(error);
  });

  it("preserves Next.js control-flow exceptions", async () => {
    const redirect = new Error("redirect");
    listMounts.mockRejectedValue(redirect);
    unstable_rethrow.mockImplementation((error) => { throw error; });

    await expect(readProjectVolumeUsage([service("application")])).rejects.toBe(redirect);
  });

  it("reports every project unknown when Docker is unavailable", async () => {
    listVolumeDiskUsage.mockResolvedValue(null);

    await expect(readProjectVolumeUsage([
      service("application"), service("compose", "other", "project-2"),
    ])).resolves.toEqual({ "project-1": null, "project-2": null });
    expect(listVolumeDiskUsage).toHaveBeenCalledTimes(1);
  });

  it("returns zero for a project without named volumes when Docker is available", async () => {
    listMounts.mockResolvedValue([{ ...mount("data"), type: "bind", hostPath: "/tmp/data" }]);

    await expect(readProjectVolumeUsage([service("application")])).resolves.toEqual({ "project-1": 0 });
  });

  it("returns an empty result for no services", async () => {
    await expect(readProjectVolumeUsage([])).resolves.toEqual({});
  });
});
