import { setTimeout as delay } from "node:timers/promises";
import { Command, InvalidArgumentError, Option } from "commander";

import { loadConfig, type SwitchyardConfig } from "../core/config.js";
import { dockerInherit } from "../core/docker.js";
import { UserError } from "../core/errors.js";
import { connectPlatformClient, type PlatformClient } from "../core/platform-client.js";
import { resolveService, type ServiceLookupClient } from "../core/service-selection.js";
import { CONTAINER_NAME } from "../core/switchyard-container.js";

export interface LogsFlags {
  service?: string;
  project?: string;
  lines?: number;
  follow?: boolean;
  json?: boolean;
  since?: "15m" | "1h" | "6h";
}

export interface ServiceLogLine {
  id: string;
  ts: string;
  text: string;
}

export interface LogsClient extends ServiceLookupClient {
  readLogs(serviceId: string, flags: LogsFlags, signal?: AbortSignal): Promise<{ lines: ServiceLogLine[]; truncated: boolean }>;
}

export class LogsRequestError extends UserError {
  constructor(message: string, readonly retryable: boolean) {
    super(message);
  }
}

function parseLines(value: string): number {
  const lines = Number(value);
  if (!/^\d+$/.test(value) || !Number.isInteger(lines) || lines < 1 || lines > 1000) {
    throw new InvalidArgumentError("lines must be an integer between 1 and 1000");
  }
  return lines;
}

export function createLogsCommand(
  action: (flags: LogsFlags) => Promise<void> = logsCommand,
  infrastructureAction: (target: "switchyard" | "dokploy", flags: LogsFlags) => Promise<void> = infrastructureLogsCommand,
): Command {
  return new Command("logs")
    .description("Read service logs through the dashboard API or infrastructure logs through Docker")
    .argument("[target]", "switchyard | dokploy for infrastructure, otherwise a service name or ID")
    .option("--service <name|id>", "service to read (default: current directory name)")
    .option("--project <name|id>", "project to use (default: the only project)")
    .option("--lines <N>", "recent service lines per poll (1–1000)", parseLines, 200)
    .option("-f, --follow", "follow log output until Ctrl+C")
    .option("--json", "print service logs as one JSON object per line (NDJSON)")
    .addOption(new Option("--since <duration>", "only service logs from this recent window").choices(["15m", "1h", "6h"]))
    .addHelpText("after", "\nInfrastructure targets tail 200 lines via Docker. Services named switchyard or dokploy require --service.\nUse either a positional target or --service, not both.")
    .action(async (target: string | undefined, flags: LogsFlags) => {
      if (target !== undefined && flags.service !== undefined) {
        throw new UserError("Cannot combine a positional logs target with --service. Use either a positional target or --service <name|id>.");
      }
      if (target === "switchyard" || target === "dokploy") {
        await infrastructureAction(target, flags);
      } else {
        await action(target === undefined ? flags : { ...flags, service: target });
      }
    });
}

/** Keep stack diagnostics available even when the dashboard or login is broken. */
export async function infrastructureLogsCommand(
  target: "switchyard" | "dokploy",
  flags: LogsFlags,
  runDocker: (args: string[]) => Promise<number> = dockerInherit,
): Promise<void> {
  const follow = flags.follow ? ["--follow"] : [];
  const args = target === "switchyard"
    ? ["logs", ...follow, "--tail", "200", CONTAINER_NAME]
    : ["service", "logs", ...follow, "--tail", "200", "dokploy"];
  process.exitCode = await runDocker(args);
}

/** Reuse the caller's Dokploy session; the dashboard rechecks service ownership. */
export function createLogsClient(cfg: SwitchyardConfig, session: PlatformClient): LogsClient {
  const base = `http://localhost:${cfg.dashboardPort}`;
  return {
    request: session.request,
    async readLogs(serviceId, flags, signal) {
      const params = new URLSearchParams({ service: serviceId, lines: String(flags.lines ?? 200) });
      if (flags.since) params.set("since", flags.since);
      let res: Response;
      try {
        res = await fetch(`${base}/api/services/logs/recent?${params}`, {
          headers: { Authorization: `Bearer ${Buffer.from(session.cookie).toString("base64url")}` },
          redirect: "manual",
          signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000),
        });
      } catch {
        signal?.throwIfAborted();
        throw new LogsRequestError(`Cannot read logs from the dashboard at ${base}. Check that the platform is running.`, true);
      }
      if (res.status === 401 || (res.status >= 300 && res.status < 400)) {
        throw new LogsRequestError("Not logged in: the Dokploy session expired. Sign in again with `switchyard up`.", false);
      }
      if (res.status === 403 || res.status === 404) {
        throw new LogsRequestError(`Unknown or inaccessible service: ${serviceId}. Check --service and --project; the dashboard must support service logs.`, false);
      }
      if (res.status === 422) {
        throw new LogsRequestError("Logs for services on remote servers are not supported yet.", false);
      }
      if (!res.ok) {
        throw new LogsRequestError(`Log request failed (${res.status}). Check the dashboard and try again.`, res.status === 429 || res.status >= 500);
      }
      try {
        return await res.json() as { lines: ServiceLogLine[]; truncated: boolean };
      } catch {
        signal?.throwIfAborted();
        throw new LogsRequestError("The dashboard log response was interrupted or invalid. Try again shortly.", true);
      }
    },
  };
}

/** Bounded history of stable server IDs, including identical messages at different times. */
export class LogDeduplicator {
  private readonly seen = new Set<string>();

  take(lines: ServiceLogLine[]): ServiceLogLine[] {
    const fresh = lines.filter((line) => {
      if (this.seen.has(line.id)) return false;
      this.seen.add(line.id);
      return true;
    });
    while (this.seen.size > 2000) this.seen.delete(this.seen.values().next().value!);
    return fresh;
  }
}

export function formatLogLine(line: ServiceLogLine, json = false): string {
  return json ? JSON.stringify(line) : `${line.ts} ${line.text}`;
}

export async function runServiceLogs(
  flags: LogsFlags,
  client: LogsClient,
  options: {
    signal?: AbortSignal;
    write?: (line: string) => void;
    warn?: (message: string) => void;
    wait?: (ms: number, signal?: AbortSignal) => Promise<void>;
  } = {},
): Promise<void> {
  const { signal } = options;
  const write = options.write ?? console.log;
  const warn = options.warn ?? console.error;
  const wait = options.wait ?? ((ms, abort) => delay(ms, undefined, { signal: abort }));
  const dedup = new LogDeduplicator();
  let interval = 1000;
  let failures = 0;
  let readOnce = false;
  let warnedTruncated = false;
  try {
    signal?.throwIfAborted();
    const service = await resolveService(client, flags);
    for (;;) {
      signal?.throwIfAborted();
      try {
        const page = await client.readLogs(service.serviceId, flags, signal);
        signal?.throwIfAborted();
        const fresh = dedup.take(page.lines);
        for (const line of fresh) write(formatLogLine(line, flags.json));
        if (page.truncated && !warnedTruncated) warn("Log output reached the dashboard byte limit; some lines were omitted.");
        warnedTruncated = page.truncated;
        interval = fresh.length > 0 ? 1000 : Math.min(interval * 2, 10000);
        failures = 0;
        readOnce = true;
      } catch (error) {
        signal?.throwIfAborted();
        if (!flags.follow || !readOnce || !(error instanceof LogsRequestError) || !error.retryable || ++failures > 5) throw error;
        warn(`${error.message} Retrying…`);
        interval = Math.min(interval * 2, 10000);
      }
      if (!flags.follow) return;
      await wait(interval, signal);
    }
  } catch (error) {
    if (!signal?.aborted) throw error;
  }
}

/** Install the handler before auth as well as polling, and always remove it. */
export async function withLogsInterrupt(work: (signal: AbortSignal) => Promise<void>): Promise<void> {
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.on("SIGINT", stop);
  try {
    await work(controller.signal);
  } catch (error) {
    if (!controller.signal.aborted) throw error;
  } finally {
    process.removeListener("SIGINT", stop);
  }
}

export async function logsCommand(flags: LogsFlags): Promise<void> {
  await withLogsInterrupt(async (signal) => {
    const { config } = loadConfig();
    const session = await connectPlatformClient(config, signal);
    await runServiceLogs(flags, createLogsClient(config, session), { signal });
  });
}
