export interface VariableRow {
  /** Starting physical line, including comments and blank lines. */
  index: number;
  key: string;
  /** Raw right-hand side, including whitespace, quotes and embedded newlines. */
  value: string;
  start: number;
  end: number;
  keyStart: number;
  keyEnd: number;
  lineStart: number;
  /** End of the whole assignment, including its trailing newline if present. */
  lineEnd: number;
}

export interface VariableRowIssue {
  index: number;
  key: string;
  message: string;
}

const VALID_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

function physicalLine(template: string, start: number) {
  const newline = template.indexOf("\n", start);
  const end = newline < 0 ? template.length : newline;
  return { end: end > start && template[end - 1] === "\r" ? end - 1 : end, next: newline < 0 ? end : end + 1 };
}

function closingQuote(template: string, start: number, quote: string) {
  let escaped = false;
  for (let i = start + 1; i < template.length; i++) {
    if (!escaped && template[i] === quote) return i;
    escaped = !escaped && template[i] === "\\";
  }
  return -1;
}

function parseVariableRows(template: string) {
  const rows: VariableRow[] = [];
  const issues: VariableRowIssue[] = [];
  let offset = 0;
  let index = 0;
  while (offset < template.length) {
    let line = physicalLine(template, offset);
    const text = template.slice(offset, line.end);
    if (!text.trim() || text.trimStart().startsWith("#")) {
      offset = line.next;
      index++;
      continue;
    }
    const assignment = text.match(/^([ \t]*(?:export[ \t]+)?)([^=]*?)([ \t]*)=(.*)$/);
    if (!assignment) {
      issues.push({ index, key: "", message: "Expected a KEY=value assignment." });
      offset = line.next;
      index++;
      continue;
    }
    const key = assignment[2];
    const keyStart = offset + assignment[1].length;
    const start = offset + text.indexOf("=") + 1;
    const firstValue = assignment[4].search(/\S/);
    const quoteStart = start + firstValue;
    const quote = firstValue < 0 ? "" : template[quoteStart];
    if (quote === '"' || quote === "'" || quote === "`") {
      const close = closingQuote(template, quoteStart, quote);
      if (close < 0) {
        issues.push({ index, key, message: "Value has an unclosed quote." });
        line = { end: template.length, next: template.length };
      } else {
        line = physicalLine(template, close);
      }
    }
    rows.push({ index, key, value: template.slice(start, line.end), start, end: line.end, keyStart, keyEnd: keyStart + key.length, lineStart: offset, lineEnd: line.next });
    index += (template.slice(offset, line.next).match(/\n/g) ?? []).length;
    offset = line.next;
  }
  return { rows, issues };
}

/** Offsets refer to the editable template, never to expanded secret values. */
export function variableRows(template: string): VariableRow[] {
  return parseVariableRows(template).rows;
}

export function updateVariableRow(template: string, index: number, patch: { key?: string; value?: string }): string {
  const row = variableRows(template).find((candidate) => candidate.index === index);
  if (!row) return template;
  return template.slice(0, row.keyStart) + (patch.key ?? row.key) + template.slice(row.keyEnd, row.start) + (patch.value ?? row.value) + template.slice(row.end);
}

export function appendVariableRow(template: string, key: string, value: string): string {
  const newline = template.match(/\r?\n/)?.[0] ?? "\n";
  const terminated = template.endsWith("\n");
  return template + (template && !terminated ? newline : "") + `${key}=${value}` + (terminated ? newline : "");
}

function removeRow(template: string, row: VariableRow): string {
  let start = row.lineStart;
  if (row.lineEnd === template.length && !template.endsWith("\n") && start > 0) {
    start -= template[start - 2] === "\r" ? 2 : 1;
  }
  return template.slice(0, start) + template.slice(row.lineEnd);
}

export function removeVariableRow(template: string, index: number): string {
  const row = variableRows(template).find((candidate) => candidate.index === index);
  return row ? removeRow(template, row) : template;
}

/** Existing rows retain their position and surrounding text; new indices append. */
export function serializeVariableRows(template: string, rows: readonly Pick<VariableRow, "index" | "key" | "value">[]): string {
  const original = variableRows(template);
  const byIndex = new Map(rows.map((row) => [row.index, row]));
  let result = template;
  for (const row of [...original].reverse()) {
    const next = byIndex.get(row.index);
    result = next
      ? result.slice(0, row.keyStart) + next.key + result.slice(row.keyEnd, row.start) + next.value + result.slice(row.end)
      : removeRow(result, row);
    byIndex.delete(row.index);
  }
  for (const row of byIndex.values()) result = appendVariableRow(result, row.key, row.value);
  return result;
}

/** Validate table drafts before serialization, so invalid keys stay editable. */
export function validateVariableEntries(rows: readonly Pick<VariableRow, "index" | "key" | "value">[]): VariableRowIssue[] {
  const issues: VariableRowIssue[] = [];
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.key, (counts.get(row.key) ?? 0) + 1);
  for (const row of rows) {
    if (!VALID_KEY.test(row.key)) issues.push({ index: row.index, key: row.key, message: "Use letters, numbers and underscores; start with a letter or underscore." });
    if ((counts.get(row.key) ?? 0) > 1) issues.push({ index: row.index, key: row.key, message: `Duplicate key "${row.key}".` });
    // A safe synthetic key keeps separator/comment characters in an invalid
    // draft key from hiding its value issues or creating another assignment.
    const parsed = parseVariableRows(`VALUE=${row.value}`);
    if (parsed.rows[0]?.value !== row.value) {
      issues.push({ index: row.index, key: row.key, message: "Wrap multiline values in quotes." });
    } else {
      issues.push(...parsed.issues.map((issue) => ({ index: row.index, key: row.key, message: issue.message })));
    }
  }
  return issues.sort((a, b) => a.index - b.index);
}

export function validateVariableRows(template: string): VariableRowIssue[] {
  const { rows, issues } = parseVariableRows(template);
  // Entry validation also reports unclosed quotes, leaving only non-row
  // syntax errors from the original document to add here.
  return [...issues.filter((issue) => !rows.some((row) => row.index === issue.index)), ...validateVariableEntries(rows)]
    .sort((a, b) => a.index - b.index);
}
