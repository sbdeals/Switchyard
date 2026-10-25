import { describe, expect, it } from "vitest";
import { removeVariableRow, variableRows } from "@/lib/variable-rows";

describe("variable rows", () => {
  it("skips comments and malformed lines, preserving raw templates and duplicate keys", () => {
    const template = "# keep me\n\nexport URL=${{db.URL}}\nTOKEN=one=two\ninvalid\nTOKEN=last\nEMPTY=";
    const rows = variableRows(template);
    expect(rows.map(({ index, key, value }) => ({ index, key, value }))).toEqual([
      { index: 2, key: "URL", value: "${{db.URL}}" },
      { index: 3, key: "TOKEN", value: "one=two" },
      { index: 5, key: "TOKEN", value: "last" },
      { index: 6, key: "EMPTY", value: "" },
    ]);
    for (const row of rows) expect(template.slice(row.start, row.end)).toBe(row.value);
  });

  it("selects just the value for editing, including whitespace, quotes and Unicode", () => {
    const template = '  export GREETING = "héllo 🌻"\nNEXT=ok';
    const [row, next] = variableRows(template);
    expect(template.slice(row.start, row.end)).toBe(' "héllo 🌻"');
    expect(template.slice(next.start, next.end)).toBe("ok");
  });

  it("deletes only the chosen draft row without rewriting comments, references or duplicate keys", () => {
    const template = "# comment\nA=one\n\nA=two\nREF=${{db.URL}}\n";
    expect(removeVariableRow(template, 1)).toBe("# comment\n\nA=two\nREF=${{db.URL}}\n");
    expect(removeVariableRow(template, 3)).toBe("# comment\nA=one\n\nREF=${{db.URL}}\n");
    expect(removeVariableRow("A=one", 0)).toBe("");
  });

  it("does not remove comments, blank lines, or stale indices", () => {
    const template = "# comment\n\nA=one";
    for (const index of [-1, 0, 1, 100]) expect(removeVariableRow(template, index)).toBe(template);
    expect(variableRows("")).toEqual([]);
  });
});
