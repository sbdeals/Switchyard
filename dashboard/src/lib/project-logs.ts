import "server-only";
import Docker from "dockerode";
import type DockerModem from "docker-modem";
import { StringDecoder } from "node:string_decoder";
import { Readable } from "node:stream";
import { unstable_rethrow } from "next/navigation";

import { request } from "./dokploy";
import { MAX_LOG_LINES, MAX_LOG_LINE_LENGTH, mergeLogs, type LogBatch, type LogSource } from "./log-explorer";

const docker = new Docker({ socketPath: process.env.DOCKER_SOCKET ?? "/var/run/docker.sock" });
const MAX_SERVICES = 64;
const MAX_CONTAINERS = 32;
const LINES_PER_CONTAINER = 300;
const BYTES_PER_CONTAINER = 256 * 1024;
const CONCURRENCY = 4;
const RANGES = { "15m": 15 * 60_000, "1h": 60 * 60_000, "6h": 6 * 60 * 60_000 };

type ServiceRef = { id: string; kind: string };
type ScopedSource = LogSource & { kind: string; remote: boolean };
type RawProject = {
  projectId: string;
  environments: ({ environmentId: string } & Record<string, unknown>)[];
};

export class ProjectLogScopeError extends Error {}

export function logRangeMs(range: string): number | undefined {
  return Object.hasOwn(RANGES, range) ? RANGES[range as keyof typeof RANGES] : undefined;
}

/** Resolve only IDs in the current user's freshly fetched project/environment. */
export function projectLogRefs(tree: RawProject[], projectId: string, environmentId: string): ServiceRef[] {
  const environment = tree.find((p) => p.projectId === projectId)?.environments
    .find((e) => e.environmentId === environmentId);
  if (!environment) throw new ProjectLogScopeError("Unknown project or environment");
  return ["application", "compose", "postgres", "mysql", "mariadb", "mongo", "redis"].flatMap((kind) => {
    const entries = environment[kind === "application" ? "applications" : kind];
    if (!Array.isArray(entries)) return [];
    return entries.flatMap((entry) => typeof entry?.[`${kind}Id`] === "string"
      ? [{ id: entry[`${kind}Id`], kind }]
      : []);
  });
}

async function mapLimited<T, R>(items: T[], fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  }));
  return results;
}

/** Exact ownership labels only: names and substring matches are not authority. */
export function containerLogSource(container: Pick<Docker.ContainerInfo, "Labels">, services: ScopedSource[]): LogSource | undefined {
  const labels = container.Labels ?? {};
  const service = services.find((s) => !s.remote && s.appName && (
    s.kind === "compose"
      ? labels["com.docker.compose.project"] === s.appName
      : labels["com.docker.swarm.service.name"] === s.appName
  ));
  if (!service) return;
  const child = service.kind === "compose" ? labels["com.docker.compose.service"] : undefined;
  return {
    id: child ? `${service.id}:${child}` : service.id,
    name: child ? `${service.name} / ${child}` : service.name,
    appName: service.appName,
  };
}

/** Stream follow:false through Dockerode's transport (logs() buffers that mode). */
function dockerStream(path: string, options: Record<string, unknown>, signal: AbortSignal): Promise<Readable> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const modem = docker.modem as DockerModem;
    modem.dial({
      path,
      method: "GET",
      options,
      isStream: true,
      abortSignal: signal,
      statusCodes: { 200: true, 404: "container unavailable", 500: "Docker unavailable" },
    }, (error, stream) => {
      if (error) return reject(error);
      if (!(stream instanceof Readable)) return reject(new Error("Invalid Docker stream"));
      if (signal.aborted) {
        stream.destroy();
        reject(signal.reason);
      } else resolve(stream);
    });
  });
}

/** Bounded incremental Docker frame decoder; supports both multiplexed and TTY logs. */
export async function collectDockerLogs(stream: Readable, signal: AbortSignal): Promise<{ lines: string[]; truncated: boolean }> {
  const lines: string[] = [];
  const decoders = [new StringDecoder("utf8"), new StringDecoder("utf8"), new StringDecoder("utf8")];
  const pending = ["", "", ""];
  let header = Buffer.alloc(0);
  let framed: boolean | undefined;
  let remaining = 0;
  let channel = 1;
  let total = 0;
  let truncated = false;
  let ended = false;
  const append = (text: string, index: number) => {
    for (const [i, part] of text.split("\n").entries()) {
      if (i > 0) {
        if (pending[index]) lines.push(pending[index]);
        pending[index] = "";
        if (lines.length > LINES_PER_CONTAINER) {
          lines.shift();
          truncated = true;
        }
      }
      // Leave room for Docker's timestamp, and one extra character so the pure
      // parser can mark the payload itself as truncated after removing it.
      const room = MAX_LOG_LINE_LENGTH + 128 - pending[index].length;
      pending[index] += part.slice(0, room);
      if (part.length > room) truncated = true;
    }
  };
  const abort = () => stream.destroy(new Error("Log request aborted"));
  const onEnd = () => { ended = true; };
  stream.once("end", onEnd);
  signal.addEventListener("abort", abort, { once: true });
  try {
    signal.throwIfAborted();
    for await (const value of stream) {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      const available = Math.min(chunk.length, BYTES_PER_CONTAINER - total);
      const data = chunk.subarray(0, available);
      total += available;
      let offset = 0;
      while (offset < data.length) {
        if (framed === false) {
          append(decoders[1].write(data.subarray(offset)), 1);
          break;
        }
        if (remaining === 0) {
          const count = Math.min(8 - header.length, data.length - offset);
          header = Buffer.concat([header, data.subarray(offset, offset + count)]);
          offset += count;
          if (header.length < 8) continue;
          if (header[0] > 2 || header[1] || header[2] || header[3]) {
            if (framed) throw new Error("Invalid Docker log frame");
            framed = false;
            append(decoders[1].write(header), 1);
            header = Buffer.alloc(0);
            continue;
          }
          framed = true;
          channel = header[0];
          remaining = header.readUInt32BE(4);
          header = Buffer.alloc(0);
          if (remaining === 0) continue;
        }
        const count = Math.min(remaining, data.length - offset);
        append(decoders[channel].write(data.subarray(offset, offset + count)), channel);
        offset += count;
        remaining -= count;
      }
      if (available < chunk.length || total === BYTES_PER_CONTAINER) {
        truncated = true;
        break;
      }
    }
    if (!truncated && !ended) throw new Error("Incomplete Docker log response");
    if (framed && (remaining || header.length)) truncated = true;
    if (framed === undefined && header.length) append(decoders[1].write(header), 1);
    for (let index = 0; index < decoders.length; index++) {
      append(decoders[index].end(), index);
      if (pending[index]) lines.push(pending[index]);
    }
    return { lines: lines.slice(-LINES_PER_CONTAINER), truncated: truncated || lines.length > LINES_PER_CONTAINER };
  } finally {
    signal.removeEventListener("abort", abort);
    stream.removeListener("end", onEnd);
    stream.destroy();
  }
}

export async function getProjectLogs(projectId: string, environmentId: string, rangeMs: number, signal: AbortSignal) {
  const fetchedAt = Date.now();
  const since = fetchedAt - rangeMs;
  const tree = await request<RawProject[]>("project.all", { signal });
  const refs = projectLogRefs(tree, projectId, environmentId);
  const warnings: string[] = [];
  if (refs.length > MAX_SERVICES) warnings.push(`Only the first ${MAX_SERVICES} services are included.`);
  const resolved = await mapLimited(refs.slice(0, MAX_SERVICES), async ({ id, kind }) => {
    signal.throwIfAborted();
    try {
      const detail = await request<{ name?: string; appName?: string; serverId?: string | null }>(
        `${kind}.one?${kind}Id=${encodeURIComponent(id)}`, { signal },
      );
      if (!detail.appName) {
        warnings.push(`${detail.name ?? id}: no runtime log source is configured.`);
        return undefined;
      }
      return { id: `${kind}:${id}`, name: detail.name ?? id, appName: detail.appName, kind, remote: Boolean(detail.serverId) };
    } catch (error) {
      unstable_rethrow(error);
      signal.throwIfAborted();
      warnings.push(`Logs unavailable for ${kind} ${id}: service details could not be read.`);
      return undefined;
    }
  });
  const services = resolved.filter((service): service is ScopedSource => Boolean(service));
  const containers = await docker.listContainers({ all: true, abortSignal: signal });
  const matches = containers.map((container) => ({ container, source: containerLogSource(container, services) }))
    .filter((match): match is { container: Docker.ContainerInfo; source: LogSource } => Boolean(match.source))
    .sort((a, b) => b.container.Created - a.container.Created || a.container.Id.localeCompare(b.container.Id));
  if (matches.length > MAX_CONTAINERS) warnings.push(`Only the newest ${MAX_CONTAINERS} containers are included.`);
  for (const service of services) {
    if (service.remote) warnings.push(`${service.name}: remote-server logs are unavailable through this dashboard's Docker socket.`);
    else if (!matches.some(({ source }) => source.appName === service.appName)) {
      warnings.push(`${service.name}: no retained local container logs found.`);
    }
  }
  const selected = matches.slice(0, MAX_CONTAINERS);
  const sources = [...new Map(selected.map(({ source }) => [source.id, source])).values()];
  const batches = await mapLimited(selected, async ({ container, source }): Promise<LogBatch> => {
    try {
      signal.throwIfAborted();
      const stream = await dockerStream(`/containers/${encodeURIComponent(container.Id)}/logs?`, {
        follow: false, stdout: true, stderr: true, timestamps: true, tail: LINES_PER_CONTAINER,
        since: Math.floor(since / 1000),
      }, signal);
      const result = await collectDockerLogs(stream, signal);
      if (result.truncated) warnings.push(`${source.name}: logs were limited to ${LINES_PER_CONTAINER} lines / 256 KiB per container.`);
      return { source, lines: result.lines };
    } catch (error) {
      unstable_rethrow(error);
      warnings.push(`${source.name}: container logs unavailable${signal.aborted ? " (request deadline reached)" : ""}.`);
      return { source, lines: [] };
    }
  });
  const lines = mergeLogs(batches, { since, limit: MAX_LOG_LINES });
  if (lines.length === MAX_LOG_LINES) warnings.push(`Showing at most ${MAX_LOG_LINES.toLocaleString("en-US")} recent log lines.`);
  return { sources, lines, warnings: [...new Set(warnings)], fetchedAt };
}
