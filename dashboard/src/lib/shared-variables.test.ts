import { describe, expect, it } from "vitest";
import { parseVariables, removeVariable, setVariable, sharedReference, sharedReferences, variableValues } from "./shared-variables";

describe("parseVariables", () => {
  it("parses dotenv quoting, comments, exports, colon separators, and permissive keys", () => {
    const source = "# header\nexport HELLO = world # inline\nEMPTY=\nLOWER.case-key: value\n1KEY=yes\nSINGLE='a # b'\nDOUBLE=\"a # b\"\nTICK=`a # b`\n";
    expect({ ...variableValues(source) }).toEqual({ HELLO: "world", EMPTY: "", "LOWER.case-key": "value", "1KEY": "yes", SINGLE: "a # b", DOUBLE: "a # b", TICK: "a # b" });
  });

  it("supports multiline quoted values and only expands double-quoted newline escapes", () => {
    const source = "SINGLE='first\nsecond\\n'\nDOUBLE=\"first\\nsecond\\r\"\nTICK=`first\nsecond`\nUNQUOTED=literal\\n\nESCAPED=\"a\\\"b\"\n";
    expect({ ...variableValues(source) }).toEqual({ SINGLE: "first\nsecond\\n", DOUBLE: "first\nsecond\r", TICK: "first\nsecond", UNQUOTED: "literal\\n", ESCAPED: 'a\\"b' });
  });

  it("normalizes CRLF and CR values but maps offsets to the original source", () => {
    const source = "# heading\r\n\r\n  A='one\r\ntwo' # keep\r\nB=last\r";
    const entries = parseVariables(source);
    expect(entries.map(({ key, value }) => ({ key, value }))).toEqual([{ key: "A", value: "one\ntwo" }, { key: "B", value: "last" }]);
    expect(source.slice(entries[0].start, entries[0].end)).toBe("  A='one\r\ntwo' # keep\r\n");
    expect(source.slice(entries[0].valueStart, entries[0].valueEnd)).toBe("'one\r\ntwo'");
  });

  it("retains duplicate entries while exposing the last value", () => {
    expect(parseVariables("A=first\nA=second\n")).toHaveLength(2);
    expect(variableValues("A=first\nA=second\n").A).toBe("second");
  });

  it("matches a fixture verified against Dokploy's installed dotenv 16.4.5", () => {
    const source = "A='one\n two' # keep\nexport lower.key-x : value\nEMPTY= # comment\nDOUBLE=\"one\\n two\\r\"\nA=last\nLITERAL='\\n'\n";
    expect({ ...variableValues(source) }).toEqual({ A: "last", EMPTY: "", DOUBLE: "one\n two\r", LITERAL: "\\n" });
  });

  it("does not inherit prototype properties and handles explicitly declared names", () => {
    const values = variableValues("__proto__=literal\nconstructor=custom\ntoString=text\n");
    expect(Object.getPrototypeOf(values)).toBeNull();
    expect(values.__proto__).toBe("literal");
    expect(values.constructor).toBe("custom");
    expect(values.toString).toBe("text");
    expect(variableValues("").constructor).toBeUndefined();
  });
});

describe("setVariable", () => {
  it("edits the last duplicate while preserving unrelated bytes and inline comments", () => {
    const source = "# header\r\nA=first\r\n\r\n export A = 'old'  # explanation\r\nB=unchanged\r\n";
    expect(setVariable(source, "A", "new")).toBe("# header\r\nA=first\r\n\r\n export A = new  # explanation\r\nB=unchanged\r\n");
  });

  it("returns the original document unchanged when the value has not changed", () => {
    const source = " A = \"same\" # keep quotes\n";
    expect(setVariable(source, "A", "same")).toBe(source);
  });

  it("replaces a multiline value without losing its inline comment or following declarations", () => {
    expect(setVariable("A='one\ntwo' # keep\nB=ok\n", "A", "new\nvalue")).toBe("A='new\nvalue' # keep\nB=ok\n");
  });

  it("inserts empty values and retains comments when editing an empty declaration", () => {
    expect(setVariable("A=   # explanation\n", "A", "new")).toBe("A=new   # explanation\n");
    expect(setVariable("", "A", "")).toBe("A=\n");
  });

  it("appends using the existing line endings, including a missing final newline", () => {
    expect(setVariable("# heading\r\nA=first", "B", "second")).toBe("# heading\r\nA=first\r\nB=second\r\n");
    expect(setVariable("# heading\n", "B", "second")).toBe("# heading\nB=second\n");
  });

  it.each(["normal", "", " with spaces ", "a#b", "a'b", 'a"b', "a`b", "line\nnext", "line\rnext", "literal\\n", "'quoted'", '"quoted"', "`quoted`", "json={\"a\":\"b\"}"])("round-trips %j", (value) => {
    expect(variableValues(setVariable("", "A", value)).A).toBe(value);
  });

  it("rejects invalid keys and values dotenv cannot represent without changing", () => {
    expect(() => setVariable("", "BAD=KEY", "value")).toThrow("Variable names");
    expect(() => setVariable("", "", "value")).toThrow("Variable names");
    expect(() => setVariable("", "A", "all '\"`\nquotes # here")).toThrow("losslessly");
  });
});

describe("removeVariable", () => {
  it("removes all duplicates without removing surrounding comments or blank lines", () => {
    expect(removeVariable("# keep\n\nA=first\n# still keep\nA='last\nline'\nB=ok\n", "A")).toBe("# keep\n\n# still keep\nB=ok\n");
  });

  it("handles CRLF and an unterminated final line", () => {
    expect(removeVariable("# keep\r\nA=one\r\nB=two\r\nA=last", "A")).toBe("# keep\r\nB=two\r\n");
    expect(removeVariable("B=two", "A")).toBe("B=two");
  });
});

describe("shared references", () => {
  it("formats exact Dokploy references for both scopes", () => {
    expect(sharedReference("project", "X")).toBe("${{project.X}}");
    expect(sharedReference("environment", "lower.case-key")).toBe("${{environment.lower.case-key}}");
    expect(() => sharedReference("project", "X}}")).toThrow("Variable names");
  });

  it("inserts a reference as a service variable while preserving comments and multiline neighbors", () => {
    const source = "# service\r\nMULTILINE='first\r\nsecond' # retain\r\nURL='old' # target\r\n";
    const updated = setVariable(source, "URL", sharedReference("project", "HOST"));
    expect(updated).toBe("# service\r\nMULTILINE='first\r\nsecond' # retain\r\nURL=${{project.HOST}} # target\r\n");
    expect(variableValues(updated).URL).toBe("${{project.HOST}}");
    expect(variableValues(setVariable(updated, "PATH", sharedReference("environment", "PATH"))).PATH).toBe("${{environment.PATH}}");
  });

  it("replaces an existing multiline service value with a reference without losing its comment", () => {
    const source = "# service\nVALUE='first\nsecond' # retained\n";
    expect(setVariable(source, "VALUE", sharedReference("environment", "VALUE"))).toBe("# service\nVALUE=${{environment.VALUE}} # retained\n");
  });

  it("reports each direct reference in effective service values without disclosing values", () => {
    const source = "URL=${{project.HOST}}/${{environment.PATH}}/${{project.MISSING}}\nOLD=${{project.MISSING}}\nOLD=literal\n";
    expect(sharedReferences(source, { project: "HOST=private-host\n", environment: "PATH=\n" })).toEqual([
      { variable: "URL", scope: "project", key: "HOST", reference: "${{project.HOST}}", defined: true },
      { variable: "URL", scope: "environment", key: "PATH", reference: "${{environment.PATH}}", defined: true },
      { variable: "URL", scope: "project", key: "MISSING", reference: "${{project.MISSING}}", defined: false },
    ]);
  });

  it("uses exact keys, ignores comments/self references, and does not inherit properties", () => {
    const source = "# A=${{project.X}}\nA=${{project.X }}-${{project.constructor}}-${{environment.__proto__}}-${{SELF}}\nB=${{environment.X}}\n";
    expect(sharedReferences(source, { project: "X=yes", environment: "__proto__=yes\nX=first\nX=" }).map(({ key, defined }) => ({ key, defined }))).toEqual([
      { key: "X ", defined: false },
      { key: "constructor", defined: false },
      { key: "__proto__", defined: true },
      { key: "X", defined: true },
    ]);
  });
});
