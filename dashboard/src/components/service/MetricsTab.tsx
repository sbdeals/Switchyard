"use client";

import { useEffect, useState } from "react";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Cpu, MemoryStick, Loader2 } from "lucide-react";

interface Sample {
  ts: number;
  cpu: number;
  memUsed: number;
  memLimit: number;
  memPct: number;
}

/** Live keeps a short dense buffer; history ranges query the durable store. */
const MAX_LIVE = 1000;
const LIVE_SEED_MS = 15 * 60_000;
const RANGES = [
  { id: "live", label: "Live", ms: 0 },
  { id: "15m", label: "15m", ms: 15 * 60_000 },
  { id: "1h", label: "1h", ms: 60 * 60_000 },
  { id: "6h", label: "6h", ms: 6 * 60 * 60_000 },
  { id: "24h", label: "24h", ms: 24 * 60 * 60_000 },
] as const;
type RangeId = (typeof RANGES)[number]["id"];

const fmtMB = (b: number) => `${Math.round(b / 1024 / 1024)} MB`;

async function fetchHistory(
  appName: string,
  windowMs: number,
  signal: AbortSignal,
): Promise<{ enabled: boolean; samples: Sample[] }> {
  const since = Date.now() - windowMs;
  const res = await fetch(
    `/api/services/metrics/history?app=${encodeURIComponent(appName)}&since=${since}`,
    { signal, cache: "no-store" },
  );
  if (!res.ok) return { enabled: false, samples: [] };
  return (await res.json()) as { enabled: boolean; samples: Sample[] };
}

export function MetricsTab({ appName, active }: { appName: string; active: boolean }) {
  const [data, setData] = useState<Sample[]>([]);
  const [idle, setIdle] = useState(false);
  const [range, setRange] = useState<RangeId>("live");
  // null = unknown (still probing); false = no durable store configured.
  const [storeOn, setStoreOn] = useState<boolean | null>(null);

  useEffect(() => {
    if (!active || !appName) return;
    setIdle(false);
    setData([]);
    const ac = new AbortController();
    let es: EventSource | null = null;

    const window = range === "live" ? LIVE_SEED_MS : RANGES.find((r) => r.id === range)!.ms;

    // Seed from the durable store (history survives tab close), then, in Live
    // mode, append the live SSE on top.
    fetchHistory(appName, window, ac.signal)
      .then(({ enabled, samples }) => {
        setStoreOn(enabled);
        setData(samples);
      })
      .catch(() => setStoreOn(false));

    if (range === "live") {
      es = new EventSource(`/api/services/metrics?app=${encodeURIComponent(appName)}`);
      es.addEventListener("idle", () => setIdle(true));
      es.onmessage = (e) => {
        try {
          const s = JSON.parse(e.data) as Sample;
          if (!s || typeof s.cpu !== "number") return;
          setData((prev) => [...prev, s].slice(-MAX_LIVE));
        } catch {
          /* ignore */
        }
      };
    }

    return () => {
      ac.abort();
      es?.close();
    };
  }, [appName, active, range]);

  const last = data[data.length - 1];
  const historyEmpty = range !== "live" && data.length === 0;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex rounded-lg border border-[var(--color-border)] p-0.5">
          {RANGES.map((r) => (
            <button
              key={r.id}
              onClick={() => setRange(r.id)}
              disabled={r.id !== "live" && storeOn === false}
              className={
                "rounded-md px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 " +
                (range === r.id
                  ? "bg-[var(--color-surface)] text-[var(--color-fg)]"
                  : "text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]")
              }
            >
              {r.label}
            </button>
          ))}
        </div>
        {range === "live" && storeOn === false && (
          <span className="text-[10px] text-[var(--color-fg-subtle)]">history off</span>
        )}
      </div>

      {idle && range === "live" ? (
        <div className="flex h-40 items-center justify-center text-sm text-[var(--color-fg-subtle)]">
          No metrics — the service isn&apos;t running.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Stat
              icon={<Cpu className="size-4" />}
              label="CPU"
              value={last ? `${last.cpu.toFixed(1)}%` : "—"}
              accent="#a06bff"
            />
            <Stat
              icon={<MemoryStick className="size-4" />}
              label="Memory"
              value={last ? fmtMB(last.memUsed) : "—"}
              sub={last && last.memLimit ? `of ${fmtMB(last.memLimit)}` : undefined}
              accent="#3ecf8e"
            />
          </div>

          <Chart title="CPU %" data={data} dataKey="cpu" color="#a06bff" unit="%" />
          <Chart title="Memory" data={data} dataKey="memUsed" color="#3ecf8e" formatter={fmtMB} />

          {historyEmpty && (
            <div className="flex items-center justify-center text-xs text-[var(--color-fg-subtle)]">
              {storeOn === false
                ? "Metric history needs the Switchyard store (SWITCHYARD_STORE_URL)."
                : "No metrics recorded in this range yet."}
            </div>
          )}
          {range === "live" && data.length === 0 && (
            <div className="flex items-center justify-center gap-2 text-xs text-[var(--color-fg-subtle)]">
              <Loader2 className="size-4 animate-spin" /> sampling…
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  accent: string;
}) {
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      <div className="flex items-center gap-1.5 text-xs text-[var(--color-fg-muted)]" style={{ color: accent }}>
        {icon}
        <span>{label}</span>
      </div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-xs text-[var(--color-fg-subtle)]">{sub}</div>}
    </div>
  );
}

function Chart({
  title,
  data,
  dataKey,
  color,
  unit,
  formatter,
}: {
  title: string;
  data: Sample[];
  dataKey: "cpu" | "memUsed";
  color: string;
  unit?: string;
  formatter?: (n: number) => string;
}) {
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      <div className="mb-2 text-xs font-medium text-[var(--color-fg-muted)]">{title}</div>
      <div className="h-28">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id={`g-${dataKey}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.35} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="ts" hide />
            <YAxis hide domain={[0, "auto"]} />
            <Tooltip
              contentStyle={{
                background: "#12121a",
                border: "1px solid #34344a",
                borderRadius: 8,
                fontSize: 11,
              }}
              labelFormatter={(ts) => new Date(ts as number).toLocaleTimeString()}
              formatter={(value) => {
                const v = Number(value);
                return [formatter ? formatter(v) : `${v}${unit ?? ""}`, title];
              }}
            />
            <Area
              type="monotone"
              dataKey={dataKey}
              stroke={color}
              strokeWidth={2}
              fill={`url(#g-${dataKey})`}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
