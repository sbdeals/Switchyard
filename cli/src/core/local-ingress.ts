import type { SwitchyardConfig } from "./config.js";
import { docker, dockerInherit, dockerOk } from "./docker.js";
import { UserError } from "./errors.js";
import { sha256 } from "./util.js";

/**
 * Opt-in LOCAL ingress (Docker Desktop, best-effort): a second Traefik on
 * ALTERNATE host ports that reuses the config Dokploy already generates, so
 * domain routing is demonstrable locally over plain HTTP.
 *
 *   *** THIS IS NOT REAL TLS. ***
 * Let's Encrypt needs a public host answering on 80/443. Real HTTPS custom
 * domains need a Linux host on 80/443 or a tunnel (cloudflared). Off by
 * default; `switchyard local-ingress up` opts in, and `switchyard up`
 * re-converges it when `localIngress` is set.
 *
 * The TS path here drives Docker Desktop; Linux drives scripts/local-ingress.sh
 * (bundled with the CLI). Both produce the same container, so keep them in
 * sync — the container name, network, mounts, and config-hash label match.
 */

export const LOCAL_INGRESS_CONTAINER = "switchyard-traefik";
export const NETWORK_NAME = "dokploy-network";
/** Dokploy writes its Traefik static+dynamic config here (inside the VM on Desktop). */
export const TRAEFIK_DIR = "/etc/dokploy/traefik";
const HASH_LABEL = "switchyard.config-hash";
/** Any Traefik v3 works — Dokploy's dynamic config is standard v3. Matches scripts/local-ingress.sh. */
const DEFAULT_TRAEFIK_IMAGE = "traefik:v3.1.2";

export interface LocalIngressPlan {
  image: string;
  bindHost: string;
  httpPort: number;
  httpsPort: number;
  runArgs: string[];
  /** Fingerprint of everything that affects the running container. */
  hash: string;
}

/**
 * Render the desired `docker run` for the local-ingress Traefik. Deterministic:
 * the hash only changes when config that matters to the container changes,
 * which is what makes `local-ingress up` (and `up`'s convergence) idempotent.
 * Honors the 127.0.0.1-default / --expose model: bound to 127.0.0.1 unless the
 * stack is exposed.
 */
export function renderLocalIngress(cfg: SwitchyardConfig): LocalIngressPlan {
  const image = process.env.TRAEFIK_IMAGE || DEFAULT_TRAEFIK_IMAGE;
  const bindHost = cfg.expose ? "0.0.0.0" : "127.0.0.1";
  const httpPort = cfg.localIngressHttpPort;
  const httpsPort = cfg.localIngressHttpsPort;
  const spec = { image, bindHost, httpPort, httpsPort, network: NETWORK_NAME, dir: TRAEFIK_DIR };
  const hash = sha256(JSON.stringify(spec));
  const runArgs = [
    "run",
    "-d",
    "--name",
    LOCAL_INGRESS_CONTAINER,
    "--restart",
    "unless-stopped",
    "--network",
    NETWORK_NAME,
    "-p",
    `${bindHost}:${httpPort}:80`,
    "-p",
    `${bindHost}:${httpsPort}:443`,
    "-v",
    "/var/run/docker.sock:/var/run/docker.sock:ro",
    "-v",
    `${TRAEFIK_DIR}:${TRAEFIK_DIR}`,
    "-l",
    "switchyard.managed=true",
    "-l",
    `${HASH_LABEL}=${hash}`,
    image,
    `--configFile=${TRAEFIK_DIR}/traefik.yml`,
  ];
  return { image, bindHost, httpPort, httpsPort, runArgs, hash };
}

export type EnsureResult = "unchanged" | "created" | "recreated";

/**
 * Provision the local-ingress Traefik on Docker Desktop. Idempotent via the
 * config-hash label; returns "unchanged" when the running container already
 * matches. Throws a UserError with guidance when the network or Dokploy's
 * Traefik config is missing (nothing to serve yet).
 */
export async function ensureLocalIngress(
  cfg: SwitchyardConfig,
  log: (msg: string) => void,
): Promise<EnsureResult> {
  const plan = renderLocalIngress(cfg);

  if (!(await dockerOk(["network", "inspect", NETWORK_NAME]))) {
    throw new UserError(
      `Network ${NETWORK_NAME} is missing — run \`switchyard up\` first, then retry.`,
    );
  }

  // Dokploy writes traefik.yml (+ per-app dynamic config) into TRAEFIK_DIR even
  // when its own proxy is skipped; without it there is nothing to serve. The
  // path lives inside the Docker VM on Desktop — probe it via a throwaway
  // container, not the host filesystem.
  const probe = await docker([
    "run", "--rm", "-v", `${TRAEFIK_DIR}:/mnt`, "alpine", "test", "-f", "/mnt/traefik.yml",
  ]);
  if (probe.code !== 0) {
    throw new UserError(
      `No Traefik config at ${TRAEFIK_DIR}/traefik.yml yet.\n` +
        "Deploy an application in Dokploy first (that makes Dokploy generate the config), then retry.",
    );
  }

  const existing = await docker([
    "inspect",
    LOCAL_INGRESS_CONTAINER,
    "--format",
    `{{ index .Config.Labels "${HASH_LABEL}" }}|{{ .State.Running }}`,
  ]);
  const exists = existing.code === 0;
  if (exists) {
    const [hash, running] = existing.stdout.trim().split("|");
    if (hash === plan.hash && running === "true") return "unchanged";
  }

  const pulled = (await dockerInherit(["pull", plan.image])) === 0;
  if (!pulled && !(await dockerOk(["image", "inspect", plan.image]))) {
    throw new UserError(`Could not pull ${plan.image} and no local copy exists.`);
  }

  if (exists) await docker(["rm", "-f", LOCAL_INGRESS_CONTAINER]);
  log(
    `Starting ${LOCAL_INGRESS_CONTAINER} (${plan.image}) on ${plan.bindHost}:${plan.httpPort} (HTTP) / ${plan.bindHost}:${plan.httpsPort} (HTTPS) ...`,
  );
  const res = await docker(plan.runArgs);
  if (res.code !== 0) {
    throw new UserError(
      `docker run for ${LOCAL_INGRESS_CONTAINER} failed (is host port ${plan.httpPort} or ${plan.httpsPort} already in use?):\n${res.stderr.trim()}`,
    );
  }
  return exists ? "recreated" : "created";
}

/** Remove the local-ingress Traefik. Tolerates absence. */
export async function removeLocalIngress(log: (msg: string) => void): Promise<void> {
  log(`Removing ${LOCAL_INGRESS_CONTAINER} ...`);
  await docker(["rm", "-f", LOCAL_INGRESS_CONTAINER]);
}
