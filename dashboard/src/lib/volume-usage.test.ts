import { describe, expect, it } from "vitest";
import {
  formatVolumeBytes,
  serviceVolumeUsage,
  totalVolumeUsage,
  type DockerVolumeUsage,
  type VolumeUsage,
} from "./volume-usage";

const mount = (volumeName: string | null, type = "volume", mountId = "mount-1") => ({
  mountId, type, volumeName,
});

const volume = (Name: string, Size = 1024, Labels?: Record<string, string>): DockerVolumeUsage => ({
  Name, UsageData: { Size }, Labels,
});

const labels = (project: string, name: string) => ({
  "com.docker.compose.project": project,
  "com.docker.compose.volume": name,
});

describe("serviceVolumeUsage", () => {
  it("matches a named Dokploy mount exactly, including empty volumes", () => {
    expect(serviceVolumeUsage([mount("data")], [volume("data", 0)])).toEqual([
      { mountId: "mount-1", volumeName: "data", dockerName: "data", sizeBytes: 0 },
    ]);
  });

  it("matches Compose project-prefixed names", () => {
    expect(serviceVolumeUsage([mount("data")], [volume("app-abc_data")], "app-abc")).toEqual([
      { mountId: "mount-1", volumeName: "data", dockerName: "app-abc_data", sizeBytes: 1024 },
    ]);
  });

  it("matches custom Compose volume names through project and volume labels", () => {
    expect(serviceVolumeUsage([mount("data")], [volume("custom", 42, labels("app", "data"))], "app")).toEqual([
      { mountId: "mount-1", volumeName: "data", dockerName: "custom", sizeBytes: 42 },
    ]);
  });

  it("prefers the current Compose project over another project's exact basename", () => {
    const volumes = [
      volume("data", 999, labels("other", "data")),
      volume("app_data", 50, labels("app", "data")),
    ];
    expect(serviceVolumeUsage([mount("data")], volumes, "app")[0].sizeBytes).toBe(50);
  });

  it("supports exact names for external Compose volumes", () => {
    expect(serviceVolumeUsage([mount("shared")], [volume("shared")], "app")[0].dockerName).toBe("shared");
  });

  it("does not match arbitrary suffixes or other projects' labels", () => {
    expect(serviceVolumeUsage([mount("data")], [volume("other_data", 50, labels("other", "data"))], "app")).toEqual([
      { mountId: "mount-1", volumeName: "data", dockerName: null, sizeBytes: null },
    ]);
  });

  it("reports missing volumes as unknown", () => {
    expect(serviceVolumeUsage([mount("missing")], [])[0]).toEqual({
      mountId: "mount-1", volumeName: "missing", dockerName: null, sizeBytes: null,
    });
  });

  it.each([undefined, null, { Size: -1 }, { Size: NaN }, { Size: Infinity }])(
    "reports unavailable or invalid Docker sizes as unknown: %s",
    (UsageData) => {
      expect(serviceVolumeUsage([mount("data")], [{ Name: "data", UsageData }])[0].sizeBytes).toBeNull();
    },
  );

  it("excludes bind and file mounts and unnamed mounts", () => {
    expect(serviceVolumeUsage([
      mount("data", "bind"), mount("data", "file"), mount(null), mount(""),
    ], [volume("data")])).toEqual([]);
  });

  it("includes Compose YAML volumes once, even without Dokploy mount rows", () => {
    const volumes = [
      volume("app_data", 50, labels("app", "data")),
      volume("app_cache", 10, labels("app", "cache")),
      volume("other_data", 99, labels("other", "data")),
      volume("unlabelled", 99),
    ];
    expect(serviceVolumeUsage([mount("data")], volumes, "app")).toEqual([
      { mountId: "mount-1", volumeName: "data", dockerName: "app_data", sizeBytes: 50 },
      { volumeName: "cache", dockerName: "app_cache", sizeBytes: 10 },
    ]);
    expect(serviceVolumeUsage([], volumes, "app")).toHaveLength(2);
    expect(serviceVolumeUsage([], volumes)).toEqual([]);
  });
});

describe("totalVolumeUsage", () => {
  const usage = (dockerName: string | null, sizeBytes: number | null): VolumeUsage => ({
    volumeName: "data", dockerName, sizeBytes,
  });

  it("totals unique Docker volumes across services", () => {
    expect(totalVolumeUsage([usage("shared", 50), usage("shared", 50), usage("other", 20)])).toBe(70);
  });

  it("returns zero for no volumes", () => {
    expect(totalVolumeUsage([])).toBe(0);
  });

  it("keeps the total unknown if any volume is missing or unreadable", () => {
    expect(totalVolumeUsage([usage("known", 50), usage(null, null)])).toBeNull();
    expect(totalVolumeUsage([usage("known", 50), usage("unknown", null)])).toBeNull();
    expect(totalVolumeUsage([usage("known", 50), usage("known", null)])).toBeNull();
    expect(totalVolumeUsage([usage("invalid", -1)])).toBeNull();
  });
});

describe("formatVolumeBytes", () => {
  it.each([
    [0, "0 B"],
    [1, "1 B"],
    [1023, "1023 B"],
    [1024, "1 KiB"],
    [1536, "1.5 KiB"],
    [50 * 1024 ** 2, "50 MiB"],
    [1024 ** 3, "1 GiB"],
    [1.25 * 1024 ** 3, "1.3 GiB"],
    [1024 ** 4, "1 TiB"],
    [1024 ** 5, "1024 TiB"],
  ])("formats %s bytes as %s", (size, expected) => {
    expect(formatVolumeBytes(size)).toBe(expected);
  });

  it.each([null, undefined, -1, NaN, Infinity])("formats invalid size %s as unknown", (size) => {
    expect(formatVolumeBytes(size)).toBe("unknown");
  });
});
