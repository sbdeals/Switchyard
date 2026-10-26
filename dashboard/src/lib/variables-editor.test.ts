import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VariablesTab } from "../components/service/VariablesTab";
import * as primitives from "../components/service/primitives";
import type { ComposeService } from "./dokploy";
import { initialVariablesEditorState, variablesEditorReducer } from "./variables-editor";

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, useReducer: vi.fn(actual.useReducer) };
});

vi.mock("@/app/actions", () => ({
  loadServiceEnvAction: vi.fn(),
  saveEnvironmentAction: vi.fn(),
  saveApplicationEnvAction: vi.fn(),
  saveComposeEnvAction: vi.fn(),
}));

const service: ComposeService = {
  kind: "compose",
  id: "compose-id",
  name: "test-compose",
  appName: "test-compose-app",
  status: "idle",
  projectId: "project-id",
  projectName: "Test project",
  environmentId: "environment-id",
  environmentName: "production",
  dockerImage: null,
  env: "TOKEN=env-redaction-prop-sentinel",
  createdAt: null,
  cpuLimit: null,
  memoryLimit: null,
  replicas: null,
  composeFile: null,
  composeType: "docker-compose",
  domains: [],
  deployments: [],
};

afterEach(() => vi.restoreAllMocks());

describe("variables editor", () => {
  it("starts loading with no editable environment", () => {
    expect(initialVariablesEditorState).toEqual({ value: "", baseline: null, loadError: null });
    expect(variablesEditorReducer(initialVariablesEditorState, {
      type: "edited", value: "TOKEN=not-loaded",
    })).toEqual(initialVariablesEditorState);
  });

  it.each(["TOKEN=loaded", ""])("uses the loaded env (%s) as the clean baseline", (env) => {
    expect(variablesEditorReducer(initialVariablesEditorState, { type: "loaded", env }))
      .toEqual({ value: env, baseline: env, loadError: null });
  });

  it("keeps a failed load unavailable for editing", () => {
    const failed = variablesEditorReducer(initialVariablesEditorState, {
      type: "failed", error: "Could not load environment variables.",
    });

    expect(failed).toEqual({
      value: "", baseline: null, loadError: "Could not load environment variables.",
    });
    expect(variablesEditorReducer(failed, { type: "edited", value: "TOKEN=unsafe" })).toBe(failed);
  });

  it("keeps the loaded baseline while editing", () => {
    const loaded = variablesEditorReducer(initialVariablesEditorState, { type: "loaded", env: "TOKEN=old" });
    const edited = variablesEditorReducer(loaded, { type: "edited", value: "TOKEN=new" });

    expect(edited).toEqual({ value: "TOKEN=new", baseline: "TOKEN=old", loadError: null });
    expect(loaded.value).toBe("TOKEN=old");
  });

  it("uses the successfully saved value as the clean baseline", () => {
    const loaded = variablesEditorReducer(initialVariablesEditorState, { type: "loaded", env: "TOKEN=old" });
    const edited = variablesEditorReducer(loaded, { type: "edited", value: "TOKEN=new" });
    const saved = variablesEditorReducer(edited, { type: "saved", submittedValue: "TOKEN=new" });

    expect(saved).toEqual({ value: "TOKEN=new", baseline: "TOKEN=new", loadError: null });
    expect(edited.baseline).toBe("TOKEN=old");
  });

  it("keeps newer edits dirty when an earlier submitted value finishes saving", () => {
    const loaded = variablesEditorReducer(initialVariablesEditorState, { type: "loaded", env: "TOKEN=old" });
    const submitted = variablesEditorReducer(loaded, { type: "edited", value: "TOKEN=submitted" });
    const edited = variablesEditorReducer(submitted, { type: "edited", value: "TOKEN=newer" });
    const saved = variablesEditorReducer(edited, { type: "saved", submittedValue: submitted.value });

    expect(saved.value).toBe("TOKEN=newer");
    expect(saved.baseline).toBe("TOKEN=submitted");
    expect(saved.value).not.toBe(saved.baseline);
  });

  it.each(["TOKEN=submitted", "TOKEN=newer"])("only shows Saved while the current value (%s) matches the saved baseline", (value) => {
    vi.mocked(React.useReducer).mockReturnValueOnce([
      { value, baseline: "TOKEN=submitted", loadError: null }, vi.fn(),
    ]);
    vi.spyOn(primitives, "useSavedFlash").mockReturnValue([true, vi.fn()]);

    const html = renderToStaticMarkup(React.createElement(VariablesTab, { service }));

    expect(html.includes("Saved</span>")).toBe(value === "TOKEN=submitted");
    expect(html).toContain("Save variables</button>");
  });

  it("renders the loading skeleton without exposing the service's env prop", () => {
    const html = renderToStaticMarkup(React.createElement(VariablesTab, { service }));

    expect(html).toContain('role="status"');
    expect(html).toContain('aria-label="Loading environment variables"');
    expect(html).not.toContain("env-redaction-prop-sentinel");
    expect(html).not.toContain("<textarea");
  });
});
