export type SharedScope = "project" | "environment";

export interface SharedVariables {
  project: string;
  environment: string;
}

export interface SharedVariableKeys {
  project: string[];
  environment: string[];
}

export interface VariableEntry {
  key: string;
  value: string;
  /** Original source offsets; end includes the declaration's line ending. */
  start: number;
  end: number;
  valueStart: number;
  valueEnd: number;
}

export interface SharedReference {
  variable: string;
  scope: SharedScope;
  key: string;
  reference: string;
  defined: boolean;
}

/** Match Dokploy v0.30.10's dotenv 16.4.5 grammar, retaining source offsets. */
export function parseVariables(source: string): VariableEntry[] {
  // dotenv normalizes line endings before parsing. Keep a map so edits still
  // preserve the original CRLF/CR bytes and unrelated comments/blank lines.
  const offsets: number[] = [];
  const characters: string[] = [];
  for (let i = 0; i < source.length; i++) {
    offsets.push(i);
    characters.push(source[i] === "\r" ? "\n" : source[i]);
    if (source[i] === "\r" && source[i + 1] === "\n") i++;
  }
  offsets.push(source.length);
  const normalized = characters.join("");
  const line = /(^\s*(?:export\s+)?([\w.-]+)(?:\s*=\s*?|:\s+?))(\s*'(?:\\'|[^'])*'|\s*"(?:\\"|[^"])*"|\s*`(?:\\`|[^`])*`|[^#\r\n]+)?\s*(?:#.*)?$/gm;
  const entries: VariableEntry[] = [];
  for (const match of normalized.matchAll(line)) {
    const raw = match[3] ?? "";
    const trimmed = raw.trim();
    const valueOffset = match.index + match[1].length;
    const valueStart = valueOffset + (trimmed ? raw.length - raw.trimStart().length : 0);
    const valueEnd = valueStart + trimmed.length;
    const declarationStart = match.index + match[1].search(/\S/);
    const start = normalized.lastIndexOf("\n", declarationStart - 1) + 1;
    const newline = normalized.indexOf("\n", valueEnd);
    let value = trimmed.replace(/^(['"`])([\s\S]*)\1$/m, "$2");
    if (trimmed.startsWith('"')) value = value.replace(/\\n/g, "\n").replace(/\\r/g, "\r");
    entries.push({
      key: match[2],
      value,
      start: offsets[start],
      end: offsets[newline < 0 ? normalized.length : newline + 1],
      valueStart: offsets[valueStart],
      valueEnd: offsets[valueEnd],
    });
  }
  return entries;
}

/** Duplicate declarations follow dotenv: the last value wins. */
export function variableValues(source: string): Record<string, string> {
  const values: Record<string, string> = Object.create(null);
  for (const { key, value } of parseVariables(source)) values[key] = value;
  return values;
}

function assertKey(key: string) {
  if (!/^[\w.-]+$/.test(key)) throw new Error("Variable names may only contain letters, numbers, underscores, dots, and hyphens.");
}

function serializeValue(value: string): string {
  // dotenv does not unescape quotes. Choose a representation that round-trips
  // rather than silently adding backslashes or interpreting a literal \\n.
  const candidates = [value, `'${value}'`, `"${value.replace(/\n/g, "\\n").replace(/\r/g, "\\r")}"`, `\`${value}\``];
  for (const candidate of candidates) {
    const entries = parseVariables(`VALUE=${candidate}`);
    if (entries.length === 1 && entries[0].value === value) return candidate;
  }
  throw new Error("This value cannot be represented losslessly in dotenv format. Try simplifying its quotes or line breaks.");
}

/** Edit only the effective declaration, retaining its spacing and comment. */
export function setVariable(source: string, key: string, value: string): string {
  assertKey(key);
  const entry = parseVariables(source).filter((item) => item.key === key).at(-1);
  if (entry?.value === value) return source;
  const serialized = serializeValue(value);
  if (entry) return source.slice(0, entry.valueStart) + serialized + source.slice(entry.valueEnd);
  const newline = source.match(/\r\n|\r|\n/)?.[0] ?? "\n";
  const separator = source && !/[\r\n]$/.test(source) ? newline : "";
  return `${source}${separator}${key}=${serialized}${newline}`;
}

/** Remove every declaration so an earlier duplicate cannot become active. */
export function removeVariable(source: string, key: string): string {
  const entries = parseVariables(source).filter((entry) => entry.key === key);
  for (const entry of entries.reverse()) source = source.slice(0, entry.start) + source.slice(entry.end);
  return source;
}

export function sharedReference(scope: SharedScope, key: string): string {
  assertKey(key);
  return `\${{${scope}.${key}}}`;
}

/** Report direct references without exposing shared values to row labels. */
export function sharedReferences(source: string, keys: SharedVariableKeys): SharedReference[] {
  const names = { project: new Set(keys.project), environment: new Set(keys.environment) };
  const references: SharedReference[] = [];
  for (const [variable, value] of Object.entries(variableValues(source))) {
    // Dokploy matches the key exactly: whitespace is meaningful, not trimmed.
    for (const match of value.matchAll(/\$\{\{(project|environment)\.(.*?)\}\}/g)) {
      const scope = match[1] as SharedScope;
      references.push({ variable, scope, key: match[2], reference: match[0], defined: names[scope].has(match[2]) });
    }
  }
  return references;
}
