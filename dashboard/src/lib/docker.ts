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

/** Resolve a Dokploy appName to its running container id (most recent). */
export async function findContainerId(appName: string): Promise<string | null> {
  if (!appName) return null;
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
  tail = 200
): Promise<{ stream: NodeJS.ReadableStream; close: () => void } | null> {
  const id = await findContainerId(appName);
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
  appName: string
): Promise<{ stream: NodeJS.ReadableStream; close: () => void; toSample: typeof toSample } | null> {
  const id = await findContainerId(appName);
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
