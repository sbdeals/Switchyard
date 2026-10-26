import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { VariablesTab } from "../components/service/VariablesTab";
import type { ComposeService } from "./dokploy";
import { appliedVariablesEditorState, initialVariablesEditorState, variablesEditorReducer, type VariablesEditorState } from "./variables-editor";
import { emptyStagedState, stagingReducer } from "./staged-changes";
import { stagedVariableValues } from "./staged-collections";
import { serializeVariableRows, variableRows } from "./variable-rows";

const staging = vi.hoisted(() => ({
  drafts: {} as Record<string, unknown>,
  applied: {} as Record<string, string>,
  stage: vi.fn(),
}));

vi.mock("@/components/service/StagedChanges", () => ({
  useStaging: () => ({ ...staging, pending: false, revision: 0, setDraft: vi.fn() }),
  useStagedState: (key: string, initial: unknown) => [Object.hasOwn(staging.drafts, key) ? staging.drafts[key] : initial, vi.fn()],
  useStagedForm: (operation: unknown) => staging.stage(operation),
}));

vi.mock("@/app/reference-actions", () => ({ validateServiceReferencesAction: vi.fn() }));

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
  env: "PROP_ONLY=env-redaction-prop-sentinel",
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

function renderEditor(currentService = service) {
  return renderToStaticMarkup(createElement(VariablesTab, { service: currentService, services: [currentService] }));
}

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

  it.each([service.env, null])("renders the loading skeleton without using the service's env prop (%s)", (env) => {
    const html = renderEditor({ ...service, env });

    expect(html).toContain('role="status"');
    expect(html).toContain('aria-label="Loading environment variables"');
    expect(html).not.toContain("env-redaction-prop-sentinel");
    expect(html).not.toContain("<textarea");
    expect(staging.stage).toHaveBeenCalledWith(expect.objectContaining({ before: {}, after: {} }));
  });

  it("renders cached loaded variables as a clean table without falling back to page env", () => {
    staging.drafts.variablesEditor = variablesEditorReducer(initialVariablesEditorState, {
      type: "loaded", env: "TOKEN=loaded-value\nEMPTY=",
    });

    const html = renderEditor();

    expect(html).toContain('aria-label="Variables"');
    expect(html).toContain('aria-label="Edit TOKEN"');
    expect(html).toContain('aria-label="Edit EMPTY"');
    expect(html).not.toContain("Loading environment variables");
    expect(html).not.toMatch(/PROP_ONLY|env-redaction-prop-sentinel|loaded-value/);
    expect(staging.stage).toHaveBeenLastCalledWith(expect.objectContaining({
      args: [service.id, "TOKEN=loaded-value\nEMPTY="],
      before: { "Variable TOKEN": "loaded-value", "Variable EMPTY": "" },
      after: { "Variable TOKEN": "loaded-value", "Variable EMPTY": "" },
      error: undefined,
    }));
  });

  it("retains table draft rows and the raw template across remounts without losing the loaded baseline", () => {
    const baseline = '# keep this comment\nTOKEN=old\n\nMULTI="first\nsecond"\n';
    const rows = [
      ...variableRows(baseline).map((row) => row.key === "TOKEN" ? { ...row, value: "new" } : row),
      { index: 6, key: "#UNFINISHED", value: "draft-value" },
    ];
    const value = serializeVariableRows(baseline, rows);
    staging.drafts.variablesEditor = { value, baseline, loadError: null };
    staging.drafts.variableRows = { template: baseline, rows };

    for (let reopen = 0; reopen < 2; reopen++) {
      const html = renderEditor();

      // Parsing the serialized text would drop this comment-like invalid key.
      expect(html).toContain('aria-label="Edit #UNFINISHED"');
      expect(html).toContain('aria-label="Edit MULTI"');
      expect(html).toContain("Use letters, numbers and underscores");
      expect(staging.stage).toHaveBeenLastCalledWith(expect.objectContaining({
        args: [service.id, '# keep this comment\nTOKEN=new\n\nMULTI="first\nsecond"\n#UNFINISHED=draft-value\n'],
        before: expect.objectContaining({ "Variable TOKEN": "old" }),
        after: expect.objectContaining({ "Variable TOKEN": "new" }),
        error: "Fix variable errors before deploying.",
      }));
    }
  });

  it("rebuilds table rows from a raw draft while retaining its baseline and formatting", () => {
    const value = '# raw comment\nTOKEN=new\nMULTI="first\nsecond"\n';
    staging.drafts.variablesEditor = { value, baseline: "TOKEN=old", loadError: null };
    staging.drafts.variableRows = null;

    const html = renderEditor();

    expect(html).toContain('aria-label="Edit TOKEN"');
    expect(html).toContain('aria-label="Edit MULTI"');
    expect(staging.stage).toHaveBeenLastCalledWith(expect.objectContaining({
      args: [service.id, value],
      before: { "Variable TOKEN": "old" },
      after: expect.objectContaining({ "Variable TOKEN": "new" }),
      error: undefined,
    }));
  });

  it.each(["saved", "newer"])("rebases the rendered %s draft after an env write succeeds before a later staged failure", (value) => {
    staging.drafts.variablesEditor = { value: `TOKEN=${value}`, baseline: "TOKEN=old", loadError: null };
    staging.applied.variables = JSON.stringify([service.id, "TOKEN=saved"]);

    renderEditor();

    expect(staging.stage).toHaveBeenLastCalledWith(expect.objectContaining({
      args: [service.id, `TOKEN=${value}`],
      before: { "Variable TOKEN": "saved" },
      after: { "Variable TOKEN": value },
      error: undefined,
    }));
  });

  it("returns to lazy loading when a full save clears the staged editor and row drafts", () => {
    staging.drafts.variablesEditor = { value: "TOKEN=saved", baseline: "TOKEN=old", loadError: null };
    staging.drafts.variableRows = { template: "TOKEN=old", rows: [{ index: 0, key: "TOKEN", value: "saved" }] };
    expect(renderEditor()).toContain('aria-label="Edit TOKEN"');

    // The staging provider resets both caches after a successful deployment.
    Object.assign(staging, emptyStagedState());
    const html = renderEditor();

    expect(html).toContain('aria-label="Loading environment variables"');
    expect(html).not.toContain('aria-label="Variables"');
    expect(html).not.toContain("env-redaction-prop-sentinel");
    expect(staging.stage).toHaveBeenLastCalledWith(expect.objectContaining({
      args: [service.id, ""], before: {}, after: {},
    }));
  });

  it("shows a failed load without using page env or exposing an editable table", () => {
    staging.drafts.variablesEditor = variablesEditorReducer(initialVariablesEditorState, {
      type: "failed", error: "Could not load environment variables.",
    });

    const html = renderEditor();

    expect(html).toContain('role="alert"');
    expect(html).toContain("Could not load environment variables.");
    expect(html).not.toContain('aria-label="Variables"');
    expect(html).not.toContain("env-redaction-prop-sentinel");
    expect(staging.stage).toHaveBeenLastCalledWith(expect.objectContaining({ before: {}, after: {} }));
  });
});
