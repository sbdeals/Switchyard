/**
 * Self-contained Docker access for bounded log tails and a single metrics
 * sample — the data plane, mirroring dashboard/src/lib/docker.ts.
 *
 * Unlike the dashboard (which streams over SSE), an MCP tool call is one-shot,
 * so these read a bounded snapshot and return. A Dokploy service's `appName` is
 * the prefix of its Swarm task container name.
 *
 * Socket path defaults to /var/run/docker.sock; on Windows Docker Desktop set
 * DOCKER_SOCKET=//./pipe/docker_engine.
 */
import Docker from "dockerode";
import type { ContainerStats } from "dockerode";

const socketPath = process.env.DOCKER_SOCKET ?? "/var/run/docker.sock";
const docker = new Docker({ socketPath });

/** Resolve a Dokploy appName to its running container id (most recent). */
async function findContainerId(appName: string): Promise<string | null> {
  if (!appName) return null;
  const containers = await docker.listContainers({ all: false, filters: { name: [appName] } });
  if (containers.length === 0) return null;
  const match =
    containers.find((c) => c.Names.some((n) => n.replace(/^\//, "").startsWith(appName))) ??
    containers[0]!;
  return match.Id;
}

/**
 * Demux Docker's multiplexed log buffer into plain text. Non-TTY containers
 * frame each chunk with an 8-byte header ([stream, 0,0,0, size(4 BE)]); TTY
 * containers emit raw bytes. We detect the framing and fall back to raw.
 */
function demux(buf: Buffer): string {
  const chunks: Buffer[] = [];
  let i = 0;
  while (i + 8 <= buf.length) {
    const type = buf[i]!;
    if (type > 2 || buf[i + 1] !== 0 || buf[i + 2] !== 0 || buf[i + 3] !== 0) {
      // Not a frame header — treat the whole buffer as raw (TTY) output.
      return buf.toString("utf8");
    }
    const size = buf.readUInt32BE(i + 4);
    const start = i + 8;
    const end = start + size;
    if (end > buf.length) break;
    chunks.push(buf.subarray(start, end));
    i = end;
  }
  return chunks.length ? Buffer.concat(chunks).toString("utf8") : buf.toString("utf8");
}

export interface LogsResult {
  running: boolean;
  lines: string[];
}

/** Read a bounded tail of a container's logs (stdout+stderr, with timestamps). */
export async function readLogs(appName: string, tail = 200): Promise<LogsResult> {
  const id = await findContainerId(appName);
  if (!id) return { running: false, lines: [] };
  const container = docker.getContainer(id);
  const raw = (await container.logs({
    follow: false,
    stdout: true,
    stderr: true,
    tail,
    timestamps: true,
  })) as unknown as Buffer;
  const text = demux(Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer));
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  return { running: true, lines };
}

export interface MetricsSample {
  running: boolean;
  cpuPercent: number;
  memUsedBytes: number;
  memLimitBytes: number;
  memPercent: number;
}

function toSample(s: ContainerStats): Omit<MetricsSample, "running"> {
  const cpuDelta = s.cpu_stats.cpu_usage.total_usage - s.precpu_stats.cpu_usage.total_usage;
  const sysDelta = (s.cpu_stats.system_cpu_usage ?? 0) - (s.precpu_stats.system_cpu_usage ?? 0);
  const cpus = s.cpu_stats.online_cpus || s.cpu_stats.cpu_usage.percpu_usage?.length || 1;
  const cpu = sysDelta > 0 && cpuDelta > 0 ? (cpuDelta / sysDelta) * cpus * 100 : 0;

  const cache = (s.memory_stats.stats as Record<string, number> | undefined)?.cache ?? 0;
  const memUsed = Math.max(0, (s.memory_stats.usage ?? 0) - cache);
  const memLimit = s.memory_stats.limit ?? 0;
  const memPct = memLimit > 0 ? (memUsed / memLimit) * 100 : 0;

  return {
    cpuPercent: Math.round(cpu * 100) / 100,
    memUsedBytes: memUsed,
    memLimitBytes: memLimit,
    memPercent: Math.round(memPct * 100) / 100,
  };
}

/** Take a single (non-streaming) CPU/memory sample for a container. */
export async function readMetrics(appName: string): Promise<MetricsSample> {
  const id = await findContainerId(appName);
  if (!id) {
    return { running: false, cpuPercent: 0, memUsedBytes: 0, memLimitBytes: 0, memPercent: 0 };
  }
  const container = docker.getContainer(id);
  const stats = (await container.stats({ stream: false })) as unknown as ContainerStats;
  return { running: true, ...toSample(stats) };
}
