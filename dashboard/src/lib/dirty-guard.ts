export function createDirtyRegistry() {
  const forms = new Map<string, { label: string; dirty: boolean }>();

  return {
    set(key: string, label: string, dirty: boolean) {
      forms.set(key, { label, dirty });
    },
    remove(key: string) {
      forms.delete(key);
    },
    clear() {
      forms.clear();
    },
    labels(): string[] {
      return [...new Set([...forms.values()].filter((form) => form.dirty).map((form) => form.label))];
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

export function discardMessage(labels: readonly string[]): string {
  return labels.length > 0
    ? `Discard unsaved changes in ${labels.join(", ")}?`
    : "Discard unsaved changes?";
}

export function hasDirtyFields<T extends object>(draft: T, baseline: T): boolean {
  const keys = Object.keys(draft) as (keyof T)[];
  return keys.length !== Object.keys(baseline).length || keys.some((key) => draft[key] !== baseline[key]);
}
