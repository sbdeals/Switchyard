import "server-only";
import { unstable_rethrow } from "next/navigation";

import { listMounts, type Mount, type Service } from "./dokploy";
import { listVolumeDiskUsage } from "./docker";
import { serviceVolumeUsage, totalVolumeUsage } from "./volume-usage";

/** Only pass services resolved from the current user's Dokploy workspace. */
function serviceMounts(service: Service): Promise<Mount[]> {
  return listMounts(service.kind === "database" ? service.engine : service.kind, service.id);
}

export async function readServiceVolumes(service: Service) {
  const [attached, volumes] = await Promise.all([
    serviceMounts(service),
    listVolumeDiskUsage(),
  ]);
  return {
    mounts: attached,
    usage: serviceVolumeUsage(attached, volumes ?? [], service.kind === "compose" ? service.appName : undefined),
    usageAvailable: volumes !== null,
  };
}

/** Count shared volumes once per project, across all its environments. */
export async function readProjectVolumeUsage(services: Service[]): Promise<Record<string, number | null>> {
  const volumes = await listVolumeDiskUsage();
  const results = await Promise.all(services.map(async (service) => {
    try {
      const mounts = await serviceMounts(service);
      return {
        projectId: service.projectId,
        usage: serviceVolumeUsage(mounts, volumes ?? [], service.kind === "compose" ? service.appName : undefined),
      };
    } catch (e) {
      unstable_rethrow(e);
      return { projectId: service.projectId, usage: null };
    }
  }));
  const totals: Record<string, number | null> = {};
  for (const projectId of new Set(services.map((s) => s.projectId))) {
    const project = results.filter((r) => r.projectId === projectId);
    totals[projectId] = volumes === null || project.some((r) => r.usage === null)
      ? null
      : totalVolumeUsage(project.flatMap((r) => r.usage ?? []));
  }
  return totals;
}
