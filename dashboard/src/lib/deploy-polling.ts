interface PollingService {
  projectId: string;
  deployments?: { status: string }[];
}

/** Hidden tabs pause; failures slow both idle and active deployment polling. */
export function pollingInterval({
  hidden,
  services,
  projectId,
  failures,
}: {
  hidden: boolean;
  services: PollingService[];
  projectId: string | null;
  failures: number;
}): number | null {
  if (hidden) return null;

  const active = services.some((service) => (
    (projectId === null || service.projectId === projectId)
    && service.deployments?.some(({ status }) => status === "running" || status === "queued")
  ));
  const base = active ? 5_000 : 10_000;
  // Four failures already reach the cap from either base interval.
  const count = Number.isNaN(failures) ? 0 : Math.min(4, Math.max(0, Math.floor(failures)));
  return Math.min(60_000, base * 2 ** count);
}
