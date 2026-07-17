import { spawn } from "node:child_process";

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

export const docker = (args: string[], opts?: RunOptions): Promise<RunResult> => run("docker", args, opts);

export async function dockerOk(args: string[]): Promise<boolean> {
  return (await docker(args)).code === 0;
}

export const dockerInherit = (args: string[]): Promise<number> => runInherit("docker", args);

export type DockerAvailability = "ok" | "no-cli" | "no-daemon";

export async function dockerAvailability(): Promise<DockerAvailability> {
  const res = await docker(["version", "--format", "{{.Server.Version}}"]);
  if (res.code === 127) return "no-cli";
  if (res.code !== 0) return "no-daemon";
  return "ok";
}

/** `docker <list cmd> --format json` emits NDJSON — one object per line. */
export function parseJsonLines<T>(raw: string): T[] {
  return raw
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as T);
}
