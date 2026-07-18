import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  input?: string;
  env?: NodeJS.ProcessEnv;
  /**
   * Needed on Windows for .cmd shims (npm, claude): Node refuses to spawn
   * them without a shell. Only use with fixed, trusted argument lists.
   */
  shell?: boolean;
}

/**
 * Node deprecated shell:true with an args array (DEP0190) — when a shell is
 * requested, hand it one pre-joined command line instead.
 */
function shellJoin(cmd: string, args: string[]): string {
  return [cmd, ...args.map((a) => (/[\s"']/.test(a) ? `"${a.replaceAll('"', '\\"')}"` : a))].join(" ");
}

/** Spawn and capture. ENOENT resolves as code 127 instead of throwing. */
export function run(cmd: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = opts.shell
      ? spawn(shellJoin(cmd, args), [], { env: opts.env ?? process.env, shell: true, windowsHide: true })
      : spawn(cmd, args, { env: opts.env ?? process.env, windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d) => (stdout += d));
    child.stderr?.on("data", (d) => (stderr += d));
    child.on("error", (err) => resolve({ code: 127, stdout, stderr: String(err) }));
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
    if (opts.input !== undefined) child.stdin?.write(opts.input);
    child.stdin?.end();
  });
}

/**
 * Spawn with the user's terminal attached (progress bars, sudo prompts).
 * windowsHide matters when the caller is a GUI process (the desktop app):
 * without it every docker.exe spawn flashes a console window. In a terminal
 * the child inherits the existing console, so the flag is a no-op there.
 */
export function runInherit(cmd: string, args: string[], opts: Omit<RunOptions, "input"> = {}): Promise<number> {
  return new Promise((resolve) => {
    const child = opts.shell
      ? spawn(shellJoin(cmd, args), [], { stdio: "inherit", env: opts.env ?? process.env, shell: true, windowsHide: true })
      : spawn(cmd, args, { stdio: "inherit", env: opts.env ?? process.env, windowsHide: true });
    child.on("error", () => resolve(127));
    child.on("close", (code) => resolve(code ?? 1));
  });
}

/**
 * How every docker command is invoked. Defaults to `docker` on PATH with the
 * caller's environment; probeDocker() reroutes it (CLI path and/or
 * DOCKER_HOST) when an alternative macOS engine is adopted. Never changes on
 * Linux or Windows.
 */
let dockerCommand = "docker";
let dockerExtraEnv: Record<string, string> = {};

export const docker = (args: string[], opts: RunOptions = {}): Promise<RunResult> =>
  run(dockerCommand, args, { ...opts, env: { ...(opts.env ?? process.env), ...dockerExtraEnv } });

export async function dockerOk(args: string[]): Promise<boolean> {
  return (await docker(args)).code === 0;
}

export const dockerInherit = (args: string[]): Promise<number> =>
  runInherit(dockerCommand, args, { env: { ...process.env, ...dockerExtraEnv } });

export type DockerAvailability = "ok" | "no-cli" | "no-daemon";

export async function dockerAvailability(): Promise<DockerAvailability> {
  const res = await docker(["version", "--format", "{{.Server.Version}}"]);
  if (res.code === 127) return "no-cli";
  if (res.code !== 0) return "no-daemon";
  return "ok";
}

// ---- alternative engines (macOS) ------------------------------------------
// Switchyard needs a Docker daemon with Swarm support — NOT Docker Desktop
// specifically. On macOS, OrbStack and Colima both run Swarm-capable Linux
// VMs (`docker swarm init` works in either), so when the default `docker`
// lookup fails we probe their well-known sockets and adopt the first daemon
// that answers, instead of telling the user to install Docker Desktop.

export interface EngineCandidate {
  name: "OrbStack" | "Colima";
  socketPath: string;
  /** A docker CLI the engine bundles, usable when `docker` isn't on PATH. */
  cliPath?: string;
}

/** Pure: well-known macOS engine locations, probed in order. */
export function darwinEngineCandidates(home: string): EngineCandidate[] {
  return [
    {
      name: "OrbStack",
      socketPath: join(home, ".orbstack", "run", "docker.sock"),
      cliPath: join(home, ".orbstack", "bin", "docker"),
    },
    // Colima relies on a separately installed docker CLI, so no cliPath.
    { name: "Colima", socketPath: join(home, ".colima", "default", "docker.sock") },
  ];
}

/** Pure: the DOCKER_HOST value for a unix socket. */
export function dockerHostUrl(socketPath: string): string {
  return `unix://${socketPath}`;
}

/**
 * Pure: remediation hint when engine sockets exist but none could be adopted.
 * `haveCli` = a docker CLI was available to probe with (on PATH or bundled),
 * so the failure means the daemon behind the socket didn't answer.
 */
export function engineFallbackHint(found: EngineCandidate[], haveCli: boolean): string | undefined {
  const first = found[0];
  if (!first) return undefined;
  const list = found.map((c) => `${c.name} (${c.socketPath})`).join(" and ");
  if (!haveCli) {
    return (
      `Found an engine socket for ${list}, but no docker CLI to drive it. ` +
      "Install one (e.g. `brew install docker`) and re-run — Switchyard will detect the engine automatically."
    );
  }
  return (
    `Found an engine socket for ${list}, but the daemon didn't answer on it. ` +
    "Start the engine (OrbStack: open the app; Colima: `colima start`) and re-run, " +
    `or point docker at it yourself: export DOCKER_HOST=${dockerHostUrl(first.socketPath)}`
  );
}

export interface DockerProbe {
  availability: DockerAvailability;
  /** Set when an alternative engine was adopted for all docker commands. */
  engine?: string;
  /** Remediation hint when not "ok" and a known engine socket was seen. */
  hint?: string;
}

/**
 * dockerAvailability() plus the macOS fallbacks above. Any engine whose
 * daemon answers is accepted; adoption routes every later docker()/
 * dockerInherit() call through the found CLI + DOCKER_HOST. On Linux and
 * Windows this is exactly dockerAvailability().
 */
export async function probeDocker(): Promise<DockerProbe> {
  const availability = await dockerAvailability();
  if (availability === "ok" || process.platform !== "darwin") return { availability };

  const cliOnPath = availability !== "no-cli";
  const present = darwinEngineCandidates(homedir()).filter((c) => existsSync(c.socketPath));
  let haveCli = cliOnPath;
  for (const cand of present) {
    const cli = cliOnPath ? "docker" : cand.cliPath && existsSync(cand.cliPath) ? cand.cliPath : undefined;
    if (!cli) continue;
    haveCli = true;
    const host = dockerHostUrl(cand.socketPath);
    const res = await run(cli, ["version", "--format", "{{.Server.Version}}"], {
      env: { ...process.env, DOCKER_HOST: host },
    });
    if (res.code === 0) {
      dockerCommand = cli;
      dockerExtraEnv = { DOCKER_HOST: host };
      return { availability: "ok", engine: `${cand.name} (DOCKER_HOST=${host})` };
    }
  }
  return { availability, hint: engineFallbackHint(present, haveCli) };
}

/** `docker <list cmd> --format json` emits NDJSON — one object per line. */
export function parseJsonLines<T>(raw: string): T[] {
  return raw
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as T);
}
