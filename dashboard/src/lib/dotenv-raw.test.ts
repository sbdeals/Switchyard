import { describe, expect, it } from "vitest";
import { appendDotenvKey, diffDotenvRaw, parseDotenvRaw, removeDotenvKey, serializeDotenvRaw, setDotenvValue } from "./dotenv-raw";

describe("parseDotenvRaw", () => {
  it("parses exports, empty values, embedded equals and CRLF without expanding references", () => {
    const parsed = parseDotenvRaw([
      "# local comment",
      " export TOKEN=abc=def== ",
      "EMPTY=",
      'QUOTED_EMPTY=""',
      "REFERENCE=${{Service.VAR}}",
      'QUOTED_REFERENCE="${{Service.VAR}}"',
      "exported=value",
      "",
    ].join("\r\n"));

    expect(parsed).toEqual({
      variables: {
        TOKEN: "abc=def==",
        EMPTY: "",
        QUOTED_EMPTY: "",
        REFERENCE: "${{Service.VAR}}",
        QUOTED_REFERENCE: "${{Service.VAR}}",
        exported: "value",
      },
      errors: [],
      warnings: [],
    });
  });

  it("supports quoted whitespace, comment markers, escaped quotes and newlines", () => {
    const parsed = parseDotenvRaw([
      'DOUBLE=" hello # world " # comment',
      "SINGLE='literal \\n and # hash'",
      'ESCAPED="first\\nsecond\\r\\t\\"quote\\"\\\\tail"',
      'UNKNOWN="keep\\q"',
      "UNQUOTED=path\\name # comment",
      "INLINE=value#comment",
    ].join("\n"));

    expect(parsed.variables).toEqual({
      DOUBLE: " hello # world ",
      SINGLE: "literal \\n and # hash",
      ESCAPED: 'first\nsecond\r\t"quote"\\tail',
      UNKNOWN: "keep\\q",
      UNQUOTED: "path\\name",
      INLINE: "value",
    });
    expect(parsed.errors).toEqual([]);
  });

  it("accepts multiline quotes and reports following errors using physical line numbers", () => {
    const parsed = parseDotenvRaw('MULTI="first\r\nsecond"\r\nSINGLE=\'third\r\nfourth\'\r\nBAD-KEY=value');
    expect(parsed.variables).toEqual({ MULTI: "first\nsecond", SINGLE: "third\nfourth" });
    expect(parsed.errors).toEqual([{ line: 5, message: expect.stringContaining("Invalid key") }]);
  });

  it("keeps the last duplicate value and warns on every repeated assignment", () => {
    const parsed = parseDotenvRaw("KEY=first\nKEY=second\nKEY=\nOTHER=ok");
    expect(parsed.variables).toEqual({ KEY: "", OTHER: "ok" });
    expect(parsed.warnings).toEqual([
      { line: 2, message: "Duplicate key KEY; the last value wins." },
      { line: 3, message: "Duplicate key KEY; the last value wins." },
    ]);
    expect(parsed.errors).toEqual([]);
  });

  it("flags invalid names and missing equals without including values in errors", () => {
    const parsed = parseDotenvRaw("1BAD=secret\nBAD-KEY=secret\nBAD KEY=secret\n=secret\nMISSING\n_GOOD_2=ok");
    expect(parsed.variables).toEqual({ _GOOD_2: "ok" });
    expect(parsed.errors.map((error) => error.line)).toEqual([1, 2, 3, 4, 5]);
    expect(JSON.stringify(parsed.errors)).not.toContain("secret");
  });

  it("rejects unclosed quotes and trailing text instead of silently changing values", () => {
    expect(parseDotenvRaw('KEY="value"extra').errors).toEqual([
      { line: 1, message: "Unexpected text after quoted value." },
    ]);
    const parsed = parseDotenvRaw("OK=yes\nKEY='unclosed\nvalue");
    expect(parsed.variables).toEqual({ OK: "yes" });
    expect(parsed.errors).toEqual([{ line: 2, message: "Unclosed quoted value." }]);
  });

  it("treats object prototype names as ordinary variable keys", () => {
    const parsed = parseDotenvRaw("__proto__=safe\nconstructor=value\ntoString=literal");
    expect(Object.keys(parsed.variables)).toEqual(["__proto__", "constructor", "toString"]);
    expect(parsed.variables.__proto__).toBe("safe");
    expect(parsed.warnings).toEqual([]);
  });
});

describe("serializeDotenvRaw", () => {
  it("quotes only values that need protection in canonical output", () => {
    const parsed = parseDotenvRaw("# comment\nPLAIN=value\nEMPTY=\nEQUAL=a=b\nSPACED=' hello world '\nHASH='a#b'\nREF=${{Service.VAR}}");
    expect(serializeDotenvRaw(parsed.variables)).toBe([
      "PLAIN=value",
      "EMPTY=",
      "EQUAL=a=b",
      'SPACED=" hello world "',
      'HASH="a#b"',
      "REF=${{Service.VAR}}",
    ].join("\n"));
    expect(serializeDotenvRaw({})).toBe("");
  });

  it("round trips special values and produces stable canonical text", () => {
    const variables = {
      EMPTY: "",
      NEWLINE: "one\ntwo\r\nthree",
      TAB: "a\tb",
      SPACE: "  padded  ",
      QUOTES: 'single\' double"',
      BACKSLASH: "C:\\new\\thing\\",
      LITERAL_NEWLINE: "literal\\nvalue",
      HASH: "#comment",
      REFERENCE: "${{Service.VAR}}",
      PROTECTED_REFERENCE: '"${{Service.VAR}}"',
      UNICODE: "héllo 🌍",
    };
    const serialized = serializeDotenvRaw(variables);
    const parsed = parseDotenvRaw(serialized);
    expect(parsed).toEqual({ variables, errors: [], warnings: [] });
    expect(serializeDotenvRaw(parsed.variables)).toBe(serialized);
    expect(serialized.split("\n")).toHaveLength(Object.keys(variables).length);
  });

  it("stabilizes parsed input with exports, duplicate keys, comments and multiline values", () => {
    const input = "export KEY='first'\r\nKEY=last # duplicate\r\nMULTI=\"a\r\nb\"\r\nREF=${{Service.VAR}}";
    const serialized = serializeDotenvRaw(parseDotenvRaw(input).variables);
    expect(serializeDotenvRaw(parseDotenvRaw(serialized).variables)).toBe(serialized);
  });
});

describe("line-preserving row edits", () => {
  it.each(["\n", "\r\n"])("preserves comments, blank lines, other assignments and %j endings for each operation", (newline) => {
    const before = [
      "# service settings",
      "",
      "UNTOUCHED = 'keep this quoting'  # keep spacing  ",
      '  export TARGET = "old value"  # target note  ',
      "",
      "REF=${{Service.VAR}}",
      "# end",
      "",
    ].join(newline);

    expect(setDotenvValue(before, "TARGET", "new # value")).toBe(before.replace('"old value"', '"new # value"'));
    expect(removeDotenvKey(before, "TARGET")).toBe(before.replace('  export TARGET = "old value"  # target note  ', "  # target note  "));
    expect(appendDotenvKey(before, "ADDED", "two words")).toBe(`${before}ADDED="two words"${newline}`);
  });

  it("preserves mixed line endings byte for byte and appends using the first newline", () => {
    const before = "# start\r\n\nA='old' # note\n\r\nB = kept\r\n# final";
    expect(setDotenvValue(before, "A", "new")).toBe("# start\r\n\nA=new # note\n\r\nB = kept\r\n# final");
    expect(removeDotenvKey(before, "A")).toBe("# start\r\n\n# note\n\r\nB = kept\r\n# final");
    expect(appendDotenvKey(before, "C", "")).toBe(`${before}\r\nC=`);
  });

  it("updates only the effective duplicate and keeps the duplicate warning", () => {
    const before = "# duplicate settings\nKEY='first' # old\n\nKEY = second # active\nOTHER='untouched'\n";
    const edited = setDotenvValue(before, "KEY", "last");
    expect(edited).toBe(before.replace("KEY = second", "KEY = last"));
    expect(parseDotenvRaw(edited).variables.KEY).toBe("last");
    expect(parseDotenvRaw(edited).warnings).toEqual([{ line: 4, message: "Duplicate key KEY; the last value wins." }]);
    expect(setDotenvValue(before, "KEY", "second")).toBe(before);
  });

  it("removes all duplicates while retaining inline comments and unrelated blank lines", () => {
    const before = "# before\r\nKEY=first\r\n\r\nOTHER=keep\r\n  KEY=last # useful comment\r\n\r\n# after";
    const removed = removeDotenvKey(before, "KEY");
    expect(removed).toBe("# before\r\n\r\nOTHER=keep\r\n  # useful comment\r\n\r\n# after");
    expect(parseDotenvRaw(removed).variables).toEqual({ OTHER: "keep" });
    expect(removeDotenvKey("ONLY=value", "ONLY")).toBe("");
    expect(removeDotenvKey("ONLY=value # keep", "ONLY")).toBe("# keep");
  });

  it("does not mistake multiline quoted content for assignments or comments", () => {
    const before = 'MULTI="first\r\nKEY=inside\r\n# part of value\r\nlast" # multiline note\r\n\r\nKEY=outside\r\nTAIL=kept';
    expect(setDotenvValue(before, "KEY", "edited")).toBe(before.replace("KEY=outside", "KEY=edited"));
    expect(removeDotenvKey(before, "KEY")).toBe(before.replace("KEY=outside\r\n", ""));
    expect(setDotenvValue(before, "MULTI", "new\nvalue")).toBe('MULTI="new\\nvalue" # multiline note\r\n\r\nKEY=outside\r\nTAIL=kept');
    expect(removeDotenvKey(before, "MULTI")).toBe("# multiline note\r\n\r\nKEY=outside\r\nTAIL=kept");
  });

  it("quotes only the edited or appended value, retaining whitespace and inline comments", () => {
    const before = "EMPTY=   # empty note\nQUOTED = 'value'\nPLAIN=first  # note";
    const edited = setDotenvValue(before, "EMPTY", '${{Service.VAR}}\n"quoted"\\end');
    expect(edited).toBe('EMPTY=   "${{Service.VAR}}\\n\\"quoted\\"\\\\end"# empty note\nQUOTED = \'value\'\nPLAIN=first  # note');
    expect(parseDotenvRaw(edited).variables.EMPTY).toBe('${{Service.VAR}}\n"quoted"\\end');
    expect(setDotenvValue(before, "PLAIN", "")).toBe("EMPTY=   # empty note\nQUOTED = 'value'\nPLAIN=  # note");
    expect(appendDotenvKey("", "REF", "${{Service.VAR}}")).toBe("REF=${{Service.VAR}}");
    expect(appendDotenvKey("A=1", "EMPTY", "")).toBe("A=1\nEMPTY=");
  });

  it("makes an untouched parsed-value round trip a byte-identical no-op", () => {
    const before = "# original\r\n\r\n export A = 'keep quoting'  # note\r\nB=older\r\nB=last\r\nMULTI=\"a\r\nb\"\r\nESCAPED=\"a\\nb\"\r\nEMPTY=  \r\nREF=${{Service.VAR}}\r\n";
    let after = before;
    for (const [key, value] of Object.entries(parseDotenvRaw(before).variables)) {
      after = setDotenvValue(after, key, value);
    }
    expect(after).toBe(before);
    expect(setDotenvValue(before, "MISSING", "new")).toBe(before);
    expect(removeDotenvKey(before, "MISSING")).toBe(before);
    expect(appendDotenvKey(before, "B", "new")).toBe(before);
    expect(appendDotenvKey(before, "BAD-KEY", "new")).toBe(before);
  });

  it.each(["GOOD=value\nBAD-KEY=invalid", 'GOOD="unclosed', 'GOOD="value"invalid'])("leaves invalid input unchanged: %s", (before) => {
    expect(setDotenvValue(before, "GOOD", "new")).toBe(before);
    expect(removeDotenvKey(before, "GOOD")).toBe(before);
    expect(appendDotenvKey(before, "NEW", "new")).toBe(before);
  });
});

describe("diffDotenvRaw", () => {
  it("finds added, changed and removed keys without exposing values", () => {
    expect(diffDotenvRaw(
      { SAME: "kept", CHANGE: "old-secret", REMOVE: "removed-secret" },
      { SAME: "kept", CHANGE: "new-secret", ADD: "added-secret" },
    )).toEqual({ added: ["ADD"], changed: ["CHANGE"], removed: ["REMOVE"] });
  });

  it("handles empty values, deleting all keys and prototype names", () => {
    expect(diffDotenvRaw({ EMPTY: "" }, { EMPTY: "value" })).toEqual({ added: [], changed: ["EMPTY"], removed: [] });
    expect(diffDotenvRaw({ EMPTY: "" }, {})).toEqual({ added: [], changed: [], removed: ["EMPTY"] });
    expect(diffDotenvRaw({}, parseDotenvRaw("constructor=value\n__proto__=literal").variables)).toEqual({
      added: ["constructor", "__proto__"], changed: [], removed: [],
    });
    expect(diffDotenvRaw({ SAME: "" }, { SAME: "" })).toEqual({ added: [], changed: [], removed: [] });
  });
});
