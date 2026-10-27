import { parseDeeplink } from "./deeplink";

export function createDirtyRegistry() {
  const forms = new Map<string, { label: string; dirty: boolean; scope?: string }>();

  return {
    set(key: string, label: string, dirty: boolean, scope?: string) {
      forms.set(key, { label, dirty, scope });
    },
    remove(key: string) {
      forms.delete(key);
    },
    removeScope(scope: string) {
      for (const [key, form] of forms) {
        if (form.scope === scope) forms.delete(key);
      }
    },
    retainScope(scope: string | null) {
      for (const [key, form] of forms) {
        if (form.scope !== scope) forms.delete(key);
      }
    },
    clear() {
      forms.clear();
    },
    labels(scope?: string): string[] {
      return [...new Set([...forms.values()]
        .filter((form) => form.dirty && (scope === undefined || form.scope === scope))
        .map((form) => form.label))];
    },
  };
}

export function decideDirtyNavigation(
  labels: readonly string[],
  pending: boolean,
  sameTarget = false,
): "proceed" | "confirm" | "ignore" {
  if (sameTarget || pending) return "ignore";
  return labels.length > 0 ? "confirm" : "proceed";
}

export function decideDeeplinkNavigation(
  currentQuery: string | URLSearchParams,
  targetQuery: string | URLSearchParams,
  services: Parameters<typeof parseDeeplink>[1],
  labels: readonly string[],
  pending: boolean,
  popstate = false,
): {
  decision: "proceed" | "confirm" | "ignore" | "repair";
  restore: boolean;
  target: ReturnType<typeof parseDeeplink>;
} {
  const current = parseDeeplink(currentQuery, services);
  const target = parseDeeplink(targetQuery, services);
  if (target.invalidService || target.invalidTab) {
    // Repair (close / fall back to Overview) silently only when nothing would be
    // lost: no dirty form, or the repaired destination is what is already shown.
    // Otherwise a stale/unknown id must not bypass the guard: confirm first and
    // apply the repaired target only on Discard.
    if (labels.length === 0 || (current.serviceId === target.serviceId && current.tab === target.tab)) {
      return { decision: "repair", restore: false, target };
    }
    const decision = decideDirtyNavigation(labels, pending);
    return { decision, restore: popstate, target };
  }
  if (current.serviceId === target.serviceId && current.tab === target.tab) {
    return { decision: "ignore", restore: false, target };
  }
  const decision = decideDirtyNavigation(labels, pending);
  return {
    decision,
    restore: popstate && (decision === "confirm" || (decision === "ignore" && labels.length > 0)),
    target,
  };
}

export function discardMessage(labels: readonly string[]): string {
  return labels.length > 0
    ? `Discard unsaved changes in ${labels.join(", ")}?`
    : "Discard unsaved changes?";
}

export function hasDirtyFields<T extends object>(draft: T, baseline: T): boolean {
  const keys = Object.keys(draft) as (keyof T)[];
  return keys.length !== Object.keys(baseline).length || keys.some((key) => draft[key] !== baseline[key]);
}
