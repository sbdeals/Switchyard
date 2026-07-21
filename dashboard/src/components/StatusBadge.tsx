import type { ServiceRuntime } from "@/lib/dokploy";
import { resolveServiceDisplay } from "@/lib/service-meta";

/**
 * Status pill: engine truth when `runtime` is provided (what's actually
 * running), deploy lifecycle otherwise. Text + dot, never color alone.
 */
export function StatusBadge({ status, runtime }: { status: string; runtime?: ServiceRuntime }) {
  const meta = resolveServiceDisplay(status, runtime);
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
      {meta.detail ? <span className="font-normal">&middot; {meta.detail}</span> : null}
    </span>
  );
}
