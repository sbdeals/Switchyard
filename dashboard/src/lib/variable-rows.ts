import { templateEntries } from "@/lib/references";

/** Offsets refer to the editable template, never to expanded secret values. */
export function variableRows(template: string) {
  let offset = 0;
  return template.split("\n").flatMap((line, index) => {
    const start = offset;
    offset += line.length + 1;
    const entry = templateEntries(line)[0];
    return entry ? [{ index, key: entry[0], value: entry[1], start: start + line.indexOf("=") + 1, end: start + line.length }] : [];
  });
}

export function removeVariableRow(template: string, index: number): string {
  if (!variableRows(template).some((row) => row.index === index)) return template;
  const lines = template.split("\n");
  lines.splice(index, 1);
  return lines.join("\n");
}
