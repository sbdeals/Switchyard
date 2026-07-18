import { STORE_SERVICE, STORE_VOLUME } from "../core/config.js";
import { docker, dockerInherit, dockerOk } from "../core/docker.js";
import { UserError } from "../core/errors.js";
import { ensureLocalIngress, removeLocalIngress } from "../core/local-ingress.js";
import { serviceExists, waitServicesConverged } from "../core/swarm.js";
import { randomSecret, sleep } from "../core/util.js";
import type { PlatformModule } from "./types.js";

/**
 * Docker Desktop (Windows/macOS) provisioner: a check-then-create
 * transcription of docs/getting-started.md Path B, which was hand-tested on
 * a real Windows 11 machine. Despite the platform name, all it needs is a
 * Docker socket with Swarm support — on macOS, OrbStack and Colima qualify
 * too (both run `docker swarm init` in their VMs) and are auto-adopted by
 * probeDocker() in core/docker.ts. Two deliberate differences from Linux:
 *   - Dokploy publishes in ingress mode (host-mode ports don't reliably
 *     forward to Windows localhost).
 *   - No dnsrr: Docker Desktop's WSL2 kernel ships IPVS, default VIP works.
 */

const SECRETS = ["dokploy_postgres_password", "dokploy_auth_secret"] as const;
const SERVICES = ["dokploy-postgres", "dokploy-redis", "dokploy"] as const;

async function ensureSwarm(): Promise<void> {
  const res = await docker(["info", "--format", "{{ .Swarm.LocalNodeState }}"]);
  if (res.code !== 0) throw new UserError(`docker info failed:\n${res.stderr.trim()}`);
  if (res.stdout.trim() === "active") return;
  const init = await docker(["swarm", "init"]);
  if (init.code !== 0 && !/already part of a swarm/i.test(init.stderr)) {
    throw new UserError(`docker swarm init failed:\n${init.stderr.trim()}`);
  }
}

async function ensureNetwork(): Promise<void> {
  if (await dockerOk(["network", "inspect", "dokploy-network"])) return;
  const res = await docker(["network", "create", "--driver", "overlay", "--attachable", "dokploy-network"]);
  if (res.code !== 0) throw new UserError(`Creating dokploy-network failed:\n${res.stderr.trim()}`);
}

async function ensureSecrets(): Promise<void> {
  for (const name of SECRETS) {
    if (await dockerOk(["secret", "inspect", name])) continue;
    const res = await docker(["secret", "create", name, "-"], { input: randomSecret() });
    if (res.code !== 0) throw new UserError(`Creating secret ${name} failed:\n${res.stderr.trim()}`);
  }
}

/**
 * Swarm rejects tasks whose bind source is missing, and /etc/dokploy lives
 * inside Docker Desktop's Linux VM — pre-create it with a throwaway
 * container (the -v flag auto-creates the path).
 */
async function ensureEtcDokploy(log: (m: string) => void): Promise<void> {
  log("Preparing /etc/dokploy inside the Docker Desktop VM ...");
  const code = await dockerInherit([
    "run",
    "--rm",
    "-v",
    "/etc/dokploy:/mnt/dokploy",
    "alpine",
    "sh",
    "-c",
    "chmod 777 /mnt/dokploy",
  ]);
  if (code !== 0) throw new UserError("Could not pre-create /etc/dokploy inside the Docker Desktop VM.");
}

async function createServices(dokployPort: number, log: (m: string) => void): Promise<void> {
  if (!(await serviceExists("dokploy-postgres"))) {
    log("Creating service dokploy-postgres ...");
    const code = await dockerInherit([
      "service", "create", "--detach", "--name", "dokploy-postgres",
      "--constraint", "node.role==manager",
      "--network", "dokploy-network",
      "--secret", "dokploy_postgres_password",
      "--env", "POSTGRES_USER=dokploy",
      "--env", "POSTGRES_DB=dokploy",
      "--env", "POSTGRES_PASSWORD_FILE=/run/secrets/dokploy_postgres_password",
      "--mount", "type=volume,source=dokploy-postgres,target=/var/lib/postgresql/data",
      "postgres:16",
    ]);
    if (code !== 0) throw new UserError("Creating dokploy-postgres failed.");
  }

  if (!(await serviceExists("dokploy-redis"))) {
    log("Creating service dokploy-redis ...");
    const code = await dockerInherit([
      "service", "create", "--detach", "--name", "dokploy-redis",
      "--constraint", "node.role==manager",
      "--network", "dokploy-network",
      "--mount", "type=volume,source=dokploy-redis,target=/data",
      "redis:7",
    ]);
    if (code !== 0) throw new UserError("Creating dokploy-redis failed.");
  }

  if (!(await serviceExists("dokploy"))) {
    const addrRes = await docker(["node", "inspect", "self", "--format", "{{ .Status.Addr }}"]);
    if (addrRes.code !== 0) throw new UserError(`docker node inspect self failed:\n${addrRes.stderr.trim()}`);
    const advertiseAddr = addrRes.stdout.trim();
    const version = process.env.DOKPLOY_VERSION || "latest";
    log(`Creating service dokploy (published on :${dokployPort}, ingress mode) ...`);
    const code = await dockerInherit([
      "service", "create", "--detach", "--name", "dokploy",
      "--replicas", "1",
      "--constraint", "node.role==manager",
      "--network", "dokploy-network",
      "--secret", "dokploy_postgres_password",
      "--secret", "dokploy_auth_secret",
      "--env", `ADVERTISE_ADDR=${advertiseAddr}`,
      "--env", "POSTGRES_PASSWORD_FILE=/run/secrets/dokploy_postgres_password",
      "--env", "BETTER_AUTH_SECRET_FILE=/run/secrets/dokploy_auth_secret",
      "--mount", "type=bind,source=/var/run/docker.sock,target=/var/run/docker.sock",
      "--mount", "type=bind,source=/etc/dokploy,target=/etc/dokploy",
      "--mount", "type=volume,source=dokploy,target=/root/.docker",
      "--publish", `published=${dokployPort},target=3000`,
      `dokploy/dokploy:${version}`,
    ]);
    if (code !== 0) throw new UserError("Creating the dokploy service failed.");
  }
}

/**
 * Provision the Switchyard-owned metrics Postgres. On Docker Desktop the WSL2
 * kernel ships IPVS, so default VIP routing works — no dnsrr needed (unlike the
 * Linux script). Idempotent: skips when the service already exists.
 */
async function ensureMetricsStore(storePassword: string, log: (m: string) => void): Promise<void> {
  if (await serviceExists(STORE_SERVICE)) return;
  log(`Creating service ${STORE_SERVICE} (metrics store) ...`);
  const code = await dockerInherit([
    "service", "create", "--detach", "--name", STORE_SERVICE,
    "--constraint", "node.role==manager",
    "--network", "dokploy-network",
    "--env", "POSTGRES_USER=switchyard",
    "--env", "POSTGRES_DB=switchyard",
    "--env", `POSTGRES_PASSWORD=${storePassword}`,
    "--mount", `type=volume,source=${STORE_VOLUME},target=/var/lib/postgresql/data`,
    "postgres:16",
  ]);
  if (code !== 0) throw new UserError(`Creating ${STORE_SERVICE} failed.`);
}

export const dockerDesktopPlatform: PlatformModule = {
  name: "docker-desktop",

  async ensureDokploy(cfg, opts, log) {
    await ensureSwarm();
    await ensureNetwork();

    // Same trap the Linux script has: a leftover postgres volume without the
    // matching secrets crash-loops Dokploy on database auth.
    if (!(await serviceExists("dokploy"))) {
      const staleVolume = await dockerOk(["volume", "inspect", "dokploy-postgres"]);
      const havePgSecret = await dockerOk(["secret", "inspect", "dokploy_postgres_password"]);
      if (staleVolume && !havePgSecret && !opts.force) {
        throw new UserError(
          "Found a leftover dokploy-postgres volume from a previous install (its password secret is gone).\n" +
            "Run `switchyard down --purge` for a fresh slate, or re-run with --force to keep the old data.",
        );
      }
    }

    await ensureSecrets();
    await ensureEtcDokploy(log);
    await createServices(cfg.dokployPort, log);

    log("Waiting for services to converge (first image pulls take a while) ...");
    const ok = await waitServicesConverged([...SERVICES], 600_000, (pending) =>
      log(`  still converging: ${pending.join(", ")}`),
    );
    if (!ok) {
      await dockerInherit(["service", "ps", "dokploy", "--no-trunc"]);
      throw new UserError(
        "Services did not converge in time — see the task list above.\n" +
          "A *Rejected* dokploy task with a bind-mount error means /etc/dokploy is missing in the VM; re-run `switchyard up`.",
      );
    }

    if (!cfg.skipTraefik) {
      log("Note: Traefik is not managed on Docker Desktop — domains will not route. (skipTraefik=false is ignored here.)");
    }
    log("Auto-URL is off on Docker Desktop (Traefik is unmanaged) — app deploys won't get a public URL; add a domain manually if you need one.");

    if (cfg.store && cfg.storePassword) {
      await ensureMetricsStore(cfg.storePassword, log);
      const ok = await waitServicesConverged([STORE_SERVICE], 300_000, (pending) =>
        log(`  still converging: ${pending.join(", ")}`),
      );
      if (!ok) throw new UserError(`${STORE_SERVICE} did not converge in time.`);
    }
  },

  async localIngress(action, cfg, log) {
    if (action === "up") {
      const result = await ensureLocalIngress(cfg, log);
      if (result === "unchanged") log("Local ingress already running (unchanged).");
    } else {
      await removeLocalIngress(log);
    }
  },

  async downDokploy(opts, log) {
    for (const svc of SERVICES) {
      log(`Removing service ${svc} ...`);
      await docker(["service", "rm", svc]); // tolerate absence
    }
    log(`Removing service ${STORE_SERVICE} (metrics store) ...`);
    await docker(["service", "rm", STORE_SERVICE]); // tolerate absence
    await docker(["rm", "-f", "dokploy-traefik"]);
    if (opts.purge) {
      log("Purging network, secrets, and volumes ...");
      // `service rm` returns before the task containers are gone; removing
      // the network/volumes too early fails with "in use". Wait for the
      // stack's containers to drain (bounded), then retry the removals.
      const deadline = Date.now() + 60_000;
      for (;;) {
        const ps = await docker([
          "ps",
          "--all",
          "--filter",
          "label=com.docker.swarm.service.name",
          "--format",
          "{{.Label \"com.docker.swarm.service.name\"}}",
        ]);
        const draining = [...SERVICES, STORE_SERVICE];
        const busy = ps.stdout.split(/\r?\n/).some((n) => draining.includes(n.trim()));
        if (!busy || Date.now() > deadline) break;
        await sleep(2000);
      }
      const removals: string[][] = [
        ["network", "rm", "dokploy-network"],
        ...SECRETS.map((s) => ["secret", "rm", s]),
        ...["dokploy", "dokploy-postgres", "dokploy-redis", STORE_VOLUME].map((v) => ["volume", "rm", v]),
      ];
      for (const args of removals) {
        let res = await docker(args);
        for (let i = 0; i < 10 && res.code !== 0 && /in use|has active endpoints/i.test(res.stderr); i++) {
          await sleep(2000);
          res = await docker(args);
        }
        if (res.code !== 0 && !/not found|no such/i.test(res.stderr)) {
          log(`  warning: ${args.join(" ")} failed: ${res.stderr.trim().split("\n")[0]}`);
        }
      }
    }
  },
};
