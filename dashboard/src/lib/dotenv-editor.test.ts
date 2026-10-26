import { describe, expect, it } from "vitest";
import { createEditorState, dotenvEditorReducer } from "./dotenv-editor";
import { setDotenvValue } from "./dotenv-raw";

describe("createEditorState", () => {
  it("starts valid variables in rows with stored text verbatim and no pending confirmation", () => {
    const text = "# stored comment\r\n\r\nexport KEY='first'\r\nKEY=last\r\nEMPTY=\r\n";
    expect(createEditorState(text)).toEqual({
      text,
      baseline: text,
      loadError: null,
      mode: "rows",
      review: null,
      exporting: null,
    });
  });

  it("preserves invalid stored text in raw mode so errors can be repaired", () => {
    const text = "# keep this\r\nBAD-KEY=value\r\nVALID=yes";
    expect(createEditorState(text)).toEqual({ text, baseline: text, loadError: null, mode: "raw", review: null, exporting: null });
    expect(createEditorState("").mode).toBe("rows");
  });
});

describe("dotenvEditorReducer", () => {
  it("starts unloaded without treating redacted page data as an empty saved environment", () => {
    expect(createEditorState(null)).toEqual({
      text: "", baseline: null, loadError: null, mode: "rows", review: null, exporting: null,
    });
  });

  it.each(["", "# loaded\r\nKEY='value'\r\n", "KEY=value\nINVALID LINE"])(
    "seeds the draft, baseline and initial mode from the loaded environment %j",
    (env) => {
      const state = dotenvEditorReducer(createEditorState(null), { type: "loaded", env });
      expect(state).toEqual(createEditorState(env));
      expect(state.text).toBe(state.baseline);
    },
  );

  it("blocks editing, mode switches, review and export until loading succeeds", () => {
    const initial = createEditorState(null);
    const failed = dotenvEditorReducer(initial, { type: "failed", error: "Could not load variables" });
    expect(failed.loadError).toBe("Could not load variables");
    expect(failed.baseline).toBeNull();
    for (const state of [initial, failed]) {
      expect(dotenvEditorReducer(state, { type: "edit", text: "KEY=draft" })).toBe(state);
      expect(dotenvEditorReducer(state, { type: "mode", mode: "raw" })).toBe(state);
      expect(dotenvEditorReducer(state, { type: "review" })).toBe(state);
      expect(dotenvEditorReducer(state, { type: "export", kind: "copy" })).toBe(state);
      expect(dotenvEditorReducer(state, { type: "export", kind: "download" })).toBe(state);
    }
    expect(dotenvEditorReducer(failed, { type: "loaded", env: "KEY=loaded" })).toEqual(createEditorState("KEY=loaded"));
  });

  it("uses loaded values for review and export and clears confirmations on a loading failure", () => {
    const env = "# loaded\nSECRET=loaded-value";
    let state = dotenvEditorReducer(createEditorState(null), { type: "loaded", env });
    state = dotenvEditorReducer(state, { type: "review" });
    expect(state.review).toBe(env);
    state = dotenvEditorReducer(state, { type: "export", kind: "download" });
    expect(state.exporting).toBe("download");
    expect(state.text).toBe(env);
    state = dotenvEditorReducer(state, { type: "failed", error: "Could not reload variables" });
    expect(state.review).toBeNull();
    expect(state.exporting).toBeNull();
    expect(dotenvEditorReducer(state, { type: "edit", text: "SECRET=changed" })).toBe(state);
    expect(dotenvEditorReducer(state, { type: "review" })).toBe(state);
    expect(dotenvEditorReducer(state, { type: "export", kind: "copy" })).toBe(state);
  });

  it("keeps edits local and clears stale review and export confirmations", () => {
    const initial = createEditorState("KEY=original");
    const reviewed = dotenvEditorReducer(initial, { type: "review" });
    const exporting = dotenvEditorReducer(reviewed, { type: "export", kind: "copy" });
    const edited = dotenvEditorReducer(exporting, { type: "edit", text: "# draft\nKEY=changed" });

    expect(edited).toEqual({ text: "# draft\nKEY=changed", baseline: "KEY=original", loadError: null, mode: "rows", review: null, exporting: null });
    expect(edited.text).not.toBe(edited.baseline);
    expect(initial.text).toBe("KEY=original");
    expect(reviewed.review).toBe("KEY=original");
  });

  it("preserves draft comments across modes and creates an exact review snapshot", () => {
    const text = "# draft comment\nexport KEY='hello world' # inline\nREFERENCE=${{Service.VAR}}";
    let state = dotenvEditorReducer(createEditorState("KEY=old"), { type: "edit", text });
    state = dotenvEditorReducer(state, { type: "mode", mode: "raw" });
    expect(state.text).toBe(text);
    state = dotenvEditorReducer(state, { type: "mode", mode: "rows" });
    expect(state.text).toBe(text);
    state = dotenvEditorReducer(state, { type: "export", kind: "download" });
    state = dotenvEditorReducer(state, { type: "review" });

    expect(state.text).toBe(text);
    expect(state.review).toBe(text);
    expect(state.exporting).toBeNull();
  });

  it("blocks row mode, review and both export requests while parsing has errors", () => {
    const state = createEditorState("GOOD=yes\nINVALID LINE");
    expect(dotenvEditorReducer(state, { type: "mode", mode: "rows" })).toBe(state);
    expect(dotenvEditorReducer(state, { type: "review" })).toBe(state);
    expect(dotenvEditorReducer(state, { type: "export", kind: "copy" })).toBe(state);
    expect(dotenvEditorReducer(state, { type: "export", kind: "download" })).toBe(state);
  });

  it("allows review and export after errors are repaired, including deleting every variable", () => {
    const repaired = dotenvEditorReducer(createEditorState("BAD KEY=value"), { type: "edit", text: "" });
    const reviewed = dotenvEditorReducer(repaired, { type: "review" });
    expect(reviewed.review).toBe("");
    expect(dotenvEditorReducer(repaired, { type: "mode", mode: "rows" }).mode).toBe("rows");
    expect(dotenvEditorReducer(repaired, { type: "export", kind: "copy" }).exporting).toBe("copy");
    expect(dotenvEditorReducer(repaired, { type: "export", kind: "download" }).exporting).toBe("download");
  });

  it("keeps duplicate assignments intact in the review snapshot", () => {
    const state = dotenvEditorReducer(createEditorState("KEY=old"), { type: "edit", text: "KEY=first\nKEY=last" });
    expect(dotenvEditorReducer(state, { type: "review" }).review).toBe("KEY=first\nKEY=last");
  });

  it("cancels review and export without discarding the draft", () => {
    const text = "# draft\nKEY=value";
    let state = dotenvEditorReducer(createEditorState(""), { type: "edit", text });
    state = dotenvEditorReducer(state, { type: "review" });
    state = dotenvEditorReducer(state, { type: "cancelReview" });
    expect(state.review).toBeNull();
    expect(state.text).toBe(text);
    state = dotenvEditorReducer(state, { type: "export", kind: "copy" });
    state = dotenvEditorReducer(state, { type: "cancelExport" });
    expect(state.exporting).toBeNull();
    expect(state.text).toBe(text);
  });

  it("keeps the exact submitted text after save succeeds", () => {
    let state = dotenvEditorReducer(createEditorState("KEY=old"), { type: "edit", text: "# temporary\nKEY='new value'" });
    state = dotenvEditorReducer(state, { type: "mode", mode: "raw" });
    state = dotenvEditorReducer(state, { type: "review" });
    const submitted = state.review!;
    state = dotenvEditorReducer(state, { type: "export", kind: "download" });
    const saved = dotenvEditorReducer(state, { type: "saved", text: submitted });

    expect(saved).toEqual({ text: submitted, baseline: submitted, loadError: null, mode: "raw", review: null, exporting: null });
    expect(state.text).toBe("# temporary\nKEY='new value'");
  });

  it("updates the saved baseline while preserving newer edits and their dirty state", () => {
    let state = dotenvEditorReducer(createEditorState(null), { type: "loaded", env: "KEY=old" });
    state = dotenvEditorReducer(state, { type: "edit", text: "KEY=submitted" });
    state = dotenvEditorReducer(state, { type: "review" });
    const submitted = state.review!;
    state = dotenvEditorReducer(state, { type: "edit", text: "KEY=newer" });
    state = dotenvEditorReducer(state, { type: "saved", text: submitted });
    expect(state.baseline).toBe(submitted);
    expect(state.text).toBe("KEY=newer");
    expect(state.text).not.toBe(state.baseline);
    expect(state.review).toBeNull();
    expect(state.exporting).toBeNull();
  });

  it("leaves an untouched load, mode switch, review and save round trip byte-identical", () => {
    const text = "# header\r\n\r\n  export SECOND = 'two' # note\r\nFIRST=one\r\n\r\n# footer\r\n";
    let state = createEditorState(text);
    state = dotenvEditorReducer(state, { type: "mode", mode: "raw" });
    state = dotenvEditorReducer(state, { type: "mode", mode: "rows" });
    state = dotenvEditorReducer(state, { type: "review" });
    expect(state.review).toBe(text);
    state = dotenvEditorReducer(state, { type: "saved", text: state.review! });
    expect(state.text).toBe(text);
  });

  it("preserves a comment-only edit in the submitted snapshot", () => {
    let state = createEditorState("KEY='same'\r\n");
    const text = "# new comment\r\nKEY='same'\r\n";
    state = dotenvEditorReducer(state, { type: "edit", text });
    state = dotenvEditorReducer(state, { type: "review" });
    expect(state.review).toBe(text);
  });

  it("saves a row edit without rewriting the surrounding document", () => {
    const before = "# header\r\n\r\nKEEP='literal' # keep quoting\r\nKEY=first\r\n  export KEY = 'old value' # effective\r\n\r\n# footer\r\n";
    const expected = before.replace("'old value'", '"new value"');
    let state = createEditorState(before);
    state = dotenvEditorReducer(state, { type: "edit", text: setDotenvValue(state.text, "KEY", "new value") });
    state = dotenvEditorReducer(state, { type: "review" });
    expect(state.review).toBe(expected);
    state = dotenvEditorReducer(state, { type: "saved", text: state.review! });
    expect(state.text).toBe(expected);
  });
});
