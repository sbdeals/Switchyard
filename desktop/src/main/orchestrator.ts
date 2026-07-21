/**
 * The startup state machine: everything `switchyard up` does, driven headless
 * with a GUI instead of a TTY. Imports the cli's core modules directly — the
 * docker-desktop platform module stays the single source of truth for HOW the
 * stack is provisioned; this file only decides WHEN and renders progress.
 *
 * KEEP IN SYNC with cli/src/commands/up.ts: the flow here is that command with
 * the interactive prompts replaced by wizard/credential pauses and every port
 * conflict auto-resolved.
 */
import { EventEmitter } from "node:events";

import type { SwitchyardConfig } from "../../../cli/src/core/config.js";
import { loadConfig, saveConfig } from "../../../cli/src/core/config.js";
import { docker, dockerAvailability, dockerOk } from "../../../cli/src/core/docker.js";
import { signInProbe, signUp, waitHttpReady } from "../../../cli/src/core/dokploy-api.js";
import { repairComposeStacks } from "../../../cli/src/core/repair.js";
import { UserError } from "../../../cli/src/core/errors.js";
import { LOCAL_INGRESS_CONTAINER } from "../../../cli/src/core/local-ingress.js";
import { nextFreePort, portFree } from "../../../cli/src/core/ports.js";
import { serviceExists, servicePublishedPort } from "../../../cli/src/core/swarm.js";
import {
  CONTAINER_NAME,
  ensureSwitchyard,
  waitSwitchyardHealthy,
} from "../../../cli/src/core/switchyard-container.js";
import { generatePassword, randomSecret } from "../../../cli/src/core/util.js";
import { dockerDesktopPlatform } from "../../../cli/src/platform/docker-desktop.js";
import { CLI_VERSION } from "../../../cli/src/version.js";
import { log, onLog, recentLogs } from "./logging.js";
import * as prereqs from "./prereqs.js";
import { DESKTOP_VERSION } from "./version.js";

export type Phase =
  | "boot" // before the first run() begins
  | "wizard" // waiting on the user in the prereq wizard
  | "starting" // converging the stack
  | "credentials" // waiting for Dokploy admin credentials
  | "error"
  | "ready"
  | "stopped"
  | "working"; // a stop/reset is in flight

export interface Step {
  id: string;
  label: string;
  status: "pending" | "active" | "done" | "failed";
  note?: string;
}

export interface ErrorAction {
  id: string;
  label: string;
  kind?: "primary" | "danger";
}

export interface WizardState {
  kind:
    | "docker-missing"
    | "downloading"
    | "installing"
    | "install-manual"
    | "reboot-required"
    | "start-failed";
  message?: string;
  /** 0..1 while downloading. */
  progress?: number;
  platform: NodeJS.Platform;
  licenseUrl: string;
}

export interface UiState {
  version: string;
  phase: Phase;
  steps: Step[];
  logTail: string[];
  wizard?: WizardState;
  credentials?: { message: string; email?: string };
  error?: { title: string; message: string; detail?: string; actions: ErrorAction[] };
  dashboardUrl?: string;
  dokployUrl?: string;
}

const STEP_DEFS: ReadonlyArray<readonly [string, string]> = [
  ["engine", "Container engine (Docker Desktop)"],
  ["services", "Core services — Dokploy, Postgres, Redis"],
  ["dokploy", "Dokploy API"],
  ["admin", "Admin account"],
  ["dashboard", "Switchyard dashboard"],
];

function freshSteps(): Step[] {
  return STEP_DEFS.map(([id, label]) => ({ id, label, status: "pending" }));
}

export interface ReadyInfo {
  cfg: SwitchyardConfig;
  dashboardUrl: string;
  dokployUrl: string;
}

export class Orchestrator extends EventEmitter {
  private state: UiState = {
    version: DESKTOP_VERSION,
    phase: "boot",
    steps: freshSteps(),
    logTail: [],
  };
  private busy = false;
  private cfg: SwitchyardConfig | null = null;
  private wizardWaiter: ((action: string) => void) | null = null;
  private credWaiter: ((c: { email: string; password: string }) => void) | null = null;

  constructor() {
    super();
    onLog(() => {
      this.state.logTail = recentLogs();
      this.emit("state", this.snapshot());
    });
  }

  snapshot(): UiState {
    return { ...this.state, steps: this.state.steps.map((s) => ({ ...s })) };
  }

  isBusy(): boolean {
    return this.busy;
  }

  currentPhase(): Phase {
    return this.state.phase;
  }

  currentConfig(): SwitchyardConfig | null {
    return this.cfg;
  }

  private set(patch: Partial<UiState>): void {
    this.state = { ...this.state, ...patch };
    this.emit("state", this.snapshot());
  }

  private setStep(id: string, status: Step["status"], note?: string): void {
    this.state.steps = this.state.steps.map((s) => (s.id === id ? { ...s, status, note } : s));
    this.emit("state", this.snapshot());
  }

  private failActiveStep(): void {
    this.state.steps = this.state.steps.map((s) =>
      s.status === "active" ? { ...s, status: "failed" } : s,
    );
  }

  // ---- user actions (from the renderer and the tray) -----------------------

  async handleAction(id: string, payload?: unknown): Promise<void> {
    switch (id) {
      case "retry":
      case "start":
        void this.run();
        return;
      case "forceKeepData":
        void this.run({ force: true });
        return;
      case "freshStart":
        await this.resetAll();
        return;
      case "stop":
        await this.stopStack();
        return;
      case "installDocker":
      case "recheckDocker":
        this.wizardWaiter?.(id);
        return;
      case "submitCredentials": {
        const c = payload as { email?: string; password?: string } | undefined;
        if (c?.email && c?.password) this.credWaiter?.({ email: c.email, password: c.password });
        return;
      }
      default:
        log(`Unknown action: ${id}`);
    }
  }

  // ---- the main flow --------------------------------------------------------

  async run(opts: { force?: boolean } = {}): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      this.state.steps = freshSteps();
      this.set({
        phase: "starting",
        error: undefined,
        wizard: undefined,
        credentials: undefined,
        dashboardUrl: undefined,
      });

      await this.ensureEngine();

      const loaded = loadConfig();
      const cfg = loaded.config;
      this.cfg = cfg;
      if (cfg.platform === "linux") {
        throw new UserError(
          "This desktop app drives Docker Desktop (Windows/macOS). On Linux, use `npx switchyard-cli up`.",
        );
      }
      if (!cfg.sessionSecret) cfg.sessionSecret = randomSecret();

      // Adopt an existing install's ports / auto-resolve conflicts (up.ts,
      // minus the prompts: the desktop app always takes the sensible default).
      this.setStep("services", "active");
      const dokployExists = await serviceExists("dokploy");
      if (dokployExists) {
        const pub = await servicePublishedPort("dokploy");
        if (pub && pub.PublishedPort !== cfg.dokployPort) {
          log(`Existing Dokploy install found — adopting its published port :${pub.PublishedPort}.`);
          cfg.dokployPort = pub.PublishedPort;
        }
      } else if (!(await portFree(cfg.dokployPort))) {
        const next = await nextFreePort(cfg.dokployPort + 1);
        if (next === null) throw new UserError(`No free port near ${cfg.dokployPort} for Dokploy.`);
        log(`Port ${cfg.dokployPort} is busy — publishing Dokploy on :${next} instead.`);
        cfg.dokployPort = next;
      }
      const switchyardExists = await dockerOk(["container", "inspect", CONTAINER_NAME]);
      if (!switchyardExists && !(await portFree(cfg.dashboardPort))) {
        const next = await nextFreePort(cfg.dashboardPort + 1);
        if (next === null) throw new UserError(`No free port near ${cfg.dashboardPort} for the dashboard.`);
        log(`Port ${cfg.dashboardPort} is busy — publishing the dashboard on :${next} instead.`);
        cfg.dashboardPort = next;
      }

      // Fresh installs get a generated admin identity; the Ready screen and
      // config.json both show it (same behavior as the CLI's headless mode).
      if (!cfg.adminEmail) cfg.adminEmail = "admin@switchyard.local";
      if (!cfg.adminPassword) {
        cfg.adminPassword = generatePassword();
        log(`Generated admin credentials: ${cfg.adminEmail} (password stored in the config file).`);
      }
      if (cfg.store && !cfg.storePassword) cfg.storePassword = randomSecret();
      saveConfig(cfg, loaded.path);
      log(`Config: ${loaded.path}`);

      await dockerDesktopPlatform.ensureDokploy(cfg, { force: !!opts.force }, (m) => log(m));
      this.setStep("services", "done");

      this.setStep("dokploy", "active");
      const base = `http://localhost:${cfg.dokployPort}`;
      const ready = await waitHttpReady(base, 5 * 60_000, (elapsed) =>
        this.setStep("dokploy", "active", `waiting ${Math.round(elapsed / 1000)}s ...`),
      );
      if (!ready) {
        throw new UserError(
          `Dokploy did not serve HTTP on ${base} within 5 minutes.\nInspect it with: docker service ps dokploy --no-trunc && docker service logs dokploy`,
        );
      }
      this.setStep("dokploy", "done");

      this.setStep("admin", "active");
      await this.ensureAdmin(cfg, base);
      saveConfig(cfg, loaded.path);
      this.setStep("admin", "done", cfg.adminEmail);

      // Self-heal stacks wedged by a Docker Desktop VM reset (mirrors
      // up.ts — keep the two flows in sync). Never fatal; a no-op when
      // everything is running.
      try {
        const repair = await repairComposeStacks(cfg, (m) => log(m));
        if (repair.repaired.length > 0) {
          log(`Re-deployed ${repair.repaired.length} stack(s) broken by an engine reset: ${repair.repaired.join(", ")}.`);
        }
        for (const failure of repair.failures) log(`Stack repair: ${failure}`);
      } catch (e) {
        log(`Stack repair skipped: ${e instanceof Error ? e.message : e}`);
      }

      this.setStep("dashboard", "active");
      const result = await ensureSwitchyard(cfg, CLI_VERSION, (m) => log(m));
      log(
        result === "unchanged"
          ? "Switchyard container already up to date."
          : `Switchyard container ${result}.`,
      );
      const health = await waitSwitchyardHealthy(cfg.dashboardPort);
      if (!health.shallow) {
        throw new UserError(
          `The Switchyard container did not answer on http://127.0.0.1:${cfg.dashboardPort}/api/health.\nCheck: docker logs ${CONTAINER_NAME}`,
        );
      }
      if (!health.deep) {
        const err = health.deepError ?? "unknown error";
        const remedy = /origin/i.test(err)
          ? `Dokploy rejected the request origin. The container presents http://localhost:${cfg.dokployPort} — if Dokploy's port or domain changed, use "Restart / converge" so it catches up.`
          : /sign-in|401|403|credential/i.test(err)
            ? "Dokploy rejected the stored admin credentials — retry and enter the correct ones when asked."
            : `The container could not reach Dokploy at ${cfg.dokployUrlInContainer}.`;
        throw new UserError(`The dashboard is running but can't talk to Dokploy (${err}).\n${remedy}`);
      }
      this.setStep("dashboard", "done");

      // Opt-in local ingress parity with `up` — never fatal.
      if (cfg.localIngress) {
        try {
          await dockerDesktopPlatform.localIngress("up", cfg, (m) => log(m));
        } catch (e) {
          log(`Local ingress not started (opt-in): ${e instanceof Error ? e.message : e}`);
        }
      }

      const dashboardUrl = `http://127.0.0.1:${cfg.dashboardPort}`;
      log(`Ready — dashboard on ${dashboardUrl}, Dokploy on ${base}.`);
      this.set({ phase: "ready", dashboardUrl, dokployUrl: base });
      this.emit("ready", { cfg, dashboardUrl, dokployUrl: base } satisfies ReadyInfo);
    } catch (e) {
      this.fail(e);
    } finally {
      this.busy = false;
    }
  }

  // ---- prereq wizard ---------------------------------------------------------

  private async ensureEngine(): Promise<void> {
    this.setStep("engine", "active");
    prereqs.augmentPath();
    for (;;) {
      const avail = await dockerAvailability();
      if (avail === "ok") {
        this.setStep("engine", "done");
        return;
      }

      if (avail === "no-daemon" || prereqs.dockerDesktopInstalled()) {
        // Installed but not running (a fresh install lands here too, once
        // augmentPath makes the new CLI visible).
        this.setStep("engine", "active", "starting Docker Desktop ...");
        prereqs.launchDockerDesktop();
        const ok = await prereqs.waitDockerReady(240_000, (elapsed) =>
          this.setStep("engine", "active", `starting Docker Desktop ... ${Math.round(elapsed / 1000)}s`),
        );
        if (ok) {
          this.setStep("engine", "done");
          return;
        }
        await this.showWizard({
          kind: "start-failed",
          platform: process.platform,
          licenseUrl: prereqs.DOCKER_LICENSE_URL,
          message:
            "Docker Desktop did not come up within 4 minutes. Open it manually and finish any first-run prompts (service agreement, WSL setup), then try again.",
        });
        this.set({ phase: "starting", wizard: undefined });
        continue;
      }

      // Not installed: the actual setup wizard.
      const action = await this.showWizard({
        kind: "docker-missing",
        platform: process.platform,
        licenseUrl: prereqs.DOCKER_LICENSE_URL,
      });
      this.set({ phase: "starting" });
      if (action !== "installDocker") continue; // recheck → loop

      try {
        this.set({
          phase: "wizard",
          wizard: {
            kind: "downloading",
            platform: process.platform,
            licenseUrl: prereqs.DOCKER_LICENSE_URL,
            progress: 0,
          },
        });
        const installer = await prereqs.downloadInstaller((fraction) =>
          this.set({ wizard: { ...this.state.wizard!, progress: fraction } }),
        );

        if (process.platform === "win32") {
          this.set({
            wizard: { ...this.state.wizard!, kind: "installing", progress: undefined },
          });
          const code = await prereqs.runInstallerWindows(installer);
          if (code === prereqs.EXIT_REBOOT_REQUIRED) {
            await this.showWizard({
              kind: "reboot-required",
              platform: process.platform,
              licenseUrl: prereqs.DOCKER_LICENSE_URL,
              message:
                "Docker Desktop is installed, but Windows needs a restart to finish enabling its features. Restart your computer, then open Switchyard again.",
            });
            this.set({ phase: "starting", wizard: undefined });
            prereqs.augmentPath();
            continue;
          }
          if (code !== 0) {
            await this.showWizard({
              kind: "docker-missing",
              platform: process.platform,
              licenseUrl: prereqs.DOCKER_LICENSE_URL,
              message: `The installer exited with code ${code}. You can retry, or install Docker Desktop manually and re-check.`,
            });
            this.set({ phase: "starting", wizard: undefined });
            continue;
          }
          prereqs.augmentPath();
          continue; // loop re-detects, then launches the engine
        }

        // macOS
        const macResult = await prereqs.installMacDmg(installer);
        if (macResult === "manual") {
          await this.showWizard({
            kind: "install-manual",
            platform: process.platform,
            licenseUrl: prereqs.DOCKER_LICENSE_URL,
            message:
              "Finder opened the Docker disk image — drag Docker into Applications, then continue.",
          });
          this.set({ phase: "starting", wizard: undefined });
        }
        prereqs.augmentPath();
        continue;
      } catch (e) {
        await this.showWizard({
          kind: "docker-missing",
          platform: process.platform,
          licenseUrl: prereqs.DOCKER_LICENSE_URL,
          message: `Download failed (${e instanceof Error ? e.message : e}). Check your connection and retry, or install Docker Desktop manually and re-check.`,
        });
        this.set({ phase: "starting", wizard: undefined });
        continue;
      }
    }
  }

  private showWizard(wizard: WizardState): Promise<string> {
    this.set({ phase: "wizard", wizard });
    return new Promise((resolve) => {
      this.wizardWaiter = (action) => {
        this.wizardWaiter = null;
        resolve(action);
      };
    });
  }

  // ---- admin account ---------------------------------------------------------

  /** up.ts#ensureAdmin with the terminal prompts swapped for the credentials view. */
  private async ensureAdmin(cfg: SwitchyardConfig, base: string): Promise<void> {
    let lastRejection = "";
    const attempt = async (email: string, password: string): Promise<boolean> => {
      const probe = await signInProbe(base, email, password);
      if (probe === "unreachable") {
        throw new UserError(
          `Dokploy at ${base} stopped answering during sign-in — check \`docker service logs dokploy\`.`,
        );
      }
      if (probe === "ok") {
        cfg.adminEmail = email;
        cfg.adminPassword = password;
        log(`Signed into Dokploy as ${email}.`);
        return true;
      }
      const su = await signUp(base, cfg.adminName || "Admin", email, password);
      if (su.status === "created") {
        cfg.adminEmail = email;
        cfg.adminPassword = password;
        log(`Admin account created: ${email}`);
        return true;
      }
      if (su.status === "unreachable") {
        throw new UserError(`Dokploy at ${base} stopped answering during registration: ${su.message}`);
      }
      lastRejection = su.message;
      return false;
    };

    if (await attempt(cfg.adminEmail, cfg.adminPassword)) return;

    let message =
      `This Dokploy already has an admin, and the stored credentials for ${cfg.adminEmail} were rejected. ` +
      `Enter the existing admin's email and password.`;
    for (;;) {
      const creds = await this.waitForCredentials(message, cfg.adminEmail);
      this.set({ phase: "starting", credentials: undefined });
      if (await attempt(creds.email.trim(), creds.password)) return;
      message = `Sign-in failed${lastRejection ? " (and registration is closed)" : ""}. Try again.`;
    }
  }

  private waitForCredentials(
    message: string,
    email?: string,
  ): Promise<{ email: string; password: string }> {
    this.set({ phase: "credentials", credentials: { message, email } });
    return new Promise((resolve) => {
      this.credWaiter = (c) => {
        this.credWaiter = null;
        resolve(c);
      };
    });
  }

  // ---- stop / reset ------------------------------------------------------------

  async stopStack(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      this.set({ phase: "working", dashboardUrl: undefined, error: undefined });
      log("Stopping the stack (data volumes survive) ...");
      await docker(["rm", "-f", CONTAINER_NAME]);
      await docker(["rm", "-f", LOCAL_INGRESS_CONTAINER]);
      await dockerDesktopPlatform.downDokploy({ purge: false }, (m) => log(m));
      this.state.steps = freshSteps();
      log("Stack stopped.");
      this.set({ phase: "stopped" });
    } catch (e) {
      this.fail(e);
    } finally {
      this.busy = false;
    }
  }

  /** Tear everything down INCLUDING data volumes, then converge from scratch. */
  async resetAll(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      this.set({ phase: "working", dashboardUrl: undefined, error: undefined });
      log("Resetting: removing services, secrets, and data volumes ...");
      await docker(["rm", "-f", CONTAINER_NAME]);
      await docker(["rm", "-f", LOCAL_INGRESS_CONTAINER]);
      await dockerDesktopPlatform.downDokploy({ purge: true }, (m) => log(m));
      // The admin account and metrics store died with their volumes; stale
      // secrets would send the next converge down the wrong path (down.ts).
      const loaded = loadConfig();
      loaded.config.adminEmail = "";
      loaded.config.adminPassword = "";
      loaded.config.storePassword = "";
      saveConfig(loaded.config, loaded.path);
      log("Cleared stored admin credentials (the account was deleted with the data).");
    } catch (e) {
      this.fail(e);
      this.busy = false;
      return;
    }
    this.busy = false;
    void this.run();
  }

  // ---- error handling ------------------------------------------------------------

  private fail(e: unknown): void {
    const message = e instanceof Error ? e.message : String(e);
    log(`ERROR: ${message}`);
    this.failActiveStep();

    let title = "Something needs attention";
    let actions: ErrorAction[] = [
      { id: "retry", label: "Try again", kind: "primary" },
      { id: "logs", label: "View logs" },
    ];
    if (/leftover dokploy-postgres volume/i.test(message)) {
      title = "Data from a previous install";
      actions = [
        { id: "forceKeepData", label: "Keep the old data", kind: "primary" },
        { id: "freshStart", label: "Fresh start (deletes it)", kind: "danger" },
        { id: "logs", label: "View logs" },
      ];
    } else if (/did not converge|did not serve HTTP|did not answer/i.test(message)) {
      title = "The stack is taking too long";
    } else if (/can't talk to Dokploy/i.test(message)) {
      title = "Dashboard can't reach Dokploy";
    }

    this.set({
      phase: "error",
      error: {
        title,
        message,
        detail: recentLogs().slice(-40).join("\n"),
        actions,
      },
    });
  }
}
