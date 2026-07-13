import type { SwitchyardConfig } from "../core/config.js";
import { loadConfig, saveConfig } from "../core/config.js";
import { docker, dockerAvailability, dockerOk, run, runInherit } from "../core/docker.js";
import { signInProbe, signUp, waitHttpReady } from "../core/dokploy-api.js";
import { UserError } from "../core/errors.js";
import { nextFreePort, portFree } from "../core/ports.js";
import { askConfirm, askPassword, askText, p, pc } from "../core/prompts.js";
import { serviceExists, servicePublishedPort } from "../core/swarm.js";
import {
  CONTAINER_NAME,
  ensureSwitchyard,
  waitSwitchyardHealthy,
} from "../core/switchyard-container.js";
import { generatePassword, isValidEmail, randomSecret } from "../core/util.js";
import { isRoot } from "../platform/linux.js";
import { platformFor } from "../platform/index.js";
import { CLI_VERSION } from "../version.js";

export interface UpFlags {
  dokployPort?: number;
  dashboardPort?: number;
  expose?: boolean;
  skipTraefik?: boolean;
  tag?: string;
  email?: string;
  password?: string;
  adminName?: string;
  headless?: boolean;
  /** commander maps --no-claude to claude:false */
  claude?: boolean;
  force?: boolean;
  yes?: boolean;
}

const log = (msg: string): void => p.log.step(msg);
const info = (msg: string): void => p.log.info(msg);
const warn = (msg: string): void => p.log.warn(msg);
const ok = (msg: string): void => p.log.success(msg);

export async function upCommand(flags: UpFlags): Promise<void> {
  const interactive = !flags.headless && process.stdin.isTTY === true && process.stdout.isTTY === true;
  p.intro(pc.bold(`switchyard v${CLI_VERSION}`));
  if (!interactive && !flags.headless) {
    info("No TTY detected — running headless.");
  }

  const loaded = loadConfig();
  const cfg = loaded.config;
  overlayFlags(cfg, flags);

  // Seed the dashboard's session-signing secret once (CSPRNG). Persisted so the
  // config-hash stays stable across re-runs — regenerating it would log users
  // out and force a container recreate on every `up`.
  if (!cfg.sessionSecret) cfg.sessionSecret = randomSecret();

  // The dashboard now requires a Dokploy login, but exposing it is still a real
  // decision — a login gate is not TLS, and it fronts full Dokploy admin.
  if (cfg.expose) {
    warn("--expose publishes the dashboard on ALL interfaces. It requires a Dokploy login, but there's no TLS and a valid login grants full Dokploy admin — only expose it on a trusted network or behind an HTTPS proxy.");
    if (interactive && !flags.yes) {
      if (!(await askConfirm({ message: "Expose the dashboard anyway?", initialValue: false }))) {
        cfg.expose = false;
        info("Keeping the dashboard on 127.0.0.1.");
      }
    } else if (!flags.yes) {
      throw new UserError("--expose in headless mode requires --yes to confirm.");
    }
  }

  const platform = platformFor(cfg.platform);

  // ---- prerequisites ---------------------------------------------------
  const avail = await dockerAvailability();
  if (avail === "no-cli") {
    throw new UserError(
      cfg.platform === "linux"
        ? "Docker CLI not found. Install Docker first (curl -fsSL https://get.docker.com | sh) — or use the repo's install.sh, which does it for you."
        : "Docker CLI not found. Install Docker Desktop (https://docs.docker.com/desktop/) and re-run.",
    );
  }
  if (avail === "no-daemon") {
    if (cfg.platform === "docker-desktop") {
      throw new UserError("Docker isn't running. Start Docker Desktop, wait for it to settle, and re-run `switchyard up`.");
    }
    if (!isRoot()) {
      throw new UserError(
        "The Docker daemon isn't running and starting it needs root.\nRe-run as root: sudo npx switchyard-cli up",
      );
    }
    warn("Docker daemon not running — the launcher will start it.");
  }
  const daemonUp = avail === "ok";

  // ---- adopt existing installs / catch port conflicts early -------------
  let dokployExists = false;
  if (daemonUp) {
    dokployExists = await serviceExists("dokploy");
    if (dokployExists) {
      const pub = await servicePublishedPort("dokploy");
      if (pub && pub.PublishedPort !== cfg.dokployPort) {
        if (flags.dokployPort !== undefined) {
          warn(
            `Existing install publishes Dokploy on :${pub.PublishedPort}; ignoring --dokploy-port ${flags.dokployPort}. ` +
              `(Tear down with \`switchyard down\` to change it.)`,
          );
        } else {
          info(`Existing Dokploy install found — adopting its published port :${pub.PublishedPort}.`);
        }
        cfg.dokployPort = pub.PublishedPort;
      }
    } else {
      if (!(await portFree(cfg.dokployPort))) {
        cfg.dokployPort = await resolveBusyPort("Dokploy", cfg.dokployPort, "--dokploy-port", interactive);
      }
      if (cfg.platform === "linux" && !cfg.skipTraefik) {
        const busy = (!(await portFree(80)) && 80) || (!(await portFree(443)) && 443);
        if (busy) {
          if (interactive) {
            cfg.skipTraefik = await askConfirm({
              message: `Port ${busy} is already in use (Traefik wants 80/443). Skip Traefik? (Domains won't route.)`,
              initialValue: true,
            });
          } else {
            warn(`Port ${busy} is busy — Traefik may fail to start. Consider --skip-traefik.`);
          }
        }
      }
    }

    const switchyardExists = await dockerOk(["container", "inspect", CONTAINER_NAME]);
    if (!switchyardExists && !(await portFree(cfg.dashboardPort))) {
      cfg.dashboardPort = await resolveBusyPort("the dashboard", cfg.dashboardPort, "--dashboard-port", interactive);
    }
  }

  // ---- fresh install: settle the admin identity before the long wait ----
  if (!cfg.adminEmail || !cfg.adminPassword) {
    if (interactive && !dokployExists) {
      info("Choose the admin account for your new Dokploy install (Switchyard signs in with it).");
      cfg.adminEmail = await askText({
        message: "Admin email",
        placeholder: "you@example.com",
        validate: (v) => (isValidEmail(v) ? undefined : "Enter a valid email address"),
      });
      const pw = await askPassword({
        message: "Admin password (leave blank to generate one)",
        validate: (v) => (v.length === 0 || v.length >= 8 ? undefined : "At least 8 characters (or blank to generate)"),
      });
      cfg.adminPassword = pw || generatePassword();
      if (!pw) info(`Generated admin password: ${pc.bold(cfg.adminPassword)} (also stored in the config file)`);
    } else if (!interactive) {
      if (!cfg.adminEmail) cfg.adminEmail = "admin@switchyard.local";
      if (!cfg.adminPassword) {
        cfg.adminPassword = generatePassword();
        info(`Generated admin credentials: ${cfg.adminEmail} / ${cfg.adminPassword} (stored in the config file)`);
      }
    }
    // interactive + existing install: prompt after Dokploy is reachable.
  }

  saveConfig(cfg, loaded.path);
  info(`Config: ${loaded.path}`);

  // ---- Dokploy ----------------------------------------------------------
  await platform.ensureDokploy(cfg, { force: !!flags.force }, log);

  const base = `http://localhost:${cfg.dokployPort}`;
  const spin = p.spinner();
  spin.start(`Waiting for Dokploy at ${base}`);
  const ready = await waitHttpReady(base, 5 * 60_000);
  spin.stop(ready ? `Dokploy is answering at ${base}` : `Dokploy did not answer at ${base}`);
  if (!ready) {
    throw new UserError(
      `Dokploy did not serve HTTP on ${base} within 5 minutes.\nInspect it with: docker service ps dokploy --no-trunc && docker service logs dokploy`,
    );
  }

  // ---- admin account -----------------------------------------------------
  await ensureAdmin(cfg, base, interactive);
  saveConfig(cfg, loaded.path);

  // ---- Switchyard container ----------------------------------------------
  const result = await ensureSwitchyard(cfg, CLI_VERSION, log);
  ok(
    result === "unchanged"
      ? "Switchyard container already up to date."
      : `Switchyard container ${result}.`,
  );

  const spin2 = p.spinner();
  spin2.start("Waiting for the dashboard to become healthy");
  const health = await waitSwitchyardHealthy(cfg.dashboardPort);
  spin2.stop(health.deep ? "Dashboard is healthy (Dokploy reachable end to end)" : "Dashboard health check incomplete");
  if (!health.shallow) {
    throw new UserError(
      `The Switchyard container did not answer on http://127.0.0.1:${cfg.dashboardPort}/api/health.\nCheck: docker logs ${CONTAINER_NAME}`,
    );
  }
  if (!health.deep) {
    const err = health.deepError ?? "unknown error";
    const remedy = /origin/i.test(err)
      ? `Dokploy rejected the request origin. The container presents http://localhost:${cfg.dokployPort} — if you changed Dokploy's port or domain, re-run \`switchyard up\` so it converges.`
      : /sign-in|401|403|credential/i.test(err)
        ? `Dokploy rejected the stored admin credentials.\nFix them with: switchyard config set adminEmail <email> && switchyard config set adminPassword <password>`
        : `The container could not reach Dokploy at ${cfg.dokployUrlInContainer}.\nIf service DNS doesn't resolve in your setup, point it at the host instead:\n  switchyard config set dokployUrlInContainer http://host.docker.internal:${cfg.dokployPort}`;
    throw new UserError(`Dashboard is running but can't talk to Dokploy (${err}).\n${remedy}`);
  }

  // ---- Claude Code (optional) ---------------------------------------------
  if (interactive && flags.claude !== false) {
    await claudeStep();
  }

  // ---- summary -------------------------------------------------------------
  const dashHost = cfg.expose ? "<this-machine's-ip>" : "127.0.0.1";
  p.note(
    [
      `Dokploy     ${base}`,
      `Switchyard  http://${dashHost}:${cfg.dashboardPort}`,
      `Admin       ${cfg.adminEmail}`,
      `Config      ${loaded.path}`,
      ``,
      `Change a setting   switchyard config set dashboardPort 3101`,
      `Upgrade            npx switchyard-cli@latest up`,
      `Claude Code        switchyard claude`,
    ].join("\n"),
    "Ready",
  );
  p.outro(
    cfg.expose
      ? pc.yellow(`The dashboard is exposed on all interfaces. Sign in at /login with your Dokploy account — ${cfg.adminEmail} works. There's no TLS; put an HTTPS proxy in front for untrusted networks.`)
      : `Dashboard bound to 127.0.0.1. Sign in at /login with your Dokploy account (${cfg.adminEmail}). Remote access: ssh -L ${cfg.dashboardPort}:127.0.0.1:${cfg.dashboardPort} <user>@<server>`,
  );
}

function overlayFlags(cfg: SwitchyardConfig, flags: UpFlags): void {
  if (flags.dokployPort !== undefined) cfg.dokployPort = flags.dokployPort;
  if (flags.dashboardPort !== undefined) cfg.dashboardPort = flags.dashboardPort;
  if (flags.expose) cfg.expose = true;
  if (flags.skipTraefik) cfg.skipTraefik = true;
  if (flags.tag !== undefined) cfg.imageTag = flags.tag;
  if (flags.adminName !== undefined) cfg.adminName = flags.adminName;
  if (flags.email !== undefined) cfg.adminEmail = flags.email;
  if (flags.password !== undefined) cfg.adminPassword = flags.password;
}

async function resolveBusyPort(
  what: string,
  port: number,
  flag: string,
  interactive: boolean,
): Promise<number> {
  const next = await nextFreePort(port + 1);
  if (interactive && next !== null) {
    const use = await askConfirm({
      message: `Port ${port} for ${what} is already in use. Use ${next} instead?`,
      initialValue: true,
    });
    if (use) return next;
    throw new UserError(`Port ${port} is busy. Re-run with ${flag} <free-port>.`);
  }
  throw new UserError(
    `Port ${port} for ${what} is already in use.` +
      (next !== null ? ` Try ${flag} ${next}.` : ` Pass ${flag} <free-port>.`),
  );
}

/**
 * Converge on working admin credentials against a live Dokploy:
 * sign-in with what we know; if that fails, try registering it (fresh
 * install); if registration is rejected the install already has an admin —
 * prompt for the existing credentials (interactive) or fail with guidance.
 */
async function ensureAdmin(cfg: SwitchyardConfig, base: string, interactive: boolean): Promise<void> {
  let lastRejection = "";

  const attempt = async (email: string, password: string): Promise<boolean> => {
    const probe = await signInProbe(base, email, password);
    if (probe === "unreachable") {
      throw new UserError(`Dokploy at ${base} stopped answering during sign-in — check \`docker service logs dokploy\`.`);
    }
    if (probe === "ok") {
      cfg.adminEmail = email;
      cfg.adminPassword = password;
      ok(`Signed into Dokploy as ${email}.`);
      return true;
    }
    const su = await signUp(base, cfg.adminName, email, password);
    if (su.status === "created") {
      cfg.adminEmail = email;
      cfg.adminPassword = password;
      ok(`Admin account created: ${email}`);
      return true;
    }
    if (su.status === "unreachable") {
      throw new UserError(`Dokploy at ${base} stopped answering during registration: ${su.message}`);
    }
    lastRejection = su.message;
    return false;
  };

  if (cfg.adminEmail && cfg.adminPassword) {
    if (await attempt(cfg.adminEmail, cfg.adminPassword)) return;
    if (!interactive) {
      throw new UserError(
        `Could not sign in as ${cfg.adminEmail} and registration was rejected (${lastRejection}).\n` +
          `This Dokploy already has an admin — pass its credentials with --email/--password, or fix the config file.`,
      );
    }
    warn(`Stored credentials for ${cfg.adminEmail} were rejected. This Dokploy already has an admin — enter its credentials.`);
  } else if (!interactive) {
    throw new UserError("No admin credentials available. Re-run with --email and --password.");
  } else {
    info("This Dokploy install already exists — enter its admin credentials (Switchyard signs in with them).");
  }

  for (let i = 0; i < 3; i++) {
    const email = await askText({
      message: "Dokploy admin email",
      initialValue: cfg.adminEmail || undefined,
      validate: (v) => (isValidEmail(v) ? undefined : "Enter a valid email address"),
    });
    const password = await askPassword({ message: "Dokploy admin password" });
    if (await attempt(email, password)) return;
    warn(`Sign-in failed${lastRejection ? ` (registration also rejected: ${lastRejection})` : ""}. Try again.`);
  }
  throw new UserError("Could not authenticate with Dokploy after 3 attempts.");
}

async function claudeStep(): Promise<void> {
  const isWin = process.platform === "win32";
  const version = await run("claude", ["--version"], { shell: isWin });
  if (version.code === 0) {
    info(`Claude Code detected (${version.stdout.trim()}) — run \`switchyard claude\` to launch it.`);
    return;
  }
  const install = await askConfirm({
    message: "Claude Code CLI not found. Install it now? (npm install -g @anthropic-ai/claude-code)",
    initialValue: true,
  });
  if (!install) {
    info("Skipped. Later: npm install -g @anthropic-ai/claude-code");
    return;
  }
  const code = await runInherit("npm", ["install", "-g", "@anthropic-ai/claude-code"], { shell: isWin });
  if (code === 0) {
    ok("Claude Code installed. Run `switchyard claude` to launch it — its first run walks you through sign-in.");
  } else {
    warn("npm install failed — install manually: npm install -g @anthropic-ai/claude-code");
  }
}
