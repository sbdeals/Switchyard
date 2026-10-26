import { templateEntries } from "@/lib/references";
import type { Mount, MountPatch } from "@/lib/dokploy";

interface CollectionOperation {
  id: string;
  action: string;
  args: unknown[];
}

/** Overlay pending writes on the server list without mutating either input. */
export function stagedCollection<T>(
  items: T[],
  operations: CollectionOperation[],
  config: {
    key: (item: T) => string;
    create: string;
    remove: string;
    update?: string;
    added: (operation: CollectionOperation) => T;
    updated?: (item: T, operation: CollectionOperation) => T;
  }
): T[] {
  return operations.reduce((result, operation) => {
    if (operation.action === config.create) return [...result, config.added(operation)];
    if (operation.action === config.remove) {
      return result.filter((item) => config.key(item) !== operation.args[0]);
    }
    if (operation.action === config.update && config.updated) {
      return result.map((item) => config.key(item) === operation.args[0]
        ? config.updated!(item, operation) : item);
    }
    return result;
  }, items);
}

/** Per-variable diff labels; keep edits to comments/formatting visible too. */
export function stagedVariableValues(original: string, value: string) {
  const before: Record<string, unknown> = Object.fromEntries(
    templateEntries(original).map(([key, entry]) => [`Variable ${key}`, entry])
  );
  const after: Record<string, unknown> = Object.fromEntries(
    templateEntries(value).map(([key, entry]) => [`Variable ${key}`, entry])
  );
  const fields = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  if (original !== value && fields.every((field) => before[field] === after[field])) {
    before["Variables formatting"] = original;
    after["Variables formatting"] = value;
    fields.push("Variables formatting");
  }
  return { before, after, secretFields: fields };
}

/** Treat empty file contents consistently and never reveal them in the diff. */
export function stagedMountValues(original: Mount | undefined, patch: MountPatch) {
  const labels: Record<string, string> = { type: "Type", mountPath: "Mount path", volumeName: "Volume name", hostPath: "Host path", filePath: "File name", content: "Content" };
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  const secretFields: string[] = [];
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const field = `Mount ${original?.mountPath ?? patch.mountPath}: ${labels[key]}`;
    before[field] = original ? original[key as keyof Mount] ?? "" : null;
    after[field] = value;
    if (key === "content") secretFields.push(field);
  }
  return { before, after, secretFields };
}
