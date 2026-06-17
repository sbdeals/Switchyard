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

const MAX_POINTS = 60;
const fmtMB = (b: number) => `${Math.round(b / 1024 / 1024)} MB`;

export function MetricsTab({ appName, active }: { appName: string; active: boolean }) {
  const [data, setData] = useState<Sample[]>([]);
  const [idle, setIdle] = useState(false);

  useEffect(() => {
    if (!active || !appName) return;
    const es = new EventSource(`/api/services/metrics?app=${encodeURIComponent(appName)}`);
    es.addEventListener("idle", () => setIdle(true));
    es.onmessage = (e) => {
      try {
        const s = JSON.parse(e.data) as Sample;
        if (!s || typeof s.cpu !== "number") return;
        setData((prev) => [...prev, s].slice(-MAX_POINTS));
      } catch {
        /* ignore */
      }
    };
    return () => es.close();
  }, [appName, active]);

  if (idle) {
    return (
      <div className="flex h-40 items-center justify-center text-sm text-[var(--color-fg-subtle)]">
        No metrics — the service isn&apos;t running.
      </div>
    );
  }

  const last = data[data.length - 1];

  return (
    <div className="space-y-5">
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
      <Chart
        title="Memory"
        data={data}
        dataKey="memUsed"
        color="#3ecf8e"
        formatter={fmtMB}
      />

      {data.length === 0 && (
        <div className="flex items-center justify-center gap-2 text-xs text-[var(--color-fg-subtle)]">
          <Loader2 className="size-4 animate-spin" /> sampling…
        </div>
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
