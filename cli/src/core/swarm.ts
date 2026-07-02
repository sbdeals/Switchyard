import { docker, dockerOk, parseJsonLines } from "./docker.js";
import { sleep } from "./util.js";

export interface PublishedPort {
  Protocol: string;
  TargetPort: number;
  PublishedPort: number;
  PublishMode: string;
}

export async function serviceExists(name: string): Promise<boolean> {
  return dockerOk(["service", "inspect", name]);
}

/** The host port a Swarm service publishes for a target port, if any. */
export async function servicePublishedPort(
  name: string,
  targetPort = 3000,
): Promise<PublishedPort | null> {
  const res = await docker([
    "service",
    "inspect",
    name,
    "--format",
    "{{ json .Spec.EndpointSpec.Ports }}",
  ]);
  if (res.code !== 0) return null;
  const txt = res.stdout.trim();
  if (!txt || txt === "null") return null;
  try {
    const ports = JSON.parse(txt) as PublishedPort[];
    return ports.find((p) => p.TargetPort === targetPort) ?? null;
  } catch {
    return null;
  }
}

interface ServiceLsRow {
  Name: string;
  Replicas: string; // "1/1"
}

/** Poll `docker service ls` until every named service reports n/n (n > 0). */
export async function waitServicesConverged(
  names: string[],
  timeoutMs: number,
  onTick?: (pending: string[]) => void,
): Promise<boolean> {
  const start = Date.now();
  for (;;) {
    const res = await docker(["service", "ls", "--format", "json"]);
    if (res.code === 0) {
      const rows = parseJsonLines<ServiceLsRow>(res.stdout);
      const pending = names.filter((n) => {
        const row = rows.find((r) => r.Name === n);
        if (!row) return true;
        const m = /^(\d+)\/(\d+)$/.exec(row.Replicas);
        return !m || m[1] !== m[2] || m[2] === "0";
      });
      if (pending.length === 0) return true;
      onTick?.(pending);
    }
    if (Date.now() - start >= timeoutMs) return false;
    await sleep(3000);
  }
}
