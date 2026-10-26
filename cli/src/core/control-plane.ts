import { STORE_SERVICE, STORE_VOLUME } from "./config.js";
import { docker, type RunResult } from "./docker.js";
import { UserError } from "./errors.js";
import { LOCAL_INGRESS_CONTAINER } from "./local-ingress.js";
import { CONTAINER_NAME, NETWORK_NAME } from "./switchyard-container.js";
import { sleep } from "./util.js";

export const CONTROL_PLANE_STOP_NOTICE =
  "Deployed apps, Compose stacks, and databases keep running; their volumes are kept. " +
  "Stopping ingress can make their URLs unavailable.";

export const CONTROL_PLANE_RESET_NOTICE =
  "Deletes Dokploy project/deployment metadata, the admin account, and control-plane data (including metrics). " +
  "Deployed apps, Compose stacks, databases, and their volumes are NOT removed. " +
  "They can keep running but become orphaned from the new Dokploy install. " +
  "For a clean install, remove workloads through Dokploy before resetting.";

type ResourceKind = "container" | "service" | "network" | "secret" | "volume";
export interface ControlPlaneResource {
  kind: ResourceKind;
  name: string;
}

// These exact names are reserved by the existing provisioner, including
// legacy installs without labels. Never infer workload ownership from a name
// prefix, a generic Compose/Swarm label, or membership of the shared network.
const RESOURCES: ControlPlaneResource[] = [
  ...[CONTAINER_NAME, LOCAL_INGRESS_CONTAINER, "dokploy-traefik"].map((name) => ({ kind: "container" as const, name })),
  ...["dokploy", "dokploy-postgres", "dokploy-redis", STORE_SERVICE].map((name) => ({ kind: "service" as const, name })),
  { kind: "network", name: NETWORK_NAME },
  ...["dokploy_postgres_password", "dokploy_auth_secret"].map((name) => ({ kind: "secret" as const, name })),
  ...["dokploy", "dokploy-postgres", "dokploy-redis", STORE_VOLUME].map((name) => ({ kind: "volume" as const, name })),
];

/** Pure inventory -> removals. Workloads and their volumes are never included. */
export function planControlPlaneDown(
  inventory: readonly ControlPlaneResource[],
  purge: boolean,
): ControlPlaneResource[] {
  return RESOURCES.filter((resource) =>
    (purge || resource.kind === "container" || resource.kind === "service") &&
    inventory.some((item) => item.kind === resource.kind && item.name === resource.name),
  ).map((resource) => ({ ...resource }));
}

type DockerRunner = (args: string[]) => Promise<RunResult>;

/** Control plane only; injected I/O lets node:test prove the scope without Docker. */
export async function downControlPlane(
  purge: boolean,
  log: (message: string) => void,
  runDocker: DockerRunner = docker,
  wait: (ms: number) => Promise<void> = sleep,
): Promise<void> {
  const kinds: ResourceKind[] = purge
    ? ["container", "service", "network", "secret", "volume"]
    : ["container", "service"];
  // Finish inventory before the first mutation. A failed listing is not an
  // empty engine, and must not allow a partial reset to look successful.
  const inventory: ControlPlaneResource[] = [];
  for (const kind of kinds) {
    const args = kind === "container"
      ? ["ps", "--all", "--format", "{{.Names}}"]
      : [kind, "ls", "--format", "{{.Name}}"];
    const res = await runDocker(args);
    if (res.code !== 0) throw new UserError(`Listing ${kind}s failed: ${res.stderr.trim()}`);
    for (const name of res.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)) {
      inventory.push({ kind, name });
    }
  }
  const plan = planControlPlaneDown(inventory, purge);
  log(purge ? CONTROL_PLANE_RESET_NOTICE : CONTROL_PLANE_STOP_NOTICE);
  const services = plan.filter((item) => item.kind === "service").map((item) => item.name);
  let drained = false;
  for (const { kind, name } of plan) {
    if (kind !== "container" && kind !== "service" && !drained) {
      // Swarm service removal returns before its task containers disappear.
      for (let attempt = 0; ; attempt++) {
        const ps = await runDocker([
          "ps", "--all", "--filter", "label=com.docker.swarm.service.name",
          "--format", '{{.Label "com.docker.swarm.service.name"}}',
        ]);
        if (ps.code !== 0) throw new UserError(`Checking control-plane tasks failed: ${ps.stderr.trim()}`);
        if (!ps.stdout.split(/\r?\n/).some((line) => services.includes(line.trim()))) break;
        if (attempt === 30) throw new UserError("Control-plane tasks did not stop; data volumes were kept. Retry the reset.");
        await wait(2000);
      }
      drained = true;
    }
    log(`Removing control-plane ${kind} ${name} ...`);
    const args = kind === "container" ? ["rm", "-f", name] : [kind, "rm", name];
    let res = await runDocker(args);
    // Workloads still use this shared network on a control-plane-only reset.
    if (kind === "network" && res.code !== 0 && /in use|has active endpoints/i.test(res.stderr)) {
      log(`Keeping ${name}: it still has attached workloads.`);
      continue;
    }
    for (let i = 0; i < 10 && res.code !== 0 && /in use/i.test(res.stderr); i++) {
      await wait(2000);
      res = await runDocker(args);
    }
    if (res.code !== 0 && !/not found|no such/i.test(res.stderr)) {
      throw new UserError(`Removing control-plane ${kind} ${name} failed: ${res.stderr.trim()}`);
    }
  }
}
