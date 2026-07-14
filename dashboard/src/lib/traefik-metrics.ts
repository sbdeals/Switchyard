/**
 * Server-only scraper for Traefik's Prometheus metrics — the data source for
 * the dashboard's Railway-style HTTP panels (traffic, requests, error rate,
 * response time).
 *
 * Modeled on the docker-stats collector pattern: a lazy, HMR-safe singleton
 * (stashed on globalThis) that ticks on its own timer, keeps an in-memory ring
 * buffer of per-interval DELTAS, and silently no-ops (warning once) when the
 * Traefik metrics endpoint is unreachable. Nothing here fetches Dokploy; it
 * only talks to `TRAEFIK_METRICS_URL`.
 *
 * Traefik v3 series consumed (counter/histogram, all `..._total`/`_bucket`
 * cumulative):
 *   - traefik_service_requests_total{code,method,service}     — bucketed into 2xx/3xx/4xx/5xx
 *   - traefik_service_requests_bytes_total{service}           — ingress bytes
 *   - traefik_service_responses_bytes_total{service}          — egress bytes
 *   - traefik_service_request_duration_seconds_bucket{le,service} — latency histogram
 *
 * Matching rule: Traefik's `service` label embeds the Dokploy appName (e.g.
 * `uptimekuma-uptimekuma-zlgfqm-3001-web@docker`). We store deltas keyed by the
 * raw service label and, at query time, aggregate every label that CONTAINS the
 * requested appName — folding the multiple routers/entrypoints Dokploy creates
 * for one service back into a single series.
 */
import "server-only";

const DEFAULT_URL = "http://127.0.0.1:8081/metrics";
/** Scrape cadence (task allows 15–20s). */
const SCRAPE_MS = 15_000;
/** Per-service ring capacity — ~25h at SCRAPE_MS, a hair over the 24h window. */
const RING_CAP = 6000;
/** Max time-buckets returned to the client per query (keeps charts readable). */
const MAX_POINTS = 120;
/** Per-scrape fetch timeout. */
const FETCH_TIMEOUT_MS = 4_000;

/** One scrape's worth of per-interval deltas for a single Traefik service label. */
interface RawDelta {
  ts: number;
  ingress: number;
  egress: number;
  c2xx: number;
  c3xx: number;
  c4xx: number;
  c5xx: number;
  /** Cumulative-style histogram bucket deltas: le bound (seconds) -> count. */
  durBuckets: Record<string, number>;
}

/** Cumulative counters for one service label, as of the last scrape. */
interface Cumulative {
  ingress: number;
  egress: number;
  c2xx: number;
  c3xx: number;
  c4xx: number;
  c5xx: number;
  buckets: Map<string, number>;
}

interface ScraperState {
  url: string;
  prev: Map<string, Cumulative>;
  rings: Map<string, RawDelta[]>;
  /** True once the endpoint has been reached successfully at least once. */
  everOk: boolean;
  warned: boolean;
  timer: ReturnType<typeof setInterval> | null;
}

/** A single point in the series handed to the client. */
export interface HttpPoint {
  ts: number;
  ingress: number;
  egress: number;
  c2xx: number;
  c3xx: number;
  c4xx: number;
  c5xx: number;
  total: number;
  /** 5xx as a percentage of total requests in the interval. */
  errorRate: number;
  /** Latency percentiles for the interval, in milliseconds. */
  p50: number;
  p90: number;
  p95: number;
  p99: number;
}

export interface HttpMetricsResult {
  available: boolean;
  points: HttpPoint[];
}

// --- HMR-safe singleton -----------------------------------------------------

const GLOBAL_KEY = "__switchyardTraefikScraper";
type GlobalWithScraper = typeof globalThis & { [GLOBAL_KEY]?: ScraperState };

function getState(): ScraperState {
  const g = globalThis as GlobalWithScraper;
  if (!g[GLOBAL_KEY]) {
    const state: ScraperState = {
      url: process.env.TRAEFIK_METRICS_URL || DEFAULT_URL,
      prev: new Map(),
      rings: new Map(),
      everOk: false,
      warned: false,
      timer: null,
    };
    g[GLOBAL_KEY] = state;
    // Kick an immediate scrape, then tick. unref() so the timer never keeps the
    // process alive on its own.
    void scrape(state);
    state.timer = setInterval(() => void scrape(state), SCRAPE_MS);
    (state.timer as { unref?: () => void }).unref?.();
  }
  return g[GLOBAL_KEY]!;
}

// --- Prometheus text parsing ------------------------------------------------

const LABEL_RE = /(\w+)="((?:[^"\\]|\\.)*)"/g;

/** Parse a metric line into name/labels/value, or null for comments/blanks. */
function parseLine(line: string): { name: string; labels: Record<string, string>; value: number } | null {
  if (!line || line[0] === "#") return null;
  const braceOpen = line.indexOf("{");
  let name: string;
  let labelsStr = "";
  let rest: string;
  if (braceOpen === -1) {
    const sp = line.indexOf(" ");
    if (sp === -1) return null;
    name = line.slice(0, sp);
    rest = line.slice(sp + 1);
  } else {
    name = line.slice(0, braceOpen);
    const braceClose = line.indexOf("}", braceOpen);
    if (braceClose === -1) return null;
    labelsStr = line.slice(braceOpen + 1, braceClose);
    rest = line.slice(braceClose + 1);
  }
  const value = parseFloat(rest.trim().split(/\s+/)[0]);
  if (Number.isNaN(value)) return null;
  const labels: Record<string, string> = {};
  if (labelsStr) {
    LABEL_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = LABEL_RE.exec(labelsStr))) labels[m[1]] = m[2];
  }
  return { name, labels, value };
}

/** Fold a raw metrics dump into per-service cumulative counters. */
function foldCumulative(text: string): Map<string, Cumulative> {
  const out = new Map<string, Cumulative>();
  const get = (service: string): Cumulative => {
    let c = out.get(service);
    if (!c) {
      c = { ingress: 0, egress: 0, c2xx: 0, c3xx: 0, c4xx: 0, c5xx: 0, buckets: new Map() };
      out.set(service, c);
    }
    return c;
  };

  for (const line of text.split("\n")) {
    if (!line || !line.startsWith("traefik_service_")) continue;
    const parsed = parseLine(line);
    if (!parsed) continue;
    const service = parsed.labels.service;
    if (!service) continue;
    const c = get(service);

    switch (parsed.name) {
      case "traefik_service_requests_total": {
        const code = parseInt(parsed.labels.code ?? "", 10);
        if (code >= 200 && code < 300) c.c2xx += parsed.value;
        else if (code >= 300 && code < 400) c.c3xx += parsed.value;
        else if (code >= 400 && code < 500) c.c4xx += parsed.value;
        else if (code >= 500 && code < 600) c.c5xx += parsed.value;
        break;
      }
      case "traefik_service_requests_bytes_total":
        c.ingress += parsed.value;
        break;
      case "traefik_service_responses_bytes_total":
        c.egress += parsed.value;
        break;
      case "traefik_service_request_duration_seconds_bucket": {
        const le = parsed.labels.le;
        if (le) c.buckets.set(le, (c.buckets.get(le) ?? 0) + parsed.value);
        break;
      }
      default:
        break;
    }
  }
  return out;
}

/** Non-negative counter delta, treating cur < prev as a reset (delta = cur). */
function deltaOf(cur: number, prev: number): number {
  return cur >= prev ? cur - prev : cur;
}

// --- scraping ---------------------------------------------------------------

async function scrape(state: ScraperState): Promise<void> {
  let text: string;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(state.url, { signal: ctrl.signal, cache: "no-store" });
    } finally {
      clearTimeout(t);
    }
    if (!res.ok) throw new Error(`status ${res.status}`);
    text = await res.text();
  } catch (err) {
    if (!state.warned) {
      state.warned = true;
      console.warn(
        `[traefik-metrics] cannot reach ${state.url} (${
          err instanceof Error ? err.message : String(err)
        }); HTTP metrics disabled. Set TRAEFIK_METRICS_URL if Traefik's Prometheus endpoint is elsewhere.`,
      );
    }
    return;
  }

  const ts = Date.now();
  const current = foldCumulative(text);
  state.everOk = true;
  // A recovered endpoint should warn again if it drops later.
  state.warned = false;

  for (const [service, cur] of current) {
    const prev = state.prev.get(service);
    if (prev) {
      const durBuckets: Record<string, number> = {};
      for (const [le, val] of cur.buckets) {
        durBuckets[le] = deltaOf(val, prev.buckets.get(le) ?? 0);
      }
      const sample: RawDelta = {
        ts,
        ingress: deltaOf(cur.ingress, prev.ingress),
        egress: deltaOf(cur.egress, prev.egress),
        c2xx: deltaOf(cur.c2xx, prev.c2xx),
        c3xx: deltaOf(cur.c3xx, prev.c3xx),
        c4xx: deltaOf(cur.c4xx, prev.c4xx),
        c5xx: deltaOf(cur.c5xx, prev.c5xx),
        durBuckets,
      };
      let ring = state.rings.get(service);
      if (!ring) {
        ring = [];
        state.rings.set(service, ring);
      }
      ring.push(sample);
      if (ring.length > RING_CAP) ring.splice(0, ring.length - RING_CAP);
    }
    state.prev.set(service, cur);
  }
}

// --- percentile from histogram bucket deltas --------------------------------

/**
 * Linear-interpolating histogram quantile, à la Prometheus histogram_quantile.
 * `buckets` maps le bound (seconds, "+Inf" allowed) -> count in this window.
 * Returns seconds, or 0 when there are no observations.
 */
function quantile(buckets: Record<string, number>, q: number): number {
  const bounds = Object.keys(buckets)
    .map((le) => ({ le: le === "+Inf" ? Infinity : parseFloat(le), count: buckets[le] }))
    .filter((b) => !Number.isNaN(b.le))
    .sort((a, b) => a.le - b.le);
  if (bounds.length === 0) return 0;
  const total = bounds[bounds.length - 1].count; // cumulative count at +Inf/top bucket
  if (total <= 0) return 0;

  const rank = q * total;
  let i = 0;
  while (i < bounds.length && bounds[i].count < rank) i++;
  if (i >= bounds.length) return 0;

  const upper = bounds[i].le;
  const upperCount = bounds[i].count;
  const lower = i === 0 ? 0 : bounds[i - 1].le;
  const lowerCount = i === 0 ? 0 : bounds[i - 1].count;

  // Can't interpolate into an unbounded top bucket — fall back to its lower edge.
  if (!Number.isFinite(upper)) return lower;
  const span = upperCount - lowerCount;
  if (span <= 0) return upper;
  return lower + ((rank - lowerCount) / span) * (upper - lower);
}

// --- public query -----------------------------------------------------------

/**
 * Aggregate the ring buffers for every Traefik service matching `appName` into
 * a downsampled series over the last `rangeMinutes`. `available:false` means the
 * scraper has never reached the Traefik metrics endpoint.
 */
export function getHttpMetrics(appName: string, rangeMinutes: number): HttpMetricsResult {
  const state = getState();
  if (!state.everOk) return { available: false, points: [] };
  if (!appName) return { available: true, points: [] };

  const rangeMs = Math.max(1, rangeMinutes) * 60_000;
  const cutoff = Date.now() - rangeMs;

  // Gather matching deltas across all routers/entrypoints for this app.
  const matched: RawDelta[] = [];
  for (const [service, ring] of state.rings) {
    if (!service.includes(appName)) continue;
    for (const d of ring) if (d.ts >= cutoff) matched.push(d);
  }
  if (matched.length === 0) return { available: true, points: [] };

  // Bucket by time so multiple service labels fold together and long windows
  // stay under MAX_POINTS.
  const bucketMs = Math.max(SCRAPE_MS, Math.ceil(rangeMs / MAX_POINTS));
  interface Bucket {
    ingress: number;
    egress: number;
    c2xx: number;
    c3xx: number;
    c4xx: number;
    c5xx: number;
    durBuckets: Record<string, number>;
  }
  const buckets = new Map<number, Bucket>();
  for (const d of matched) {
    const key = Math.floor(d.ts / bucketMs) * bucketMs;
    let b = buckets.get(key);
    if (!b) {
      b = { ingress: 0, egress: 0, c2xx: 0, c3xx: 0, c4xx: 0, c5xx: 0, durBuckets: {} };
      buckets.set(key, b);
    }
    b.ingress += d.ingress;
    b.egress += d.egress;
    b.c2xx += d.c2xx;
    b.c3xx += d.c3xx;
    b.c4xx += d.c4xx;
    b.c5xx += d.c5xx;
    for (const le in d.durBuckets) b.durBuckets[le] = (b.durBuckets[le] ?? 0) + d.durBuckets[le];
  }

  const toMs = (s: number) => Math.round(s * 1000);
  const points: HttpPoint[] = [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([ts, b]) => {
      const total = b.c2xx + b.c3xx + b.c4xx + b.c5xx;
      return {
        ts,
        ingress: b.ingress,
        egress: b.egress,
        c2xx: b.c2xx,
        c3xx: b.c3xx,
        c4xx: b.c4xx,
        c5xx: b.c5xx,
        total,
        errorRate: total > 0 ? Math.round((b.c5xx / total) * 10000) / 100 : 0,
        p50: toMs(quantile(b.durBuckets, 0.5)),
        p90: toMs(quantile(b.durBuckets, 0.9)),
        p95: toMs(quantile(b.durBuckets, 0.95)),
        p99: toMs(quantile(b.durBuckets, 0.99)),
      };
    });

  return { available: true, points };
}
