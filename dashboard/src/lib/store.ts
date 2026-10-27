/**
 * Durable store for metrics and recent logs, backed by a dedicated
 * Switchyard-owned Postgres (`SWITCHYARD_STORE_URL`). Provisioned by the CLI as
 * a `switchyard-metrics` service on `dokploy-network`; the dashboard container
 * reaches it by service DNS.
 *
 * Degrades gracefully: when `SWITCHYARD_STORE_URL` is unset (dev mode / `npm run
 * dev`), persistence is simply off — every write is a no-op and every query
 * returns empty, so live behaviour is unchanged. Runtime store errors are
 * logged on state changes and swallowed so a flaky store never takes the
 * dashboard down. Transient failures retry with bounded exponential backoff.
 *
 * This module is server-only by construction (it opens TCP sockets via `pg` and
 * is only imported from route handlers and the collector). It deliberately does
 * NOT `import "server-only"` so the write/query functions stay unit-testable
 * against a plain Postgres outside the Next bundler.
 */
import { Pool } from "pg";
import type { Sample, LogLine } from "./docker";

const STORE_URL = process.env.SWITCHYARD_STORE_URL ?? "";
const RETRY_MIN_MS = 5000;
const RETRY_MAX_MS = 5 * 60_000;

/** True when a durable store is configured, even while waiting to retry. */
export function storeEnabled(): boolean {
  return STORE_URL.length > 0;
}

/** Availability for the history API; a successful operation clears failures. */
export function storeAvailable(): boolean {
  return storeEnabled() && failure === null;
}

let pool: Pool | null = null;
let schemaReady: Promise<void> | null = null;
let failure: { reason: string; retryAt: number } | null = null;
let retryDelayMs = RETRY_MIN_MS;
let retrying = false;

function isPermanentError(e: unknown): boolean {
  if (typeof e !== "object" || e === null) return false;
  const code = "code" in e ? String(e.code) : "";
  if (["28P01", "28000", "3D000", "42501", "ERR_INVALID_URL", "ERR_SOCKET_BAD_PORT"].includes(code)) return true;
  // pg parses connection settings lazily when constructing a client, so URL
  // parse/config errors can also surface on the first query. Everything else retries.
  return e instanceof URIError || (e instanceof Error && [
    "The server does not support SSL connections",
    "sslnegotiation=direct requires SSL to be enabled",
  ].includes(e.message));
}

function recordFailure(e: unknown): void {
  const permanent = isPermanentError(e);
  const now = Date.now();
  // Concurrent queries/idle clients can fail together. Count one backoff per
  // attempt, and never downgrade a permanent failure (28P01, 3D000, bad config).
  if (failure?.retryAt === Infinity || (!permanent && failure && now < failure.retryAt)) return;
  const reason = e instanceof Error ? e.message : String(e);
  if (failure?.reason !== reason || permanent) {
    console.warn(permanent ? "[store] disabled after error:" : "[store] backing off after error:", reason);
  }
  failure = { reason, retryAt: permanent ? Infinity : now + retryDelayMs };
  if (!permanent) retryDelayMs = Math.min(retryDelayMs * 2, RETRY_MAX_MS);
}

function getPool(): Pool | null {
  if (!storeEnabled() || (failure && Date.now() < failure.retryAt)) return null;
  if (!pool) {
    const p = new Pool({ connectionString: STORE_URL, max: 4 });
    // Idle client errors use the same backoff as query failures. Ignore errors
    // from a pool that closeStore has already retired.
    p.on("error", (e) => {
      if (pool === p) recordFailure(e);
    });
    pool = p;
  }
  return pool;
}

/** Create tables/indexes on first use. Idempotent; runs at most once per boot. */
async function ensureSchema(p: Pool): Promise<void> {
  if (!schemaReady) {
    schemaReady = p
      .query(
        `CREATE TABLE IF NOT EXISTS metric_samples (
           app_name  text   NOT NULL,
           ts        bigint NOT NULL,
           cpu       double precision NOT NULL,
           mem_used  bigint NOT NULL,
           mem_limit bigint NOT NULL,
           mem_pct   double precision NOT NULL,
           PRIMARY KEY (app_name, ts)
         );
         CREATE INDEX IF NOT EXISTS metric_samples_app_ts ON metric_samples (app_name, ts);
         CREATE TABLE IF NOT EXISTS log_lines (
           id       bigserial PRIMARY KEY,
           app_name text   NOT NULL,
           ts       bigint NOT NULL,
           text     text   NOT NULL
         );
         CREATE INDEX IF NOT EXISTS log_lines_app_ts ON log_lines (app_name, ts);`,
      )
      .then(() => undefined)
      .catch((e) => {
        if (pool === p) schemaReady = null; // allow a later retry
        throw e;
      });
  }
  return schemaReady;
}

/** Run `fn` with an initialized pool, or return `fallback` when the store is off/broken. */
async function withStore<T>(fallback: T, fn: (p: Pool) => Promise<T>): Promise<T> {
  if (retrying) return fallback;
  const previousFailure = failure;
  let p: Pool | null = null;
  try {
    p = getPool(); // pool/config construction failures must also degrade gracefully
    if (!p) return fallback;
    retrying = previousFailure !== null;
    await ensureSchema(p);
    const result = await fn(p);
    // A concurrent failure must not be cleared by an older successful query.
    if (pool === p && failure === previousFailure) {
      if (failure) console.warn("[store] recovered");
      failure = null;
      retryDelayMs = RETRY_MIN_MS;
    }
    return result;
  } catch (e) {
    if (pool === p) recordFailure(e);
    return fallback;
  } finally {
    if (pool === p && previousFailure) retrying = false;
  }
}

/** Persist a single metric rollup. No-op when the store is off. */
export async function writeMetric(appName: string, s: Sample): Promise<void> {
  await withStore(undefined, async (p) => {
    await p.query(
      `INSERT INTO metric_samples (app_name, ts, cpu, mem_used, mem_limit, mem_pct)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (app_name, ts) DO NOTHING`,
      [appName, s.ts, s.cpu, s.memUsed, s.memLimit, s.memPct],
    );
  });
}

/** Metric rollups for `appName` within [sinceMs, untilMs], oldest first. */
export async function queryMetrics(
  appName: string,
  sinceMs: number,
  untilMs: number = Date.now(),
  limit = 5000,
): Promise<Sample[]> {
  return withStore<Sample[]>([], async (p) => {
    const { rows } = await p.query(
      `SELECT ts, cpu, mem_used, mem_limit, mem_pct
         FROM metric_samples
        WHERE app_name = $1 AND ts BETWEEN $2 AND $3
        ORDER BY ts ASC
        LIMIT $4`,
      [appName, sinceMs, untilMs, limit],
    );
    return rows.map((r) => ({
      ts: Number(r.ts),
      cpu: Number(r.cpu),
      memUsed: Number(r.mem_used),
      memLimit: Number(r.mem_limit),
      memPct: Number(r.mem_pct),
    }));
  });
}

/** Append recent log lines. No-op when the store is off. */
export async function writeLogs(appName: string, lines: LogLine[]): Promise<void> {
  if (lines.length === 0) return;
  await withStore(undefined, async (p) => {
    // Multi-row insert via unnest keeps this one round-trip regardless of count.
    await p.query(
      `INSERT INTO log_lines (app_name, ts, text)
       SELECT $1, * FROM unnest($2::bigint[], $3::text[])`,
      [appName, lines.map((l) => l.ts), lines.map((l) => l.text)],
    );
  });
}

/** Recent persisted log lines for `appName` since `sinceMs`, oldest first. */
export async function queryLogs(
  appName: string,
  sinceMs: number,
  limit = 2000,
): Promise<LogLine[]> {
  return withStore<LogLine[]>([], async (p) => {
    // Take the newest `limit` rows in range, then present oldest-first.
    const { rows } = await p.query(
      `SELECT ts, text FROM (
         SELECT id, ts, text FROM log_lines
          WHERE app_name = $1 AND ts >= $2
          ORDER BY ts DESC, id DESC
          LIMIT $3
       ) t ORDER BY ts ASC, id ASC`,
      [appName, sinceMs, limit],
    );
    return rows.map((r) => ({ ts: Number(r.ts), text: String(r.text) }));
  });
}

/** Delete metrics/logs older than the given retention windows. */
export async function pruneOld(
  metricsRetentionMs: number,
  logsRetentionMs: number,
  now: number = Date.now(),
): Promise<void> {
  await withStore(undefined, async (p) => {
    await p.query(`DELETE FROM metric_samples WHERE ts < $1`, [now - metricsRetentionMs]);
    await p.query(`DELETE FROM log_lines WHERE ts < $1`, [now - logsRetentionMs]);
  });
}

/** Close the pool and reset health/backoff (used by tests). */
export async function closeStore(): Promise<void> {
  const p = pool;
  pool = null;
  schemaReady = null;
  failure = null;
  retryDelayMs = RETRY_MIN_MS;
  retrying = false;
  if (p) await p.end();
}
