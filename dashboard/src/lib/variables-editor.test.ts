import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { VariablesTab } from "../components/service/VariablesTab";
import { DirtyGuardProvider } from "../components/DirtyGuard";
import type { ComposeService } from "./dokploy";
import { initialVariablesEditorState, isVariablesEditorDirty, variablesEditorReducer } from "./variables-editor";
import { createDirtyRegistry, decideDirtyNavigation } from "./dirty-guard";

vi.mock("@/app/actions", () => ({
  loadServiceEnvAction: vi.fn(),
  saveEnvironmentAction: vi.fn(),
  saveApplicationEnvAction: vi.fn(),
  saveComposeEnvAction: vi.fn(),
}));

describe("variables editor", () => {
  it("starts loading with no editable environment", () => {
    expect(initialVariablesEditorState).toEqual({ value: "", baseline: null, loadError: null });
    expect(isVariablesEditorDirty(initialVariablesEditorState)).toBe(false);
    expect(variablesEditorReducer(initialVariablesEditorState, {
      type: "edited", value: "TOKEN=not-loaded",
    })).toEqual(initialVariablesEditorState);
  });

  it.each(["TOKEN=loaded", ""])("uses the loaded env (%s) as the clean baseline", (env) => {
    const loaded = variablesEditorReducer(initialVariablesEditorState, { type: "loaded", env });
    expect(loaded).toEqual({ value: env, baseline: env, loadError: null });
    expect(isVariablesEditorDirty(loaded)).toBe(false);
  });

  it("keeps a failed load unavailable for editing", () => {
    const failed = variablesEditorReducer(initialVariablesEditorState, {
      type: "failed", error: "Could not load environment variables.",
    });

    expect(failed).toEqual({
      value: "", baseline: null, loadError: "Could not load environment variables.",
    });
    expect(variablesEditorReducer(failed, { type: "edited", value: "TOKEN=unsafe" })).toBe(failed);
    expect(isVariablesEditorDirty(failed)).toBe(false);
  });

  it("keeps the loaded baseline while editing", () => {
    const loaded = variablesEditorReducer(initialVariablesEditorState, { type: "loaded", env: "TOKEN=old" });
    const edited = variablesEditorReducer(loaded, { type: "edited", value: "TOKEN=new" });

    expect(edited).toEqual({ value: "TOKEN=new", baseline: "TOKEN=old", loadError: null });
    expect(loaded.value).toBe("TOKEN=old");
    expect(isVariablesEditorDirty(edited)).toBe(true);
    expect(isVariablesEditorDirty(variablesEditorReducer(edited, {
      type: "edited", value: loaded.value,
    }))).toBe(false);
  });

  it("uses the successfully saved value as the clean baseline", () => {
    const loaded = variablesEditorReducer(initialVariablesEditorState, { type: "loaded", env: "TOKEN=old" });
    const edited = variablesEditorReducer(loaded, { type: "edited", value: "TOKEN=new" });
    const saved = variablesEditorReducer(edited, { type: "saved", submittedValue: "TOKEN=new" });

    expect(saved).toEqual({ value: "TOKEN=new", baseline: "TOKEN=new", loadError: null });
    expect(edited.baseline).toBe("TOKEN=old");
    expect(isVariablesEditorDirty(saved)).toBe(false);
  });

  it("keeps newer edits dirty when an earlier submitted value finishes saving", () => {
    const loaded = variablesEditorReducer(initialVariablesEditorState, { type: "loaded", env: "TOKEN=old" });
    const submitted = variablesEditorReducer(loaded, { type: "edited", value: "TOKEN=submitted" });
    const edited = variablesEditorReducer(submitted, { type: "edited", value: "TOKEN=newer" });
    const saved = variablesEditorReducer(edited, { type: "saved", submittedValue: submitted.value });

    expect(saved.value).toBe("TOKEN=newer");
    expect(saved.baseline).toBe("TOKEN=submitted");
    expect(isVariablesEditorDirty(saved)).toBe(true);
  });

  it("guards navigation only for edits against the loaded or saved baseline", () => {
    const registry = createDirtyRegistry();
    let state = initialVariablesEditorState;
    const navigate = () => {
      registry.set("variables", "Variables", isVariablesEditorDirty(state));
      return decideDirtyNavigation(registry.labels(), false);
    };

    expect(navigate()).toBe("proceed");
    state = variablesEditorReducer(state, { type: "loaded", env: "TOKEN=loaded" });
    expect(navigate()).toBe("proceed");
    state = variablesEditorReducer(state, { type: "edited", value: "TOKEN=edited" });
    expect(navigate()).toBe("confirm");
    expect(registry.labels()).toEqual(["Variables"]);
    state = variablesEditorReducer(state, { type: "saved", submittedValue: "TOKEN=edited" });
    expect(navigate()).toBe("proceed");
    state = variablesEditorReducer(state, { type: "edited", value: "TOKEN=loaded" });
    expect(navigate()).toBe("confirm");
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
      domains: [],
      deployments: [],
    };

    const html = renderToStaticMarkup(createElement(DirtyGuardProvider, null,
      createElement(VariablesTab, { service }),
    ));

    expect(html).toContain('role="status"');
    expect(html).toContain('aria-label="Loading environment variables"');
    expect(html).not.toContain("env-redaction-prop-sentinel");
    expect(html).not.toContain("<textarea");
  });
});
