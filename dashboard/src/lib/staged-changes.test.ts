import { describe, expect, it } from "vitest";
import { displayStagedValue, emptyStagedState, stagedChangeCount, stagingReducer, type StagedOperation } from "./staged-changes";

const edit = (after: unknown, before: unknown = "old"): StagedOperation => ({
  id: "command", action: "updateApplicationAction", args: ["app", { command: after }],
  changes: [{ field: "Start command", before, after }],
});

describe("service staging", () => {
  it("adds and edits a change, keeping the original baseline and counting fields", () => {
    let state = stagingReducer(emptyStagedState(), { type: "stage", operation: edit("new") });
    state = stagingReducer(state, { type: "stage", operation: edit("newer", "server poll") });
    expect(state.operations[0].changes).toEqual([{ field: "Start command", before: "old", after: "newer" }]);
    expect(stagedChangeCount(state.operations)).toBe(1);
    const other = { ...edit("x"), id: "build", changes: [
      { field: "Build", before: "a", after: "b" }, { field: "Context", before: "/", after: "/src" },
    ] };
    state = stagingReducer(state, { type: "stage", operation: other });
    expect(stagedChangeCount(state.operations)).toBe(3);
  });

  it("removes edits reverted to their original value", () => {
    const state = stagingReducer(emptyStagedState(), { type: "stage", operation: edit("new") });
    const reverted = stagingReducer(state, { type: "stage", operation: edit("old", "different") });
    expect(reverted.operations).toEqual([]);
    expect(stagedChangeCount(reverted.operations)).toBe(0);
  });

  it("does not stage unchanged fields and keeps an identical update stable", () => {
    const empty = emptyStagedState();
    expect(stagingReducer(empty, { type: "stage", operation: edit("old") })).toBe(empty);
    const state = stagingReducer(empty, { type: "stage", operation: edit("new") });
    expect(stagingReducer(state, { type: "stage", operation: edit("new") })).toBe(state);
  });

  it("retains drafts across form remounts, clears them on discard", () => {
    let state = stagingReducer(emptyStagedState(), { type: "draft", key: "variables", value: "TOKEN=test" });
    state = stagingReducer(state, { type: "stage", operation: edit("new") });
    expect(state.drafts.variables).toBe("TOKEN=test");
    expect(stagingReducer(state, { type: "discard" })).toEqual(emptyStagedState());
  });

  it("does not replay an acknowledged operation when its form remounts", () => {
    let state = stagingReducer(emptyStagedState(), { type: "stage", operation: edit("new") });
    state = stagingReducer(state, { type: "applied", ids: ["command"] });
    expect(stagingReducer(state, { type: "stage", operation: edit("new") })).toBe(state);
    state = stagingReducer(state, { type: "stage", operation: edit("another", "new") });
    expect(state.operations).toHaveLength(1);
    expect(stagingReducer(state, { type: "stage", operation: edit("new") }).operations).toHaveLength(0);
  });

  it("restores a domain edit after staging and undoing its removal", () => {
    const domainEdit: StagedOperation = {
      id: "domain:one", action: "updateDomainAction", args: ["one", { host: "app.localhost", port: 8080 }],
      changes: [
        { field: "Domain host", before: "app.localhost", after: "app.localhost" },
        { field: "Container port", before: 80, after: 8080 },
      ],
    };
    const removal: StagedOperation = {
      id: "domain:one", action: "deleteDomainAction", args: ["one"],
      changes: [{ field: "Domain", before: "app.localhost", after: "(removed)" }],
    };
    let state = stagingReducer(emptyStagedState(), { type: "stage", operation: domainEdit });
    state = stagingReducer(state, { type: "stage", operation: removal });
    expect(state.operations).toEqual([removal]);
    expect(stagedChangeCount(state.operations)).toBe(1);

    state = stagingReducer(state, { type: "stage", operation: domainEdit });
    expect(state.operations).toEqual([{ ...domainEdit, changes: [domainEdit.changes[1]] }]);
    expect(stagedChangeCount(state.operations)).toBe(1);

    state = stagingReducer(state, { type: "stage", operation: {
      ...domainEdit, args: ["one", { host: "app.localhost", port: 80 }],
      changes: domainEdit.changes.map((change) => ({ ...change, after: change.before })),
    } });
    expect(state.operations).toEqual([]);
  });

  it("undoes an untouched domain removal without creating an update", () => {
    const removal: StagedOperation = {
      id: "domain:one", action: "deleteDomainAction", args: ["one"],
      changes: [{ field: "Domain", before: "app.localhost", after: "(removed)" }],
    };
    const state = stagingReducer(emptyStagedState(), { type: "stage", operation: removal });
    const restored = stagingReducer(state, { type: "stage", operation: {
      id: "domain:one", action: "updateDomainAction", args: ["one", { port: 80 }],
      changes: [{ field: "Container port", before: 80, after: 80 }],
    } });
    expect(restored.operations).toEqual([]);
  });

  it("removes one reverted field while retaining other edits in its operation", () => {
    const operation: StagedOperation = {
      ...edit("new"),
      changes: [
        { field: "Image", before: "app:v1", after: "app:v2" },
        { field: "Registry password", before: "", after: "draft-password", secret: true },
      ],
    };
    const state = stagingReducer(emptyStagedState(), { type: "stage", operation });
    const reverted = stagingReducer(state, { type: "stage", operation: {
      ...operation,
      changes: [operation.changes[0], { ...operation.changes[1], after: "" }],
    } });
    expect(reverted.operations[0].changes).toEqual([operation.changes[0]]);
    expect(stagedChangeCount(reverted.operations)).toBe(1);
  });
});

describe("staged diff masking", () => {
  it("masks strings and nested secrets without exposing their contents or length", () => {
    expect(displayStagedValue("tiny", true)).toBe("••••••••");
    expect(displayStagedValue({ password: "long password" }, true)).toBe("••••••••");
    expect(displayStagedValue("", true)).toBe("—");
    expect(displayStagedValue(null, true)).toBe("—");
  });
  it("formats public values", () => {
    expect(displayStagedValue("/health")).toBe("/health");
    expect(displayStagedValue(8080)).toBe("8080");
    expect(displayStagedValue(false)).toBe("false");
  });
});
