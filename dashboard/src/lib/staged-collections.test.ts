import { describe, expect, it } from "vitest";
import { stagedCollection, stagedMountValues, stagedVariableValues } from "@/lib/staged-collections";
import type { Mount } from "@/lib/dokploy";
import { emptyStagedState, stagingReducer, type StagedOperation } from "@/lib/staged-changes";

describe("staged collections", () => {
  const original = [{ id: "existing", value: "old" }];
  const config = {
    key: (item: { id: string; value: string }) => item.id,
    create: "create", remove: "remove", update: "update",
    added: (op: { id: string; args: unknown[] }) => ({ id: op.id, value: String(op.args[0]) }),
    updated: (item: { id: string; value: string }, op: { args: unknown[] }) => ({ ...item, value: String(op.args[1]) }),
  };

  it("shows additions and updates across tab remounts without changing server data", () => {
    const operations = [
      { id: "new", action: "create", args: ["added"] },
      { id: "edit", action: "update", args: ["existing", "edited"] },
      { id: "unrelated", action: "other-setting", args: [] },
    ];
    expect(stagedCollection(original, operations, config)).toEqual([
      { id: "existing", value: "edited" }, { id: "new", value: "added" },
    ]);
    expect(original).toEqual([{ id: "existing", value: "old" }]);
    expect(stagedCollection(original, [], config)).toEqual(original);
  });

  it("hides staged removals and restores them when discarded", () => {
    const operations = [{ id: "remove", action: "remove", args: ["existing"] }];
    expect(stagedCollection(original, operations, config)).toEqual([]);
    expect(stagedCollection(original, [], config)).toEqual(original);
  });

  it("reverting a staged creation leaves the original list", () => {
    const operations = [
      { id: "new", action: "create", args: ["added"] },
      { id: "remove", action: "remove", args: ["new"] },
    ];
    expect(stagedCollection(original, operations, config)).toEqual(original);
  });

  it("editing a newly staged mount updates its creation instead of adding a second write", () => {
    const operation: StagedOperation = {
      id: "new-mount", action: "createMountAction", args: ["/data"],
      changes: [{ field: "Mount path", before: null, after: "/data" }],
    };
    let state = stagingReducer(emptyStagedState(), { type: "stage", operation });
    state = stagingReducer(state, { type: "stage", operation: {
      ...operation, args: ["/updated"], changes: [{ field: "Mount path", before: null, after: "/updated" }],
    } });
    expect(state.operations).toHaveLength(1);
    expect(stagedCollection([], state.operations, { ...config, create: "createMountAction" })).toEqual([
      { id: "new-mount", value: "/updated" },
    ]);
  });
});

describe("staged variable values", () => {
  it("provides individual secret fields for edits, additions and removals", () => {
    expect(stagedVariableValues("TOKEN=old\nREMOVED=yes", "TOKEN=new\nADDED=${{db.URL}}")).toEqual({
      before: { "Variable TOKEN": "old", "Variable REMOVED": "yes" },
      after: { "Variable TOKEN": "new", "Variable ADDED": "${{db.URL}}" },
      secretFields: ["Variable TOKEN", "Variable REMOVED", "Variable ADDED"],
    });
  });

  it("keeps comment-only edits staged and secret", () => {
    const diff = stagedVariableValues("TOKEN=value", "# a note\nTOKEN=value");
    expect(diff.before["Variables formatting"]).toBe("TOKEN=value");
    expect(diff.after["Variables formatting"]).toBe("# a note\nTOKEN=value");
    expect(diff.secretFields).toContain("Variables formatting");
  });

  it("does not add a formatting change for an unedited template", () => {
    const diff = stagedVariableValues("TOKEN=value", "TOKEN=value");
    expect(diff.before).toEqual(diff.after);
    expect(diff.secretFields).toEqual(["Variable TOKEN"]);
  });
});

describe("staged mount values", () => {
  const mount: Mount = { mountId: "mount", type: "file", mountPath: "/config", filePath: "config.env", content: null, hostPath: null, volumeName: null };

  it("does not stage an empty file simply by opening its editor", () => {
    const diff = stagedMountValues(mount, { type: "file", mountPath: "/config", filePath: "config.env", content: "" });
    expect(diff.before).toEqual(diff.after);
  });

  it("keeps the original path in labels while editing and marks content secret", () => {
    const diff = stagedMountValues(mount, { mountPath: "/updated", content: "TOKEN=secret" });
    expect(diff.before).toEqual({ "Mount /config: Mount path": "/config", "Mount /config: Content": "" });
    expect(diff.after).toEqual({ "Mount /config: Mount path": "/updated", "Mount /config: Content": "TOKEN=secret" });
    expect(diff.secretFields).toEqual(["Mount /config: Content"]);
  });

  it("omits inactive mount sources and gives new mounts an empty baseline", () => {
    const diff = stagedMountValues(undefined, { type: "volume", mountPath: "/data", volumeName: "app-data", hostPath: undefined, content: undefined });
    expect(diff.before).toEqual({ "Mount /data: Type": null, "Mount /data: Mount path": null, "Mount /data: Volume name": null });
    expect(Object.keys(diff.after)).toEqual(Object.keys(diff.before));
    expect(diff.secretFields).toEqual([]);
  });
});
