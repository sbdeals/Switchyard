import { describe, expect, it } from "vitest";
import { appendVariableRow, removeVariableRow, serializeVariableRows, updateVariableRow, validateVariableEntries, validateVariableRows, variableRows } from "@/lib/variable-rows";

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

  it("keeps quoted multiline values in one row and retains physical line indices", () => {
    const template = '# certificate\nPEM="first\n# inside value\n\nlast"\nNEXT=ok';
    const rows = variableRows(template);
    expect(rows.map(({ index, key, value }) => ({ index, key, value }))).toEqual([
      { index: 1, key: "PEM", value: '"first\n# inside value\n\nlast"' },
      { index: 5, key: "NEXT", value: "ok" },
    ]);
    expect(template.slice(rows[0].lineStart, rows[0].lineEnd)).toBe('PEM="first\n# inside value\n\nlast"\n');
    expect(removeVariableRow(template, 1)).toBe("# certificate\nNEXT=ok");
    expect(removeVariableRow(template, 3)).toBe(template);
  });

  it("honors escaped quotes and supports single quotes and backticks", () => {
    const template = 'A="one \\" two\nthree"\nB=\'four\nfive\'\nC=`six\nseven`\nD=end';
    expect(variableRows(template).map((row) => row.key)).toEqual(["A", "B", "C", "D"]);
    expect(validateVariableRows(template)).toEqual([]);
    expect(serializeVariableRows(template, variableRows(template))).toBe(template);
  });

  it.each([
    "",
    "# only comments\n\n",
    "# comment\n\nexport A=one\nA=two\n",
    '  export GREETING = "héllo 🌻" # keep\r\n\r\nMULTI=\'first\r\nlast\'\r\nEMPTY=',
    "INVALID KEY=value\nmalformed text\n=empty key\n",
    'UNCLOSED="first\nsecond\n',
  ])("serializes unchanged rows without rewriting any source text: %j", (template) => {
    expect(serializeVariableRows(template, variableRows(template))).toBe(template);
  });

  it("updates keys and values without changing export, whitespace, comments or line endings", () => {
    const template = '# keep\r\n  export OLD \t= "first\r\nlast"\r\nNEXT=ok\r\n';
    expect(updateVariableRow(template, 1, { key: "NEW" })).toBe('# keep\r\n  export NEW \t= "first\r\nlast"\r\nNEXT=ok\r\n');
    expect(updateVariableRow(template, 1, { value: ' "replacement"' })).toBe('# keep\r\n  export OLD \t= "replacement"\r\nNEXT=ok\r\n');
    expect(updateVariableRow(template, 3, { key: "FINAL", value: "" })).toBe('# keep\r\n  export OLD \t= "first\r\nlast"\r\nFINAL=\r\n');
    expect(updateVariableRow(template, 2, { key: "NOPE" })).toBe(template);
  });

  it("serializes multiple row edits, removals and additions against original offsets", () => {
    const template = '# keep\nexport FIRST = "one\ntwo"\n\nREMOVE=old\nLAST=end';
    const [first, , last] = variableRows(template);
    expect(serializeVariableRows(template, [
      { ...first, key: "RENAMED", value: '"new\nvalue\nextra"' },
      { ...last, value: "changed" },
      { index: -1, key: "ADDED", value: "${{db.URL}}" },
    ])).toBe('# keep\nexport RENAMED ="new\nvalue\nextra"\n\nLAST=changed\nADDED=${{db.URL}}');
    expect(serializeVariableRows("A=one\nB=two\nC=three", [])).toBe("");
  });

  it("preserves newline style and existing final-newline convention when adding rows", () => {
    expect(appendVariableRow("", "A", "one")).toBe("A=one");
    expect(appendVariableRow("# note\nA=one", "B", "two")).toBe("# note\nA=one\nB=two");
    expect(appendVariableRow("A=one\r\n", "B", '"two\r\nthree"')).toBe('A=one\r\nB="two\r\nthree"\r\n');
    expect(appendVariableRow("A=one\n\n", "EMPTY", "")).toBe("A=one\n\nEMPTY=\n");
  });

  it("removes the final row without introducing a trailing newline", () => {
    expect(removeVariableRow("A=one\r\nB=two", 1)).toBe("A=one");
    expect(removeVariableRow('A=one\nB="two\nthree"', 1)).toBe("A=one");
    expect(removeVariableRow('B="two\nthree"', 0)).toBe("");
  });

  it("keeps invalid assignment keys editable and validates strict shell identifiers", () => {
    const template = "BAD-KEY=one\nBAD.KEY=two\n1BAD=three\nBAD KEY=four\n=empty\n_GOOD_2=ok\nexport GOOD=ok";
    const rows = variableRows(template);
    expect(rows.map((row) => row.key)).toEqual(["BAD-KEY", "BAD.KEY", "1BAD", "BAD KEY", "", "_GOOD_2", "GOOD"]);
    expect(validateVariableRows(template).map(({ index, key }) => ({ index, key }))).toEqual(rows.slice(0, 5).map(({ index, key }) => ({ index, key })));
    expect(updateVariableRow(template, 0, { key: "FIXED" })).toBe(template.replace("BAD-KEY", "FIXED"));
    for (const row of rows) expect(template.slice(row.keyStart, row.keyEnd)).toBe(row.key);
  });

  it("flags every occurrence of duplicate keys and clears issues after a row is removed", () => {
    const template = "# comment\nA=one\nB=two\nA=last\na=case-sensitive\n";
    expect(validateVariableRows(template)).toEqual([
      { index: 1, key: "A", message: 'Duplicate key "A".' },
      { index: 3, key: "A", message: 'Duplicate key "A".' },
    ]);
    expect(validateVariableRows(removeVariableRow(template, 3))).toEqual([]);
  });

  it("flags malformed raw-editor lines and unclosed quotes without treating quoted content as assignments", () => {
    const template = '# okay\n\nnot an assignment\nA="first\nB=part of A\n';
    expect(validateVariableRows(template)).toEqual([
      { index: 2, key: "", message: "Expected a KEY=value assignment." },
      { index: 3, key: "A", message: "Value has an unclosed quote." },
    ]);
    expect(variableRows(template).map((row) => row.key)).toEqual(["A"]);
  });

  it("validates unsafe draft keys before they can become comments, prefixes or value separators", () => {
    const rows = ["#KEY", "BAD=KEY", "export KEY", "KEY\nOTHER", "", "BAD-KEY"].map((key, index) => ({ index: index + 10, key, value: "unchanged" }));
    expect(validateVariableEntries(rows).map(({ index, key }) => ({ index, key }))).toEqual(rows.map(({ index, key }) => ({ index, key })));
    expect(rows.every((row) => row.value === "unchanged")).toBe(true);
  });

  it("validates duplicates using stable draft row indices", () => {
    expect(validateVariableEntries([
      { index: 40, key: "A", value: "first" },
      { index: -1, key: "A", value: "second" },
    ])).toEqual([
      { index: -1, key: "A", message: 'Duplicate key "A".' },
      { index: 40, key: "A", message: 'Duplicate key "A".' },
    ]);
  });

  it.each(["one\ntwo", "one\nOTHER=two", "one\n# comment", "one\n", '"one"\nOTHER=two', "one\r\ntwo"])("rejects unquoted value newlines that would create extra document lines: %j", (value) => {
    expect(validateVariableEntries([{ index: 12, key: "DRAFT", value }])).toEqual([
      { index: 12, key: "DRAFT", message: "Wrap multiline values in quotes." },
    ]);
  });

  it("reports unclosed draft values on their original row without consuming other entries", () => {
    const rows = [
      { index: 7, key: "A", value: '"one\nOTHER=still inside A' },
      { index: 9, key: "B", value: "untouched" },
    ];
    expect(validateVariableEntries(rows)).toEqual([{ index: 7, key: "A", message: "Value has an unclosed quote." }]);
    expect(rows[1]).toEqual({ index: 9, key: "B", value: "untouched" });
    expect(validateVariableEntries([{ index: 7, key: "BAD=KEY", value: '"open' }]).map((issue) => issue.message)).toEqual([
      "Use letters, numbers and underscores; start with a letter or underscore.",
      "Value has an unclosed quote.",
    ]);
  });

  it("accepts raw quoted multiline draft values, whitespace, references and empty values", () => {
    const values = ["", "  plain  ", "${{db.DATABASE_URL}}", ' "first\nlast" # comment', "'first\r\nlast'", "`first\nlast`"];
    expect(validateVariableEntries(values.map((value, index) => ({ index, key: `KEY_${index}`, value })))).toEqual([]);
  });
});
