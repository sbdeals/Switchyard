export const AUTOMATIC_PORT_FIXUP_TITLE = "Automatic port fix-up";

export function repoReleaseTiming(deployments: readonly { title: string; createdAt: string }[]) {
  const sorted = [...deployments].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const latest = sorted[0];
  const release = sorted.find((deployment) => deployment.title !== AUTOMATIC_PORT_FIXUP_TITLE) ?? latest;
  return {
    timestamp: release?.createdAt ?? "",
    includesPortFixup: latest?.title === AUTOMATIC_PORT_FIXUP_TITLE,
  };
}
