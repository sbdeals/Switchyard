import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { VariablesTab } from "../components/service/VariablesTab";
import { loadServiceEnvAction } from "@/app/actions";
import type { ComposeService } from "./dokploy";
import { setVariable, sharedReference } from "./shared-variables";
import { initialVariablesEditorState, variablesEditorReducer } from "./variables-editor";

vi.mock("@/app/actions", () => ({
  loadServiceEnvAction: vi.fn(),
  saveEnvironmentAction: vi.fn(),
  saveApplicationEnvAction: vi.fn(),
  saveComposeEnvAction: vi.fn(),
}));

vi.mock("@/components/use-shared-variables", () => ({
  useSharedVariableKeys: vi.fn(() => ({ keys: { project: ["SHARED_TOKEN"], environment: [] } })),
}));

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

  it("keeps inserted shared references dirty until saved against the loaded baseline", () => {
    const env = "# Preserve existing values\nTOKEN=loaded-secret\n";
    const loaded = variablesEditorReducer(initialVariablesEditorState, { type: "loaded", env });
    const inserted = variablesEditorReducer(loaded, {
      type: "edited",
      value: setVariable(loaded.value, "API_TOKEN", sharedReference("project", "SHARED_TOKEN")),
    });

    expect(inserted.value).toBe(`${env}API_TOKEN=\${{project.SHARED_TOKEN}}\n`);
    expect(inserted.baseline).toBe(env);
    expect(inserted.value).not.toBe(inserted.baseline);

    const saved = variablesEditorReducer(inserted, { type: "saved", submittedValue: inserted.value });
    expect(saved.value).toBe(saved.baseline);
    expect(saved.value).toBe(inserted.value);
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

    const html = renderToStaticMarkup(createElement(VariablesTab, { service }));

    expect(html).toContain('role="status"');
    expect(html).toContain('aria-label="Loading environment variables"');
    expect(html).not.toContain("env-redaction-prop-sentinel");
    expect(html).not.toContain("<textarea");
    expect(loadServiceEnvAction).not.toHaveBeenCalled();
  });
});
