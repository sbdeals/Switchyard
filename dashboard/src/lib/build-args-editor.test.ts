import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { BuildArgumentsForm } from "../components/service/BuildArgumentsForm";
import { buildArgsEditorReducer, initialBuildArgsEditorState } from "./build-args-editor";
import { reviewBuildArgs } from "./build-args";

vi.mock("@/app/actions", () => ({
  loadApplicationBuildArgsAction: vi.fn(),
  saveApplicationBuildArgsAction: vi.fn(),
}));

describe("build arguments editor", () => {
  it("cannot edit before arguments have loaded", () => {
    expect(initialBuildArgsEditorState.baseline).toBeNull();
    expect(buildArgsEditorReducer(initialBuildArgsEditorState, {
      type: "edited", value: "GREETING=not-loaded",
    })).toBe(initialBuildArgsEditorState);
  });

  it.each(["GREETING=loaded", ""])("uses loaded arguments (%j) as the clean baseline", (buildArgs) => {
    const state = buildArgsEditorReducer(initialBuildArgsEditorState, { type: "loaded", buildArgs });
    expect(state).toEqual({ value: buildArgs, baseline: buildArgs, loadError: null });
    expect(reviewBuildArgs(state.baseline!, state.value)).toEqual([]);
  });

  it("recovers a failed load through retry without accepting edits before the response", () => {
    const failed = buildArgsEditorReducer(initialBuildArgsEditorState, {
      type: "failed", error: "Could not load build arguments.",
    });
    expect(failed.baseline).toBeNull();
    expect(buildArgsEditorReducer(failed, { type: "edited", value: "GREETING=unsafe" })).toBe(failed);

    const retrying = buildArgsEditorReducer(failed, { type: "loading" });
    expect(retrying).toEqual(initialBuildArgsEditorState);
    expect(buildArgsEditorReducer(retrying, { type: "loaded", buildArgs: "GREETING=retried" }))
      .toEqual({ value: "GREETING=retried", baseline: "GREETING=retried", loadError: null });
  });

  it("reviews against loaded arguments and keeps the saved baseline for subsequent edits", () => {
    const loaded = buildArgsEditorReducer(initialBuildArgsEditorState, {
      type: "loaded", buildArgs: "GREETING=old\nREMOVED=old",
    });
    const edited = buildArgsEditorReducer(loaded, { type: "edited", value: "GREETING=new" });
    expect(reviewBuildArgs(edited.baseline!, edited.value)).toEqual([
      { key: "GREETING", change: "changed" }, { key: "REMOVED", change: "removed" },
    ]);

    const saved = buildArgsEditorReducer(edited, { type: "saved", submittedValue: edited.value });
    expect(saved.baseline).toBe(saved.value);
    const nextEdit = buildArgsEditorReducer(saved, { type: "edited", value: "GREETING=newer" });
    expect(nextEdit.baseline).toBe("GREETING=new");
    expect(reviewBuildArgs(nextEdit.baseline!, nextEdit.value)).toEqual([{ key: "GREETING", change: "changed" }]);
  });

  it("keeps newer edits dirty when an earlier submitted value finishes saving", () => {
    const loaded = buildArgsEditorReducer(initialBuildArgsEditorState, { type: "loaded", buildArgs: "GREETING=old" });
    const edited = buildArgsEditorReducer(loaded, { type: "edited", value: "GREETING=newer" });
    const saved = buildArgsEditorReducer(edited, { type: "saved", submittedValue: "GREETING=submitted" });

    expect(saved.value).toBe("GREETING=newer");
    expect(saved.baseline).toBe("GREETING=submitted");
  });

  it("renders no values or editor until the ownership-checked load completes", () => {
    const app = {
      id: "app-id",
      buildSecretsSupported: true,
      buildArgs: "TOKEN=build-args-prop-sentinel",
      buildSecrets: "TOKEN=build-secrets-prop-sentinel",
      env: "TOKEN=runtime-prop-sentinel",
    };
    const html = renderToStaticMarkup(createElement(BuildArgumentsForm, { app }));

    expect(html).toContain('aria-label="Loading build arguments"');
    expect(html).not.toContain("sentinel");
    expect(html).not.toContain("<textarea");
    expect(html).not.toContain("<button");
  });
});
