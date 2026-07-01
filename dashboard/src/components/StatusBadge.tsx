import { STATUS_META } from "@/lib/service-meta";

export function StatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[status] ?? STATUS_META.idle;
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium"
      style={{ backgroundColor: meta.soft, color: meta.color }}
    >
      <span
        className={`size-1.5 rounded-full ${meta.pulse ? "animate-pulse" : ""}`}
        style={{ backgroundColor: meta.color }}
      />
      {meta.label}
    </span>
  );
}
