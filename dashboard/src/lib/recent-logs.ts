import "server-only";
import { createHash } from "node:crypto";
import { addAbortSignal, type Readable } from "node:stream";
import Docker from "dockerode";

import { demuxDockerFrames } from "./docker";
import { openSession, SESSION_COOKIE } from "./session";

const MAX_BYTES = 256 * 1024;
const MAX_CONTAINERS = 20;
const SINCE_SECONDS: Record<string, number> = { "15m": 900, "1h": 3600, "6h": 21600 };
const SERVICE_KINDS = {
  applications: "application", compose: "compose", postgres: "postgres", mysql: "mysql",
  mariadb: "mariadb", mongo: "mongo", redis: "redis",
} as const;
const docker = new Docker({ socketPath: process.env.DOCKER_SOCKET ?? "/var/run/docker.sock" });

export interface RecentLogLine {
  id: string;
  ts: string;
  text: string;
}

interface Project {
  projectId: string;
  environments: ({
    environmentId: string;
  } & Partial<Record<keyof typeof SERVICE_KINDS, Record<string, string>[]>>)[];
}

class LogsError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

function sessionCookie(request: Request): string {
  const authorization = request.headers.get("authorization");
  if (authorization) {
    const token = authorization.match(/^Bearer ([A-Za-z0-9_-]{1,12000})$/)?.[1];
    const cookie = token ? Buffer.from(token, "base64url").toString("utf8") : "";
    if (cookie && cookie.length <= 8192 && !/[^\x20-\x7e]/.test(cookie) && cookie.includes("=")) {
      return cookie;
    }
  } else {
    const token = request.headers.get("cookie")?.split(";")
      .map((part) => part.trim()).find((part) => part.startsWith(`${SESSION_COOKIE}=`))
      ?.slice(SESSION_COOKIE.length + 1);
    const session = openSession(token);
    if (session) return session.dokployCookie;
  }
  throw new LogsError("Not logged in. Sign in again with `switchyard up` or at /login.", 401);
}

async function dokploy<T>(path: string, cookie: string, signal: AbortSignal): Promise<T> {
  const base = process.env.DOKPLOY_URL ?? "http://localhost:3000";
  const response = await fetch(`${base}/api/${path}`, {
    headers: { Cookie: cookie, Origin: process.env.DOKPLOY_AUTH_ORIGIN ?? base },
    redirect: "manual",
    cache: "no-store",
    signal,
  });
  if (response.status === 401 || response.status === 302 || response.status === 307) {
    throw new LogsError("Not logged in. The Dokploy session expired; sign in again.", 401);
  }
  if (response.status === 403) throw new LogsError("Dokploy denied access to this service.", 403);
  if (!response.ok) throw new LogsError("Dokploy is unavailable. Try again shortly.", 503);
  return response.json() as Promise<T>;
}

/** Stop reading at the byte ceiling, including when a single log line is huge. */
export async function collectLogBytes(stream: Readable, maxBytes: number) {
  const parts: Buffer[] = [];
  let size = 0;
  let truncated = false;
  for await (const chunk of stream) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    const remaining = maxBytes - size;
    parts.push(bytes.subarray(0, remaining));
    size += Math.min(bytes.length, remaining);
    if (bytes.length >= remaining) {
      truncated = true;
      break;
    }
  }
  return { bytes: Buffer.concat(parts, size), truncated };
}

export function parseLogLines(bytes: Buffer, containerId: string, truncated = false): RecentLogLine[] {
  const text = demuxDockerFrames(bytes);
  const records = text.split("\n");
  // A partial final line would get a new identity when the next poll completes it.
  if (truncated || records[records.length - 1] === "") records.pop();
  const occurrences = new Map<string, number>();
  return records.map((record) => {
    const match = record.match(/^(\S+) (.*)$/);
    const timestamped = match && !Number.isNaN(Date.parse(match[1]));
    const ts = timestamped ? match[1] : "";
    const text = timestamped ? match[2] : record;
    const hash = createHash("sha256").update(`${ts}\0${text}`).digest("hex");
    const occurrence = occurrences.get(hash) ?? 0;
    occurrences.set(hash, occurrence + 1);
    return { id: `${containerId}:${hash}:${occurrence}`, ts, text };
  });
}

async function readLogs(appName: string, kind: string, lines: number, since: number | undefined, signal: AbortSignal) {
  const label = kind === "compose" ? "com.docker.compose.project" : "com.docker.swarm.service.name";
  const containers = (await docker.listContainers({
    all: true,
    filters: { label: [`${label}=${appName}`] },
    abortSignal: signal,
  })).filter((container) => container.Labels[label] === appName)
    .sort((a, b) => b.Created - a.Created);
  let remaining = MAX_BYTES;
  let truncated = containers.length > MAX_CONTAINERS;
  const found: RecentLogLine[] = [];
  for (const container of containers.slice(0, MAX_CONTAINERS)) {
    if (remaining <= 0) { truncated = true; break; }
    // Dockerode's logs({follow:false}) buffers without a byte bound. Keep the
    // daemon request finite but ask its transport for a stream we can cap.
    const stream = await new Promise<Readable>((resolve, reject) => {
      docker.modem.dial({
        path: `/containers/${container.Id}/logs?`,
        method: "GET",
        isStream: true,
        abortSignal: signal,
        options: { follow: false, stdout: true, stderr: true, timestamps: true, tail: lines, since },
        statusCodes: { 200: true, 404: "container disappeared", 500: "logs unavailable" },
      }, (error, result) => error ? reject(error) : resolve(result as Readable));
    });
    const batch = await collectLogBytes(addAbortSignal(signal, stream), remaining);
    remaining -= batch.bytes.length;
    truncated ||= batch.truncated;
    found.push(...parseLogLines(batch.bytes, container.Id, batch.truncated));
  }
  found.sort((a, b) => a.ts.localeCompare(b.ts));
  const result = found.slice(-lines);
  // JSON escaping can expand logs beyond the raw Docker byte count.
  let size = Buffer.byteLength(JSON.stringify({ lines: [], truncated: false }));
  let start = result.length;
  while (start > 0) {
    const next = Buffer.byteLength(JSON.stringify(result[start - 1])) + (start < result.length ? 1 : 0);
    if (size + next > MAX_BYTES) break;
    size += next;
    start -= 1;
  }
  return { lines: result.slice(start), truncated: truncated || start > 0 };
}

/** Authenticate and authorize on every poll; never reuse another user's tree. */
export async function recentLogsResponse(request: Request): Promise<Response> {
  const headers = { "Cache-Control": "no-store" };
  try {
    const cookie = sessionCookie(request);
    const params = new URL(request.url).searchParams;
    const serviceId = params.get("service");
    const count = params.get("lines") ?? "200";
    const since = params.get("since");
    if (!serviceId) throw new LogsError("Missing service id.", 400);
    if (!/^\d+$/.test(count) || Number(count) < 1 || Number(count) > 1000) {
      throw new LogsError("lines must be an integer from 1 to 1000.", 400);
    }
    if (since !== null && !Object.hasOwn(SINCE_SECONDS, since)) {
      throw new LogsError("since must be 15m, 1h or 6h.", 400);
    }
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(12_000)]);
    const projects = await dokploy<Project[]>("project.all", cookie, signal);
    let service: { kind: string; environmentId: string } | undefined;
    for (const project of projects) {
      for (const environment of project.environments ?? []) {
        for (const [collection, kind] of Object.entries(SERVICE_KINDS)) {
          if (environment[collection as keyof typeof SERVICE_KINDS]?.some((app) => app[`${kind}Id`] === serviceId)) {
            service = { kind, environmentId: environment.environmentId };
          }
        }
      }
    }
    if (!service) throw new LogsError("Unknown service or you do not have access to it.", 404);
    const detail = await dokploy<{ appName: string; environmentId: string; serverId?: string | null }>(
      `${service.kind}.one?${service.kind}Id=${encodeURIComponent(serviceId)}`, cookie, signal,
    );
    if (!detail.appName || detail.environmentId !== service.environmentId) {
      throw new LogsError("Unknown service or you do not have access to it.", 404);
    }
    if (detail.serverId) throw new LogsError("Logs for services on remote servers are not supported yet.", 422);
    const result = await readLogs(detail.appName, service.kind, Number(count),
      since ? Math.floor(Date.now() / 1000) - SINCE_SECONDS[since] : undefined, signal);
    return Response.json(result, { headers });
  } catch (error) {
    const status = error instanceof LogsError ? error.status : 503;
    const message = error instanceof LogsError ? error.message : "Logs are temporarily unavailable. Try again shortly.";
    return Response.json({ error: message }, { status, headers });
  }
}
