import "server-only";
import Docker from "dockerode";
import type { PreviewRecord } from "./pr-previews";

/** Dokploy deletes its row before best-effort cleanup. Finish any local leftovers
 * on retries, requiring both our unguessable marker and its compose project. */
export async function cleanupPreviewContainers(preview: PreviewRecord): Promise<void> {
  if (!preview.appName) return;
  const docker = new Docker({ socketPath: process.env.DOCKER_SOCKET ?? "/var/run/docker.sock", timeout: 5000 });
  const labels = [`com.docker.compose.project=${preview.appName}`, `io.switchyard.preview=${preview.marker}`];
  const containers = await docker.listContainers({ all: true, filters: { label: labels } });
  for (const container of containers) {
    if (container.Labels["io.switchyard.preview"] !== preview.marker ||
      container.Labels["com.docker.compose.project"] !== preview.appName) throw new Error("Preview ownership changed.");
    // v removes only anonymous volumes attached to this owned container.
    await docker.getContainer(container.Id).remove({ force: true, v: true });
  }
  const volumes = await docker.listVolumes({ filters: { label: labels } });
  for (const volume of volumes.Volumes ?? []) {
    if (volume.Labels?.["io.switchyard.preview"] !== preview.marker ||
      volume.Labels?.["com.docker.compose.project"] !== preview.appName) throw new Error("Preview ownership changed.");
    await docker.getVolume(volume.Name).remove();
  }
}
