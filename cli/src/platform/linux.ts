import { chmodSync, existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { docker, runInherit } from "../core/docker.js";
import { UserError } from "../core/errors.js";
import { servicePublishedPort } from "../core/swarm.js";
import type { PlatformModule } from "./types.js";

export function isRoot(): boolean {
  return typeof process.getuid === "function" && process.getuid() === 0;
}

/**
 * The launch scripts ship inside the npm package (cli/scripts, copied at pack
 * time); in a repo checkout they live at the repo root. dist/cli.js resolves:
 *   <pkg>/dist/../scripts        published package
 *   <pkg>/dist/../../scripts     repo checkout (cli/dist -> repo/scripts)
 */
export function bundledScriptsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const candidate of [join(here, "..", "scripts"), join(here, "..", "..", "scripts")]) {
    if (existsSync(join(candidate, "dokploy-up.sh"))) {
      // Packages built on Windows ship without exec bits; the scripts
      // exec/source each other, so restore them (best-effort).
      try {
        for (const name of readdirSync(candidate)) {
          if (name.endsWith(".sh")) chmodSync(join(candidate, name), 0o755);
        }
      } catch {
        /* read-only installs still work: everything is invoked via bash */
      }
      return candidate;
    }
  }
  throw new UserError(
    "Could not locate the bundled launch scripts (dokploy-up.sh) — the package looks corrupted.",
  );
}

/** Run `bash script` as root, passing env as sudo VAR=val args when needed. */
async function runScript(script: string, envPairs: string[], scriptArgs: string[] = []): Promise<number> {
  if (isRoot()) {
    const env = { ...process.env };
    for (const pair of envPairs) {
      const idx = pair.indexOf("=");
      env[pair.slice(0, idx)] = pair.slice(idx + 1);
    }
    return runInherit("bash", [script, ...scriptArgs], { env });
  }
  // `sudo VAR=val bash script` — the documented pattern; works regardless of
  // sudoers env_reset policy.
  return runInherit("sudo", [...envPairs, "bash", script, ...scriptArgs]);
}

export const linuxPlatform: PlatformModule = {
  name: "linux",

  async ensureDokploy(cfg, opts, log) {
    const script = join(bundledScriptsDir(), "dokploy-up.sh");
    // NB: no DOKPLOY_PORT here — the upstream installer always lands on 3000
    // and the script's own health wait must poll 3000; we re-publish onto the
    // configured port right after (and the CLI polls the final port itself).
    const envPairs: string[] = [];
    if (opts.force) envPairs.push("FORCE=1");
    // Documented knobs pass straight through when set in the environment.
    for (const key of ["ADVERTISE_ADDR", "DOKPLOY_VERSION"]) {
      const val = process.env[key];
      if (val) envPairs.push(`${key}=${val}`);
    }

    log(`Launching the Dokploy stack via ${script} ...`);
    const code = await runScript(script, envPairs);
    if (code !== 0) {
      throw new UserError(
        "The Dokploy launcher failed (see output above).\n" +
          "If it refused over a leftover dokploy-postgres volume: `switchyard down --purge` for a fresh slate, or re-run with --force to keep the old data.",
      );
    }

    // The upstream installer always publishes host-mode 3000; converge on the
    // configured port when it differs.
    if (cfg.dokployPort !== 3000) {
      const current = await servicePublishedPort("dokploy");
      if (!current || current.PublishedPort !== cfg.dokployPort) {
        log(`Re-publishing Dokploy on port ${cfg.dokployPort} ...`);
        const args = ["service", "update"];
        if (current) args.push("--publish-rm", String(current.PublishedPort));
        args.push("--publish-add", `mode=host,published=${cfg.dokployPort},target=3000`, "dokploy");
        const res = await docker(args);
        if (res.code !== 0) {
          throw new UserError(`Failed to re-publish dokploy on port ${cfg.dokployPort}:\n${res.stderr.trim()}`);
        }
      }
    }

    if (cfg.skipTraefik) {
      // Fresh installs create it; converge by removing. Idempotent re-runs
      // short-circuit inside dokploy-up.sh and never recreate it.
      await docker(["rm", "-f", "dokploy-traefik"]);
    }
  },

  async localIngress(action, cfg, log) {
    const script = join(bundledScriptsDir(), "local-ingress.sh");
    if (action === "up") {
      // Honor the exposure model: 127.0.0.1 by default, all interfaces only
      // when the stack is explicitly exposed. TRAEFIK_IMAGE passes through.
      const envPairs = [`BIND_ADDR=${cfg.expose ? "0.0.0.0" : "127.0.0.1"}`];
      if (process.env.TRAEFIK_IMAGE) envPairs.push(`TRAEFIK_IMAGE=${process.env.TRAEFIK_IMAGE}`);
      log(`Starting local ingress via ${script} ...`);
      const code = await runScript(script, envPairs, [
        "up",
        String(cfg.localIngressHttpPort),
        String(cfg.localIngressHttpsPort),
      ]);
      if (code !== 0) throw new UserError("local-ingress.sh up failed (see output above).");
    } else {
      log(`Stopping local ingress via ${script} ...`);
      const code = await runScript(script, [], ["down"]);
      if (code !== 0) throw new UserError("local-ingress.sh down failed (see output above).");
    }
  },

  async downDokploy(opts, log) {
    const script = join(bundledScriptsDir(), "dokploy-down.sh");
    log(`Stopping the Dokploy stack via ${script} ...`);
    const code = await runScript(script, [], opts.purge ? ["--purge"] : []);
    if (code !== 0) throw new UserError("dokploy-down.sh failed (see output above).");
  },
};
