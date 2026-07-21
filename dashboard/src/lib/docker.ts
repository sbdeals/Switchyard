/**
 * Server-only Docker access for live logs and metrics.
 *
 * Our BFF runs on the host with access to the Docker socket (the same one
 * Dokploy uses), so we read container logs and stats straight from the Docker
 * API instead of reverse-engineering Dokploy's WebSocket transport. A Dokploy
 * service's `appName` is the prefix of its Swarm task container name.
 */
import "server-only";
import Docker from "dockerode";
import type { Duplex } from "node:stream";

const socketPath = process.env.DOCKER_SOCKET ?? "/var/run/docker.sock";
const docker = new Docker({ socketPath });

/**
 * Default ceiling for a one-shot Docker API call (list/logs/stats/inspect/exec
 * setup). These are single request/response round-trips over the socket; if the
 * daemon is wedged (mid-restart, socket stalled, host under load) they can
 * otherwise never settle and hang whatever awaits them — e.g. the agent's tool
 * loop, which awaits each tool inline. Overridable via DOCKER_OP_TIMEOUT_MS.
 */
const DOCKER_OP_TIMEOUT_MS = Number(process.env.DOCKER_OP_TIMEOUT_MS) || 12_000;

/** Thrown when a bounded Docker call exceeds its deadline. */
export class DockerTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DockerTimeoutError";
  }
}

/**
 * Reject with a DockerTimeoutError if `p` hasn't settled within `ms`. The
 * underlying Docker call isn't truly cancellable, but the caller stops waiting,
 * which is what unblocks the tool loop. A settled promise clears the timer so we
 * don't hold the event loop open.
 */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new DockerTimeoutError(`${label} timed out after ${ms}ms`)),
      ms,
    );
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

// --- runtime truth ----------------------------------------------------------
// Dokploy's applicationStatus/composeStatus is the LAST DEPLOY result — it
// stays "done" (shown as Running) even when the containers no longer exist
// (observed after a Docker Desktop VM reset). These helpers read what is
// actually running from the engine so the UI can tell the truth.

export type RuntimeHealth = "running" | "degraded" | "not-running";

/** What's actually on the engine for one service. */
export interface ServiceRuntime {
  health: RuntimeHealth;
  /** Containers currently in the "running" state. */
  running: number;
  /** Containers that exist for the service (any state). */
  total: number;
}

/** Container states grouped by owner, from one engine sweep. */
export interface RuntimeStates {
  /** com.docker.compose.project label -> container states. */
  compose: Map<string, string[]>;
  /** com.docker.swarm.service.name label -> container states. */
  swarm: Map<string, string[]>;
}

/**
 * One `docker ps -a` over the API, grouped by the labels that tie containers
 * to Dokploy services: compose stacks carry the compose project label
 * (project name = the stack's appName), Swarm tasks carry the service-name
 * label (= the service's appName).
 */
export async function listRuntimeStates(): Promise<RuntimeStates> {
  const containers = await withTimeout(
    docker.listContainers({ all: true }),
    DOCKER_OP_TIMEOUT_MS,
    "runtime sweep",
  );
  const compose = new Map<string, string[]>();
  const swarm = new Map<string, string[]>();
  const push = (map: Map<string, string[]>, key: string, state: string) => {
    const list = map.get(key);
    if (list) list.push(state);
    else map.set(key, [state]);
  };
  for (const c of containers) {
    const labels = c.Labels ?? {};
    const state = (c.State ?? "").toLowerCase();
    const project = labels["com.docker.compose.project"];
    if (project) push(compose, project, state);
    const swarmService = labels["com.docker.swarm.service.name"];
    if (swarmService) push(swarm, swarmService, state);
  }
  return { compose, swarm };
}

/**
 * Collapse a compose stack's container states into a health verdict.
 * "created" or "restarting" containers mean the stack is wedged mid-start
 * (the Docker-Desktop-VM-reset signature) — degraded, not running. A one-shot
 * helper exiting beside running siblings is normal and stays "running".
 */
export function deriveComposeRuntime(states: string[]): ServiceRuntime {
  const total = states.length;
  const running = states.filter((s) => s === "running").length;
  const wedged = states.some((s) => s === "created" || s === "restarting" || s === "dead");
  if (total === 0 || running === 0) return { health: "not-running", running, total };
  if (wedged) return { health: "degraded", running, total };
  return { health: "running", running, total };
}

/**
 * Swarm keeps exited task containers around after restarts/updates, so for
 * Swarm services only running tasks count; leftovers are not "degraded".
 */
export function deriveSwarmRuntime(states: string[]): ServiceRuntime {
  const running = states.filter((s) => s === "running").length;
  if (running > 0) return { health: "running", running, total: running };
  return { health: "not-running", running: 0, total: states.length };
}

/**
 * Demultiplex Docker's log/exec stream format from a fully-buffered response,
 * synchronously. The stream is a sequence of frames:
 *   byte 0     : stream type (0 stdin, 1 stdout, 2 stderr)
 *   bytes 1..3 : zero padding
 *   bytes 4..7 : big-endian uint32 payload length, then <length> payload bytes
 * TTY-enabled containers emit a raw, unframed stream instead; a non-frame header
 * is detected and the whole buffer is returned as raw text. Payload bytes are
 * concatenated and decoded once, so a multi-byte UTF-8 character split across
 * two frames survives.
 *
 * This replaces the previous stream-based demux, which called `out.end()` before
 * the async `modem.demuxStream` had written into `out` — a write-after-end that
 * both threw an unhandled stream error AND left the "end" promise unresolved, so
 * `readRecentLogs` never returned and the caller hung forever.
 */
export function demuxDockerFrames(buf: Buffer): string {
  const parts: Buffer[] = [];
  let off = 0;
  let framed = false;
  while (off + 8 <= buf.length) {
    const type = buf[off];
    if (type > 2 || buf[off + 1] !== 0 || buf[off + 2] !== 0 || buf[off + 3] !== 0) {
      // Not a valid frame header: raw TTY stream (if nothing parsed yet) or
      // trailing garbage after the last good frame.
      if (!framed) return buf.toString("utf8");
      break;
    }
    const len = buf.readUInt32BE(off + 4);
    const start = off + 8;
    const end = Math.min(start + len, buf.length);
    parts.push(buf.subarray(start, end));
    framed = true;
    off = start + len;
  }
  if (!framed) return buf.toString("utf8");
  return Buffer.concat(parts).toString("utf8");
}

/**
 * Resolve a Dokploy appName to its running container id (most recent).
 *
 * When `allowed` is provided, the appName must be one of the caller's known
 * Dokploy-managed services — a defense-in-depth guard (the logs/metrics routes
 * also reject unknown apps up front) so an authed user can't tail arbitrary
 * host containers by name.
 */
export async function findContainerId(
  appName: string,
  allowed?: Set<string>,
): Promise<string | null> {
  if (!appName) return null;
  if (allowed && !allowed.has(appName)) return null;
  const containers = await withTimeout(
    docker.listContainers({ all: false, filters: { name: [appName] } }),
    DOCKER_OP_TIMEOUT_MS,
    `Listing containers for ${appName}`,
  );
  if (containers.length === 0) return null;
  // Prefer an exact task match; otherwise the first running one.
  const match =
    containers.find((c) => c.Names.some((n) => n.replace(/^\//, "").startsWith(appName))) ??
    containers[0];
  return match.Id;
}

export interface LogLine {
  ts: number;
  text: string;
}

/**
 * Follow a container's logs. Returns an async iterator of demuxed text lines
 * plus a `close()` to detach. Docker multiplexes stdout/stderr on one stream.
 */
export async function followLogs(
  appName: string,
  tail = 200,
  allowed?: Set<string>
): Promise<{ stream: NodeJS.ReadableStream; close: () => void } | null> {
  const id = await findContainerId(appName, allowed);
  if (!id) return null;
  const container = docker.getContainer(id);
  const raw = (await container.logs({
    follow: true,
    stdout: true,
    stderr: true,
    tail,
    timestamps: true,
  })) as unknown as Duplex;

  // Demux Docker's multiplexed stream into a single text stream.
  const { PassThrough } = await import("node:stream");
  const out = new PassThrough();
  container.modem.demuxStream(raw, out, out);
  raw.on("end", () => out.end());
  raw.on("error", (e: Error) => out.destroy(e));

  return {
    stream: out,
    close: () => {
      try {
        (raw as Duplex).destroy();
      } catch {
        /* ignore */
      }
    },
  };
}

export interface Sample {
  ts: number;
  cpu: number; // percent
  memUsed: number; // bytes
  memLimit: number; // bytes
  memPct: number; // percent
}

function toSample(s: Docker.ContainerStats): Sample {
  const cpuDelta = s.cpu_stats.cpu_usage.total_usage - s.precpu_stats.cpu_usage.total_usage;
  const sysDelta = (s.cpu_stats.system_cpu_usage ?? 0) - (s.precpu_stats.system_cpu_usage ?? 0);
  const cpus =
    s.cpu_stats.online_cpus || s.cpu_stats.cpu_usage.percpu_usage?.length || 1;
  const cpu = sysDelta > 0 && cpuDelta > 0 ? (cpuDelta / sysDelta) * cpus * 100 : 0;

  const cache = (s.memory_stats.stats as Record<string, number> | undefined)?.cache ?? 0;
  const memUsed = Math.max(0, (s.memory_stats.usage ?? 0) - cache);
  const memLimit = s.memory_stats.limit ?? 0;
  const memPct = memLimit > 0 ? (memUsed / memLimit) * 100 : 0;

  return { ts: Date.now(), cpu: Math.round(cpu * 100) / 100, memUsed, memLimit, memPct };
}

/** Stream resource samples for a container. */
export async function followStats(
  appName: string,
  allowed?: Set<string>
): Promise<{ stream: NodeJS.ReadableStream; close: () => void; toSample: typeof toSample } | null> {
  const id = await findContainerId(appName, allowed);
  if (!id) return null;
  const container = docker.getContainer(id);
  const raw = (await container.stats({ stream: true })) as unknown as NodeJS.ReadableStream;
  return {
    stream: raw,
    close: () => {
      try {
        (raw as Duplex).destroy();
      } catch {
        /* ignore */
      }
    },
    toSample,
  };
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  truncated: boolean;
}

/**
 * Run a single command inside a container (non-interactive) and return its
 * captured output. We use `sh -c` — the most universal shell — so pipes and
 * builtins work; images without even `sh` surface Docker's "exec failed" error,
 * which the caller relays. `Tty:false` keeps stdout/stderr on Docker's
 * multiplexed frame format so we can demux them apart. Output is capped and the
 * exec is abandoned after `timeoutMs` to bound a runaway command.
 *
 * Returns null when the appName resolves to no running container. Callers are
 * responsible for the security check (only exec into Dokploy-managed services);
 * this helper trusts its inputs.
 */
export async function runExec(
  appName: string,
  command: string,
  opts: { timeoutMs?: number; maxBytes?: number } = {}
): Promise<ExecResult | null> {
  const id = await findContainerId(appName);
  if (!id) return null;
  const { timeoutMs = 15_000, maxBytes = 1_000_000 } = opts;
  const container = docker.getContainer(id);

  const exec = await withTimeout(
    container.exec({
      Cmd: ["sh", "-c", command],
      AttachStdin: false,
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
    }),
    DOCKER_OP_TIMEOUT_MS,
    `Creating exec in ${appName}`,
  );
  const stream: Duplex = await withTimeout(
    exec.start({ hijack: true, stdin: false }),
    DOCKER_OP_TIMEOUT_MS,
    `Starting exec in ${appName}`,
  );

  const { PassThrough } = await import("node:stream");
  const outS = new PassThrough();
  const errS = new PassThrough();
  container.modem.demuxStream(stream, outS, errS);

  let stdout = "";
  let stderr = "";
  let total = 0;
  let truncated = false;
  const collect = (s: NodeJS.ReadableStream, append: (t: string) => void) =>
    s.on("data", (c: Buffer) => {
      if (total >= maxBytes) {
        truncated = true;
        return;
      }
      total += c.length;
      append(c.toString("utf8"));
    });
  collect(outS, (t) => (stdout += t));
  collect(errS, (t) => (stderr += t));

  await new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      truncated = true;
      try {
        stream.destroy();
      } catch {
        /* ignore */
      }
      finish();
    }, timeoutMs);
    stream.on("end", finish);
    stream.on("close", finish);
    stream.on("error", finish);
  });

  let exitCode: number | null = null;
  try {
    exitCode = (await withTimeout(exec.inspect(), DOCKER_OP_TIMEOUT_MS, `Inspecting exec in ${appName}`)).ExitCode ?? null;
  } catch {
    /* exec/container already gone, or inspect timed out */
  }

  return { stdout, stderr, exitCode, truncated };
}

export { toSample };

// --- one-shot reads for the server-side collector ---------------------------
// The streaming helpers above power the live SSE tabs. The collector samples
// periodically for every known service (tab open or not), so it needs a single
// read rather than a long-lived stream.

/** Take one resource sample, or null if the container isn't running. */
export async function sampleStatsOnce(appName: string): Promise<Sample | null> {
  const id = await findContainerId(appName);
  if (!id) return null;
  const container = docker.getContainer(id);
  // stream:false returns one stats object with precpu_stats populated, so the
  // CPU delta in toSample() is meaningful. Bounded so a stalled daemon can't
  // hang a get_metrics tool call (or the background collector).
  const stats = (await withTimeout(
    container.stats({ stream: false }),
    DOCKER_OP_TIMEOUT_MS,
    `Sampling stats for ${appName}`,
  )) as unknown as Docker.ContainerStats;
  return toSample(stats);
}

export interface ContainerHealth {
  /** A container matching the appName is running. */
  running: boolean;
  /** Docker state: running | restarting | exited | dead | created | paused | null. */
  state: string | null;
  /** Docker RestartCount, or null when no container exists. */
  restartCount: number | null;
}

/** Inspect the current task container for crash-loop signals. */
export async function containerHealth(appName: string): Promise<ContainerHealth> {
  const id = await findContainerId(appName);
  if (!id) return { running: false, state: null, restartCount: null };
  try {
    const info = await withTimeout(
      docker.getContainer(id).inspect(),
      DOCKER_OP_TIMEOUT_MS,
      `Inspecting ${appName}`,
    );
    return {
      running: info.State?.Running ?? false,
      state: info.State?.Status ?? null,
      restartCount: info.RestartCount ?? null,
    };
  } catch {
    return { running: false, state: null, restartCount: null };
  }
}

/** Read the last `tail` log lines (non-following), demuxed and timestamp-split. */
export async function readRecentLogs(appName: string, tail = 200): Promise<LogLine[]> {
  const id = await findContainerId(appName);
  if (!id) return [];
  const container = docker.getContainer(id);
  // follow:false returns the whole log slice as one Buffer, so we demux it
  // synchronously (see demuxDockerFrames) rather than through a stream. The
  // daemon call is bounded so a wedged container can't hang the caller.
  const buf = (await withTimeout(
    container.logs({
      follow: false,
      stdout: true,
      stderr: true,
      tail,
      timestamps: true,
    }),
    DOCKER_OP_TIMEOUT_MS,
    `Reading logs for ${appName}`,
  )) as unknown as Buffer;

  return demuxDockerFrames(Buffer.isBuffer(buf) ? buf : Buffer.from(buf))
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((line) => {
      const m = line.match(/^(\S+)\s([\s\S]*)$/);
      const parsed = m ? Date.parse(m[1]) : NaN;
      const ts = Number.isNaN(parsed) ? Date.now() : parsed;
      return { ts, text: m ? m[2] : line };
    });
}
