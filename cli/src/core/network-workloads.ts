import { STORE_SERVICE } from "./config.js";
import { docker, type RunResult } from "./docker.js";
import { UserError } from "./errors.js";
import { LOCAL_INGRESS_CONTAINER } from "./local-ingress.js";
import { CONTAINER_NAME, NETWORK_NAME } from "./switchyard-container.js";

const SERVICES = new Set(["dokploy", "dokploy-postgres", "dokploy-redis", STORE_SERVICE]);
const CONTAINERS = new Set([CONTAINER_NAME, LOCAL_INGRESS_CONTAINER, "dokploy-traefik"]);

/** A busy network alone is not evidence of workloads: control-plane tasks
 * and stale endpoints can also hold it. Inspect only names and attachments,
 * never service environment variables or secrets. Mirror in dokploy-down.sh. */
export async function networkHasWorkloads(
  runDocker: (args: string[]) => Promise<RunResult> = docker,
): Promise<boolean> {
  async function inspect(args: string[]): Promise<string> {
    const result = await runDocker(args);
    if (result.code !== 0) throw new UserError(`Checking shared-network workloads failed: ${result.stderr.trim()}`);
    return result.stdout.trim();
  }
  const networkId = await inspect(["network", "inspect", NETWORK_NAME, "--format", "{{.Id}}"]);
  if (!networkId) throw new UserError("Could not verify the shared network's identity.");
  const containers = await inspect([
    "ps", "--all", "--filter", `network=${NETWORK_NAME}`,
    "--format", '{{.Names}}\t{{.Label "com.docker.swarm.service.name"}}',
  ]);
  for (const line of containers.split(/\r?\n/).filter(Boolean)) {
    const [name = "", service = ""] = line.split("\t");
    if (!CONTAINERS.has(name) && !SERVICES.has(service)) return true;
  }
  // Local container listings do not include Swarm tasks on other nodes.
  const services = await inspect(["service", "ls", "--format", "{{.Name}}"]);
  for (const name of services.split(/\r?\n/).filter(Boolean)) {
    if (SERVICES.has(name)) continue;
    const networks = await inspect([
      "service", "inspect", name, "--format",
      "{{range .Spec.TaskTemplate.Networks}}{{println .Target}}{{end}}",
    ]);
    if (networks.split(/\s+/).some((target) => target === networkId || target === NETWORK_NAME)) return true;
  }
  return false;
}
