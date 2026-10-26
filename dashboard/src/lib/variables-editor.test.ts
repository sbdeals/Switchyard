import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { VariablesTab } from "../components/service/VariablesTab";
import type { ComposeService } from "./dokploy";
import { appliedVariablesEditorState, initialVariablesEditorState, variablesEditorReducer, type VariablesEditorState } from "./variables-editor";
import { emptyStagedState, stagingReducer } from "./staged-changes";
import { stagedVariableValues } from "./staged-collections";

const staging = vi.hoisted(() => ({
  drafts: {} as Record<string, unknown>,
  applied: {} as Record<string, string>,
  stage: vi.fn(),
}));

vi.mock("@/components/service/StagedChanges", () => ({
  useStaging: () => ({ ...staging, pending: false, setDraft: vi.fn() }),
  useStagedForm: (operation: unknown) => staging.stage(operation),
}));

vi.mock("@/app/reference-actions", () => ({ validateServiceReferencesAction: vi.fn() }));

vi.mock("@/app/actions", () => ({
  loadServiceEnvAction: vi.fn(),
  saveEnvironmentAction: vi.fn(),
  saveApplicationEnvAction: vi.fn(),
  saveComposeEnvAction: vi.fn(),
}));

describe("variables editor", () => {
  beforeEach(() => {
    staging.drafts = {};
    staging.applied = {};
    staging.stage.mockClear();
  });

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

  it("decodes stored references before setting the editor and diff baseline", () => {
    const template = "DATABASE_URL=${{db.DATABASE_URL}}\nTOKEN=loaded";
    const loaded = variablesEditorReducer(initialVariablesEditorState, {
      type: "loaded",
      env: "# switchyard:ref DATABASE_URL=${{db.DATABASE_URL}}\nDATABASE_URL=resolved-secret\nTOKEN=loaded",
    });

    expect(loaded).toEqual({ value: template, baseline: template, loadError: null });
    expect(stagedVariableValues(loaded.baseline!, loaded.value).before)
      .toEqual(stagedVariableValues(loaded.baseline!, loaded.value).after);
    expect(JSON.stringify(loaded)).not.toContain("resolved-secret");
  });

  it("retains the real loaded baseline and edited draft while the tab is closed", () => {
    const loaded = variablesEditorReducer(initialVariablesEditorState, { type: "loaded", env: "TOKEN=old" });
    const edited = variablesEditorReducer(loaded, { type: "edited", value: "TOKEN=new" });
    const state = stagingReducer(emptyStagedState(), { type: "draft", key: "variablesEditor", value: edited });
    const reopened = state.drafts.variablesEditor as VariablesEditorState;

    expect(reopened.value).toBe("TOKEN=new");
    expect(reopened.baseline).toBe("TOKEN=old");
    expect(stagedVariableValues(reopened.baseline!, reopened.value)).toEqual({
      before: { "Variable TOKEN": "old" },
      after: { "Variable TOKEN": "new" },
      secretFields: ["Variable TOKEN"],
    });
  });

  it.each([["compose-id", "TOKEN=saved"], ["postgres", "database-id", "TOKEN=saved"]])(
    "rebases applied env writes when a later operation or deployment fails (%s)", (...args) => {
      const loaded = variablesEditorReducer(initialVariablesEditorState, { type: "loaded", env: "TOKEN=old" });
      const edited = variablesEditorReducer(loaded, { type: "edited", value: "TOKEN=saved" });
      const saved = appliedVariablesEditorState(edited, JSON.stringify(args));

      expect(saved.value).toBe(saved.baseline);
      const newer = variablesEditorReducer(saved, { type: "edited", value: "TOKEN=newer" });
      expect(stagedVariableValues(newer.baseline!, newer.value).before).toEqual({ "Variable TOKEN": "saved" });
    },
  );

  it("does not make an unloaded editor available from applied operation arguments", () => {
    expect(appliedVariablesEditorState(initialVariablesEditorState, '["compose-id","TOKEN=saved"]'))
      .toBe(initialVariablesEditorState);
  });

  it("renders the loading skeleton without exposing the service's env prop", () => {
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
      managed: null,
      domains: [],
      deployments: [],
    };

    const html = renderToStaticMarkup(createElement(VariablesTab, { service, services: [service] }));

    expect(html).toContain('role="status"');
    expect(html).toContain('aria-label="Loading environment variables"');
    expect(html).not.toContain("env-redaction-prop-sentinel");
    expect(html).not.toContain("<textarea");
    expect(staging.stage).toHaveBeenCalledWith(expect.objectContaining({ before: {}, after: {} }));
  });
});
