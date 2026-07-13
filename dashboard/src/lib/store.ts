/**
 * Durable store for metrics and recent logs, backed by a dedicated
 * Switchyard-owned Postgres (`SWITCHYARD_STORE_URL`). Provisioned by the CLI as
 * a `switchyard-metrics` service on `dokploy-network`; the dashboard container
 * reaches it by service DNS.
 *
 * Degrades gracefully: when `SWITCHYARD_STORE_URL` is unset (dev mode / `npm run
 * dev`), persistence is simply off — every write is a no-op and every query
 * returns empty, so live behaviour is unchanged. Runtime store errors are
 * logged once and swallowed so a flaky store never takes the dashboard down.
 *
 * This module is server-only by construction (it opens TCP sockets via `pg` and
 * is only imported from route handlers and the collector). It deliberately does
 * NOT `import "server-only"` so the write/query functions stay unit-testable
 * against a plain Postgres outside the Next bundler.
 */
import { Pool } from "pg";
import type { Sample, LogLine } from "./docker";

const STORE_URL = process.env.SWITCHYARD_STORE_URL ?? "";

/** True when a durable store is configured. */
export function storeEnabled(): boolean {
  return STORE_URL.length > 0;
}

let pool: Pool | null = null;
let schemaReady: Promise<void> | null = null;
let disabledReason: string | null = null;

function getPool(): Pool | null {
  if (!storeEnabled() || disabledReason) return null;
  if (!pool) {
    pool = new Pool({ connectionString: STORE_URL, max: 4 });
    // A pool-level error (store restarted, network blip) must not crash the
    // process; the next query re-establishes a connection.
    pool.on("error", (e) => console.warn("[store] pool error:", e.message));
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
        schemaReady = null; // allow a later retry
        throw e;
      });
  }
  return schemaReady;
}

/** Run `fn` with an initialized pool, or return `fallback` when the store is off/broken. */
async function withStore<T>(fallback: T, fn: (p: Pool) => Promise<T>): Promise<T> {
  const p = getPool();
  if (!p) return fallback;
  try {
    await ensureSchema(p);
    return await fn(p);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (disabledReason !== msg) {
      disabledReason = msg;
      console.warn("[store] disabled after error:", msg);
    }
    return fallback;
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
         SELECT ts, text FROM log_lines
          WHERE app_name = $1 AND ts >= $2
          ORDER BY ts DESC
          LIMIT $3
       ) t ORDER BY ts ASC`,
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

/** Close the pool (used by tests). */
export async function closeStore(): Promise<void> {
  const p = pool;
  pool = null;
  schemaReady = null;
  if (p) await p.end();
}
