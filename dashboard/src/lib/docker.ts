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
  const containers = await docker.listContainers({
    all: false,
    filters: { name: [appName] },
  });
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

  const exec = await container.exec({
    Cmd: ["sh", "-c", command],
    AttachStdin: false,
    AttachStdout: true,
    AttachStderr: true,
    Tty: false,
  });
  const stream: Duplex = await exec.start({ hijack: true, stdin: false });

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
    exitCode = (await exec.inspect()).ExitCode ?? null;
  } catch {
    /* exec/container already gone */
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
  // CPU delta in toSample() is meaningful.
  const stats = (await container.stats({ stream: false })) as unknown as Docker.ContainerStats;
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
    const info = await docker.getContainer(id).inspect();
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
  const buf = (await container.logs({
    follow: false,
    stdout: true,
    stderr: true,
    tail,
    timestamps: true,
  })) as unknown as Buffer;

  const { PassThrough, Readable } = await import("node:stream");
  const out = new PassThrough();
  const chunks: Buffer[] = [];
  out.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<void>((resolve) => out.on("end", () => resolve()));
  container.modem.demuxStream(Readable.from(buf), out, out);
  out.end();
  await done;

  return Buffer.concat(chunks)
    .toString("utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((line) => {
      const m = line.match(/^(\S+)\s([\s\S]*)$/);
      const parsed = m ? Date.parse(m[1]) : NaN;
      const ts = Number.isNaN(parsed) ? Date.now() : parsed;
      return { ts, text: m ? m[2] : line };
    });
}
