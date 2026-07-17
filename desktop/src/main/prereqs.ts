/**
 * The one prerequisite Switchyard cannot hide: a container engine. This module
 * detects, launches, and (with the user's click in the setup wizard) installs
 * Docker Desktop on Windows/macOS.
 *
 * Install flows:
 *   Windows: download the official installer, run `install --accept-license`
 *            elevated (UAC prompt). Exit 3010 = Windows wants a reboot.
 *   macOS:   download Docker.dmg, try a silent attach+ditto into /Applications;
 *            fall back to opening the DMG for a manual drag-install.
 */
import { spawn } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import { delimiter, join } from "node:path";

import { app } from "electron";

import { dockerAvailability, run } from "../../../cli/src/core/docker.js";
import { sleep } from "../../../cli/src/core/util.js";
import { log } from "./logging.js";

export const DOCKER_LICENSE_URL = "https://www.docker.com/legal/docker-subscription-service-agreement/";
export const DOCKER_INSTALL_DOCS_URL = "https://docs.docker.com/desktop/";

/** Windows exit code for "installed, but a reboot is required". */
export const EXIT_REBOOT_REQUIRED = 3010;

const WIN_APP = "C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe";
const WIN_CLI_DIR = "C:\\Program Files\\Docker\\Docker\\resources\\bin";
const WIN_INSTALLER_URL = "https://desktop.docker.com/win/main/amd64/Docker%20Desktop%20Installer.exe";
const MAC_APP = "/Applications/Docker.app";
const MAC_CLI_DIR = "/Applications/Docker.app/Contents/Resources/bin";

function macInstallerUrl(): string {
  return process.arch === "arm64"
    ? "https://desktop.docker.com/mac/main/arm64/Docker.dmg"
    : "https://desktop.docker.com/mac/main/amd64/Docker.dmg";
}

export function installerUrl(): string {
  return process.platform === "win32" ? WIN_INSTALLER_URL : macInstallerUrl();
}

export function dockerDesktopInstalled(): boolean {
  return process.platform === "win32" ? existsSync(WIN_APP) : existsSync(MAC_APP);
}

/**
 * GUI-launched apps don't inherit the shell's PATH (macOS especially), and a
 * just-installed Docker updated the SYSTEM path, not this process's copy.
 * Splice Docker's CLI locations in so the cli core's `docker` spawns resolve.
 */
export function augmentPath(): void {
  const extras =
    process.platform === "win32"
      ? [WIN_CLI_DIR]
      : [MAC_CLI_DIR, "/usr/local/bin", "/opt/homebrew/bin"];
  const current = process.env.PATH ?? "";
  const parts = current.split(delimiter);
  const missing = extras.filter((dir) => existsSync(dir) && !parts.includes(dir));
  if (missing.length > 0) {
    process.env.PATH = [...missing, current].join(delimiter);
    log(`PATH += ${missing.join(", ")}`);
  }
}

export function launchDockerDesktop(): void {
  log("Starting Docker Desktop ...");
  try {
    if (process.platform === "win32") {
      spawn(WIN_APP, [], { detached: true, stdio: "ignore" }).unref();
    } else {
      // -g: don't steal focus from our own first-run experience.
      spawn("open", ["-g", "-a", "Docker"], { detached: true, stdio: "ignore" }).unref();
    }
  } catch (e) {
    log(`Could not launch Docker Desktop: ${e instanceof Error ? e.message : e}`);
  }
}

/** Poll until the Docker daemon answers. */
export async function waitDockerReady(
  timeoutMs: number,
  onTick?: (elapsedMs: number) => void,
): Promise<boolean> {
  const start = Date.now();
  for (;;) {
    if ((await dockerAvailability()) === "ok") return true;
    const elapsed = Date.now() - start;
    if (elapsed >= timeoutMs) return false;
    onTick?.(elapsed);
    await sleep(3000);
  }
}

/** Stream the official installer to the temp dir, reporting progress 0..1. */
export async function downloadInstaller(onProgress: (fraction: number) => void): Promise<string> {
  const url = installerUrl();
  const dest = join(
    app.getPath("temp"),
    process.platform === "win32" ? "DockerDesktopInstaller.exe" : "Docker.dmg",
  );
  log(`Downloading ${url}`);
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) throw new Error(`Download failed (HTTP ${res.status})`);
  const total = Number(res.headers.get("content-length") ?? 0);
  const reader = res.body.getReader();
  const out = createWriteStream(dest);
  let done = 0;
  try {
    for (;;) {
      const { done: finished, value } = await reader.read();
      if (finished) break;
      if (!out.write(value)) await new Promise<void>((r) => out.once("drain", () => r()));
      done += value.length;
      if (total > 0) onProgress(Math.min(1, done / total));
    }
  } finally {
    await new Promise<void>((resolve) => out.end(resolve));
  }
  log(`Downloaded installer (${Math.round(done / 1024 / 1024)} MB) -> ${dest}`);
  return dest;
}

/**
 * Windows: run the installer elevated. `--accept-license` is passed because
 * the wizard showed the subscription agreement and the user clicked Install.
 */
export async function runInstallerWindows(installerPath: string): Promise<number> {
  log("Running the Docker Desktop installer (Windows will ask for administrator permission) ...");
  const quoted = installerPath.replace(/'/g, "''");
  const cmd =
    `$p = Start-Process -FilePath '${quoted}' -ArgumentList 'install','--accept-license' -Verb RunAs -PassThru -Wait; ` +
    `exit $p.ExitCode`;
  const res = await run("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    cmd,
  ]);
  log(`Installer exited with code ${res.code}${res.stderr.trim() ? ` — ${res.stderr.trim().split("\n")[0]}` : ""}`);
  return res.code;
}

/**
 * macOS: try the silent path (attach the DMG, ditto Docker.app into
 * /Applications — works when the user is an admin); otherwise open the DMG in
 * Finder and let the user drag it themselves.
 */
export async function installMacDmg(dmgPath: string): Promise<"installed" | "manual"> {
  log("Attaching Docker.dmg ...");
  const attach = await run("hdiutil", ["attach", "-nobrowse", "-readonly", dmgPath]);
  if (attach.code === 0) {
    const mount = attach.stdout
      .split("\n")
      .map((l) => /(\/Volumes\/.+)$/.exec(l.trim())?.[1])
      .find((m): m is string => Boolean(m));
    if (mount && existsSync(join(mount, "Docker.app"))) {
      log("Copying Docker.app into /Applications ...");
      const copy = await run("ditto", [join(mount, "Docker.app"), MAC_APP]);
      await run("hdiutil", ["detach", mount]);
      if (copy.code === 0) {
        log("Docker Desktop installed.");
        return "installed";
      }
      log(`Silent copy failed (${copy.stderr.trim().split("\n")[0] ?? copy.code}) — falling back to Finder.`);
    } else if (mount) {
      await run("hdiutil", ["detach", mount]);
    }
  }
  await run("open", [dmgPath]);
  return "manual";
}
