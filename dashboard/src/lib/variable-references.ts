import type { Service } from "@/lib/dokploy";
import { referenceableKeys } from "@/lib/reference-vars";
import { resolveTemplate, type RefTarget } from "@/lib/references";
import { variableRows, type VariableRow, type VariableRowIssue } from "@/lib/variable-rows";

/** Suggestions contain only names, never the referenced variable's value. */
export interface ReferenceSuggestion {
  label: string;
  insertText: string;
  kind: "variable" | "builtin";
  self: boolean;
}

export interface ReferenceCompletion {
  start: number;
  end: number;
  query: string;
  suggestions: ReferenceSuggestion[];
  hiddenCount: number;
}

export function referenceSuggestions(
  services: readonly Service[],
  self: Service,
  template?: string
): ReferenceSuggestion[] {
  const local = [self, ...services.filter((s) => s.id !== self.id || s.kind !== self.kind)]
    .filter((s) => s.projectId === self.projectId && s.environmentId === self.environmentId);
  const suggestions = new Map<string, ReferenceSuggestion>();
  for (const service of local) {
    const current = service === self && template !== undefined ? { ...service, env: template } : service;
    const { own, builtin } = referenceableKeys(current);
    for (const [keys, kind] of [[own, "variable"], [builtin, "builtin"]] as const) {
      for (const key of keys) {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
        const label = `${service.name}.${key}`;
        if (!suggestions.has(label)) suggestions.set(label, { label, insertText: `\${{${label}}}`, kind, self: service === self });
      }
    }
  }
  return [...suggestions.values()];
}

/** Find the reference at the caret, including its existing closing braces. */
export function getReferenceCompletion(
  value: string,
  caret: number,
  suggestions: readonly ReferenceSuggestion[],
  editingKey?: string
): ReferenceCompletion | null {
  if (caret < 3 || caret > value.length) return null;
  const start = value.lastIndexOf("${{", caret - 3);
  if (start < 0 || value[start - 1] === "$") return null;
  const query = value.slice(start + 3, caret);
  if (/[{}\r\n]/.test(query)) return null;
  const close = value.indexOf("}}", caret);
  const end = close >= 0 && !/[{}\r\n]/.test(value.slice(caret, close)) ? close + 2 : caret;
  const search = query.trim().toLowerCase();
  const key = (suggestion: ReferenceSuggestion) => suggestion.label.slice(suggestion.label.lastIndexOf(".") + 1);
  const group = (suggestion: ReferenceSuggestion) => suggestion.kind === "builtin" ? 2 : suggestion.self ? 1 : 0;
  const prefix = (suggestion: ReferenceSuggestion) => suggestion.label.toLowerCase().startsWith(search) || key(suggestion).toLowerCase().startsWith(search);
  const matches = suggestions
    .filter((suggestion) => !(suggestion.self && key(suggestion) === editingKey) && suggestion.label.toLowerCase().includes(search))
    .sort((a, b) => group(a) - group(b) || Number(prefix(b)) - Number(prefix(a)));
  return {
    start,
    end,
    query,
    suggestions: matches.slice(0, 8),
    hiddenCount: Math.max(0, matches.length - 8),
  };
}

/** Replace only the active reference; keep surrounding literals/references. */
export function applyReferenceCompletion(
  value: string,
  completion: ReferenceCompletion,
  suggestion: ReferenceSuggestion
): { value: string; caret: number } {
  return {
    value: value.slice(0, completion.start) + suggestion.insertText + value.slice(completion.end),
    caret: completion.start + suggestion.insertText.length,
  };
}

export function referenceOptionIndex(current: number, key: "ArrowDown" | "ArrowUp", count: number): number {
  if (count <= 0) return 0;
  return (current + (key === "ArrowDown" ? 1 : -1) + count) % count;
}

/** The resolver checks closed references; report unfinished/empty ones too. */
export function validateReferenceSyntax(value: string): string[] {
  const issues = new Set<string>();
  for (const match of value.matchAll(/\$\{\{/g)) {
    if (value[match.index - 1] === "$") continue;
    const close = value.indexOf("}}", match.index + 3);
    const inner = value.slice(match.index + 3, close < 0 ? undefined : close);
    if (close < 0 || /[{}\r\n]/.test(inner)) issues.add("Finish the reference with }}.");
    else if (!inner.trim()) issues.add("A reference cannot be empty.");
  }
  return [...issues];
}

/** Check every physical row, including duplicates and quoted multiline values. */
export function validateVariableReferences(
  template: string,
  selfName: string,
  targets: readonly RefTarget[],
  rows: readonly Pick<VariableRow, "index" | "key" | "value">[] = variableRows(template)
): VariableRowIssue[] {
  const flatten = (value: string) => value.replace(/\r?\n/g, " ");
  const draft = rows.map((row) => `${row.key}=${flatten(row.value)}`).join("\n");
  let fallbackKey = "__SWITCHYARD_REFERENCE_CHECK";
  while (rows.some((row) => row.key === fallbackKey)) fallbackKey += "_";
  return rows.flatMap((row) => {
    const key = /^[A-Za-z_][A-Za-z0-9_]*$/.test(row.key) ? row.key : fallbackKey;
    // Last assignment wins in the resolver. Reappend this row so duplicates
    // are each checked against the full draft, retaining normal self cycles.
    const checked = `${draft}\n${key}=${flatten(row.value)}`;
    const messages = new Set(validateReferenceSyntax(row.value));
    for (const issue of resolveTemplate(checked, selfName, targets).issues) {
      if (issue.key === key) messages.add(issue.message.replaceAll(`${selfName}.${fallbackKey}`, `${selfName}.${row.key}`));
    }
    return [...messages].map((message) => ({ index: row.index, key: row.key, message }));
  });
}
