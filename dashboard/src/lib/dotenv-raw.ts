export interface DotenvRawIssue {
  line: number;
  message: string;
}

export interface DotenvRawResult {
  variables: Record<string, string>;
  errors: DotenvRawIssue[];
  warnings: DotenvRawIssue[];
}

interface DotenvAssignment {
  key: string;
  value: string;
  start: number;
  end: number;
  valueStart: number;
  valueEnd: number;
  comment: string;
}

function scanDotenvRaw(text: string) {
  let offset = 0;
  const lines = text.split("\n").map((source, index, all) => {
    const newline = index === all.length - 1 ? "" : source.endsWith("\r") ? "\r\n" : "\n";
    const start = offset;
    offset += source.length + (newline ? 1 : 0);
    return { source: newline === "\r\n" ? source.slice(0, -1) : source, start, newline };
  });
  const variables = new Map<string, string>();
  const errors: DotenvRawIssue[] = [];
  const warnings: DotenvRawIssue[] = [];
  const assignments: DotenvAssignment[] = [];

  for (let index = 0; index < lines.length; index++) {
    const line = index + 1;
    const firstLine = lines[index];
    const source = firstLine.source.trimStart();
    if (!source || source.startsWith("#")) continue;

    const assignment = source.replace(/^export\s+/, "");
    const separator = assignment.indexOf("=");
    if (separator < 0) {
      errors.push({ line, message: "Expected KEY=value." });
      continue;
    }

    const key = assignment.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      errors.push({ line, message: "Invalid key. Use letters, numbers and underscores; start with a letter or underscore." });
      continue;
    }

    let remainder = assignment.slice(separator + 1).trimStart();
    const valueStart = firstLine.start + firstLine.source.length - remainder.length;
    let remainderStart = valueStart;
    let valueEnd = valueStart;
    const quote = remainder[0];
    let value = "";
    if (quote === '"' || quote === "'") {
      let closed = false;
      let position = 1;
      while (true) {
        while (position < remainder.length) {
          const character = remainder[position++];
          if (character === quote) {
            closed = true;
            break;
          }
          if (quote === '"' && character === "\\" && position < remainder.length) {
            const escaped = remainder[position++];
            switch (escaped) {
              case "n": value += "\n"; break;
              case "r": value += "\r"; break;
              case "t": value += "\t"; break;
              case '"': value += '"'; break;
              case "\\": value += "\\"; break;
              default: value += `\\${escaped}`;
            }
          } else {
            value += character;
          }
        }
        if (closed || index + 1 >= lines.length) break;
        value += "\n";
        remainder = lines[++index].source;
        remainderStart = lines[index].start;
        position = 0;
      }
      if (!closed) {
        errors.push({ line, message: "Unclosed quoted value." });
        continue;
      }
      const trailing = remainder.slice(position).trim();
      if (trailing && !trailing.startsWith("#")) {
        errors.push({ line, message: "Unexpected text after quoted value." });
        continue;
      }
      valueEnd = remainderStart + position;
    } else {
      value = remainder.split("#", 1)[0].trimEnd();
      valueEnd = valueStart + value.length;
    }

    if (variables.has(key)) {
      warnings.push({ line, message: `Duplicate key ${key}; the last value wins.` });
    }
    variables.set(key, value);
    const lastLine = lines[index];
    const lineEnd = lastLine.start + lastLine.source.length;
    const trailing = text.slice(valueEnd, lineEnd);
    const commentIndex = trailing.indexOf("#");
    assignments.push({
      key,
      value,
      start: firstLine.start,
      end: lineEnd + lastLine.newline.length,
      valueStart,
      valueEnd,
      comment: commentIndex < 0 ? "" : firstLine.source.slice(0, firstLine.source.length - source.length) + trailing.slice(commentIndex) + lastLine.newline,
    });
  }

  return { variables: Object.fromEntries(variables), errors, warnings, assignments };
}

/** Parse dotenv without expanding references. Source spans stay internal to row edits. */
export function parseDotenvRaw(text: string): DotenvRawResult {
  const { variables, errors, warnings } = scanDotenvRaw(text);
  return { variables, errors, warnings };
}

function serializeDotenvValue(value: string): string {
  if (!/[\s#"'\\]/.test(value)) return value;
  const quoted = value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
  return `"${quoted}"`;
}

/** Canonical dotenv text; quotes protect whitespace, comments and escapes. */
export function serializeDotenvRaw(variables: Record<string, string>): string {
  return Object.entries(variables).map(([key, value]) => `${key}=${serializeDotenvValue(value)}`).join("\n");
}

/** Edit only the last (effective) occurrence; unchanged values retain their exact text. */
export function setDotenvValue(text: string, key: string, value: string): string {
  const parsed = scanDotenvRaw(text);
  if (parsed.errors.length) return text;
  const assignment = parsed.assignments.findLast((entry) => entry.key === key);
  if (!assignment || assignment.value === value) return text;
  return text.slice(0, assignment.valueStart) + serializeDotenvValue(value) + text.slice(assignment.valueEnd);
}

/** Remove every occurrence so an earlier duplicate cannot become effective. Keep comments. */
export function removeDotenvKey(text: string, key: string): string {
  const parsed = scanDotenvRaw(text);
  if (parsed.errors.length) return text;
  for (const assignment of parsed.assignments.filter((entry) => entry.key === key).reverse()) {
    text = text.slice(0, assignment.start) + assignment.comment + text.slice(assignment.end);
  }
  return text;
}

/** Append a new key without rewriting existing bytes, using the document's newline style. */
export function appendDotenvKey(text: string, key: string, value: string): string {
  const parsed = scanDotenvRaw(text);
  if (parsed.errors.length || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || Object.hasOwn(parsed.variables, key)) return text;
  const newline = text.match(/\r\n|\n/)?.[0] ?? "\n";
  const separator = text && !text.endsWith("\n") ? newline : "";
  const ending = text.endsWith("\n") ? newline : "";
  return `${text}${separator}${key}=${serializeDotenvValue(value)}${ending}`;
}

/** Return only key names so previews never need to expose secret values. */
export function diffDotenvRaw(before: Record<string, string>, after: Record<string, string>) {
  return {
    added: Object.keys(after).filter((key) => !Object.hasOwn(before, key)),
    changed: Object.keys(after).filter((key) => Object.hasOwn(before, key) && before[key] !== after[key]),
    removed: Object.keys(before).filter((key) => !Object.hasOwn(after, key)),
  };
}
