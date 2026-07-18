import { loadConfig, saveConfig } from "../core/config.js";
import { probeDocker } from "../core/docker.js";
import { UserError } from "../core/errors.js";
import { p, pc } from "../core/prompts.js";
import { platformFor } from "../platform/index.js";
import { CLI_VERSION } from "../version.js";

/**
 * `switchyard local-ingress <up|down>` — opt-in, best-effort local ingress.
 * Runs a second Traefik on alternate host ports (default 8080/8443) that
 * reuses Dokploy's generated config, so domains route locally over plain HTTP.
 * NOT real TLS: real HTTPS custom domains need a Linux host on 80/443 or a
 * tunnel. The chosen state is persisted (`localIngress`), so `switchyard up`
 * re-converges it after a reboot.
 */
export async function localIngressCommand(action: string): Promise<void> {
  if (action !== "up" && action !== "down") {
    throw new UserError(`Unknown action: ${action} (expected up|down)`);
  }
  p.intro(pc.bold(`switchyard v${CLI_VERSION} — local-ingress ${action}`));

  const { config: cfg, path } = loadConfig();

  if ((await probeDocker()).availability !== "ok") {
    throw new UserError(
      cfg.platform === "docker-desktop"
        ? process.platform === "darwin"
          ? "Docker isn't reachable — start your engine (Docker Desktop, OrbStack, or `colima start`) and retry."
          : "Docker isn't reachable — start Docker Desktop and retry."
        : "Docker isn't reachable — start Docker and retry.",
    );
  }

  // Persist intent first so `switchyard up` converges to the same state.
  cfg.localIngress = action === "up";
  saveConfig(cfg, path);

  const platform = platformFor(cfg.platform);
  await platform.localIngress(action, cfg, (m) => p.log.step(m));

  if (action === "up") {
    p.log.warn(
      "HTTP only — this is NOT real TLS. Real HTTPS custom domains need a Linux host on 80/443 or a tunnel (cloudflared).",
    );
    p.note(
      [
        `Ingress    http://${cfg.expose ? "<this-machine's-ip>" : "127.0.0.1"}:${cfg.localIngressHttpPort}`,
        ``,
        `Point a domain at 127.0.0.1 (add it to your hosts file), attach it to an`,
        `app in the dashboard with certificate "None" + HTTPS off, then open it at`,
        `http://<host>:${cfg.localIngressHttpPort}.`,
      ].join("\n"),
      "Local ingress up",
    );
    p.outro("Local ingress running. Stop it with `switchyard local-ingress down`.");
  } else {
    p.outro("Local ingress stopped.");
  }
}
