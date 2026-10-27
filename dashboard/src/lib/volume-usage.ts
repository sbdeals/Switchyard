export interface DockerVolumeUsage {
  Name: string;
  Labels?: Record<string, string> | null;
  UsageData?: { Size: number } | null;
}

export interface VolumeUsage {
  mountId?: string;
  volumeName: string;
  dockerName: string | null;
  sizeBytes: number | null;
}

function validSize(size: number | null | undefined): size is number {
  return typeof size === "number" && Number.isFinite(size) && size >= 0;
}

function volumeUsage(volumeName: string, volume?: DockerVolumeUsage): VolumeUsage {
  const size = volume?.UsageData?.Size;
  return {
    volumeName,
    dockerName: volume?.Name ?? null,
    sizeBytes: validSize(size) ? size : null,
  };
}

export function serviceVolumeUsage(
  mounts: readonly { mountId: string; type: string; volumeName: string | null }[],
  volumes: readonly DockerVolumeUsage[],
  composeProject?: string,
): VolumeUsage[] {
  const usages: VolumeUsage[] = mounts
    .filter((mount) => mount.type === "volume" && mount.volumeName)
    .map((mount) => {
      const name = mount.volumeName!;
      // Compose may prefix a volume name or give it a custom name. Labels
      // identify the project without confusing another stack's same basename.
      const scoped = composeProject
        ? volumes.find((volume) =>
            volume.Labels?.["com.docker.compose.project"] === composeProject &&
            volume.Labels?.["com.docker.compose.volume"] === name,
          ) ?? volumes.find((volume) => volume.Name === `${composeProject}_${name}`)
        : undefined;
      const volume = scoped ?? volumes.find((volume) => volume.Name === name);
      return { mountId: mount.mountId, ...volumeUsage(name, volume) };
    });

  // Volumes declared directly in compose.yml need not have Dokploy mount rows.
  if (composeProject) {
    const represented = new Set(usages.map((usage) => usage.dockerName));
    for (const volume of volumes) {
      if (
        volume.Labels?.["com.docker.compose.project"] !== composeProject ||
        represented.has(volume.Name)
      ) continue;
      usages.push(volumeUsage(volume.Labels["com.docker.compose.volume"] || volume.Name, volume));
      represented.add(volume.Name);
    }
  }

  return usages;
}

export function totalVolumeUsage(usages: readonly VolumeUsage[]): number | null {
  const counted = new Set<string>();
  let total = 0;
  for (const usage of usages) {
    if (!usage.dockerName || !validSize(usage.sizeBytes)) return null;
    if (counted.has(usage.dockerName)) continue;
    counted.add(usage.dockerName);
    total += usage.sizeBytes;
  }
  return total;
}

export function formatVolumeBytes(size: number | null | undefined): string {
  if (!validSize(size)) return "unknown";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  const unit = size > 0 ? Math.min(Math.floor(Math.log(size) / Math.log(1024)), units.length - 1) : 0;
  const index = Math.max(unit, 0);
  return `${Number((size / 1024 ** index).toFixed(1))} ${units[index]}`;
}
