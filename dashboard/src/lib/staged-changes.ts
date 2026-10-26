import type { StagedAction } from "./staged-apply";

export interface StagedChange {
  field: string;
  before: unknown;
  after: unknown;
  secret?: boolean;
}

export interface StagedOperation {
  id: string;
  action: StagedAction;
  args: unknown[];
  changes: StagedChange[];
  error?: string;
}

export interface StagedState {
  operations: StagedOperation[];
  drafts: Record<string, unknown>;
  applied: Record<string, string>;
}

export const emptyStagedState = (): StagedState => ({ operations: [], drafts: {}, applied: {} });

export type StagedEvent =
  | { type: "stage"; operation: StagedOperation }
  | { type: "draft"; key: string; value: unknown }
  | { type: "discard"; id?: string }
  | { type: "applied"; ids: string[] };

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Keep the first baseline until a change is discarded or applied. */
export function stagingReducer(state: StagedState, event: StagedEvent): StagedState {
  if (event.type === "draft") {
    if (same(state.drafts[event.key], event.value)) return state;
    return { ...state, drafts: { ...state.drafts, [event.key]: event.value } };
  }
  if (event.type === "discard") {
    if (!event.id) return emptyStagedState();
    return { ...state, operations: state.operations.filter((op) => op.id !== event.id) };
  }
  if (event.type === "applied") {
    const applied = { ...state.applied };
    for (const op of state.operations) {
      if (event.ids.includes(op.id)) applied[op.id] = JSON.stringify(op.args);
    }
    return { ...state, applied, operations: state.operations.filter((op) => !event.ids.includes(op.id)) };
  }
  const incoming = event.operation;
  if (state.applied[incoming.id] === JSON.stringify(incoming.args)) {
    return state.operations.some((op) => op.id === incoming.id)
      ? { ...state, operations: state.operations.filter((op) => op.id !== incoming.id) }
      : state;
  }
  const previous = state.operations.find((op) => op.id === incoming.id);
  const changes = incoming.changes.map((change) => {
    const original = previous?.changes.find((item) => item.field === change.field);
    return original ? { ...change, before: original.before } : change;
  }).filter((change) => !same(change.before, change.after));
  const operation = { ...incoming, changes };
  if (changes.length === 0 && !previous) return state;
  if (same(previous, operation)) return state;
  const operations = state.operations.filter((op) => op.id !== incoming.id);
  if (changes.length) operations.push(operation);
  return { ...state, operations };
}

export function stagedChangeCount(operations: StagedOperation[]): number {
  return operations.reduce((count, op) => count + op.changes.length, 0);
}

/** Never reveal secret length, contents, or nested values in the review table. */
export function displayStagedValue(value: unknown, secret = false): string {
  if (value === undefined || value === null || value === "") return "—";
  if (secret) return "••••••••";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}
