import { createElement, useReducer } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { VariablesTab } from "../components/service/VariablesTab";
import { DirtyGuardProvider } from "../components/DirtyGuard";
import type { ComposeService } from "./dokploy";
import { createEditorState, dotenvEditorReducer, type EditorState } from "./dotenv-editor";
import { initialVariablesEditorState, variablesEditorReducer } from "./variables-editor";

vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>();
  return { ...react, useReducer: vi.fn(react.useReducer) };
});

vi.mock("@/lib/client-actions", () => ({
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
  env: null,
  createdAt: null,
  cpuLimit: null,
  memoryLimit: null,
  replicas: null,
  composeFile: null,
  composeType: "docker-compose",
  domains: [],
  deployments: [],
};

// Server rendering does not run the loading effect. Supply the real reducer's
// post-action state to check what the component renders after that effect.
function renderEditor(state: EditorState) {
  vi.mocked(useReducer).mockReturnValueOnce([state, vi.fn()]);
  return renderToStaticMarkup(createElement(DirtyGuardProvider, null,
    createElement(VariablesTab, { service }),
  ));
}

function button(html: string, label: string) {
  const markup = html.match(new RegExp(`<button[^>]*>${label}</button>`))?.[0];
  expect(markup).toBeDefined();
  return markup!;
}

describe("variables editor", () => {
  it("renders the loading skeleton without exposing the service's env prop", () => {
    const html = renderToStaticMarkup(createElement(DirtyGuardProvider, null,
      createElement(VariablesTab, {
        service: { ...service, env: "TOKEN=env-redaction-prop-sentinel" },
      }),
    ));

    expect(html).toContain('role="status"');
    expect(html).toContain('aria-label="Loading environment variables"');
    expect(html).not.toContain("env-redaction-prop-sentinel");
    expect(html).not.toContain("<textarea");
    expect(html).not.toContain("Row editor");
    expect(html).not.toContain("Raw editor");
    expect(html).not.toContain("Copy as .env");
    expect(html).not.toContain("Download .env");
    expect(html).not.toContain("Review changes");
  });

  it("renders loaded values in rows and raw modes with a clean baseline", () => {
    const env = "TOKEN=loaded-value\nEMPTY=";
    const loaded = dotenvEditorReducer(createEditorState(null), { type: "loaded", env });
    const rows = renderEditor(loaded);

    expect(rows).not.toContain("Loading environment variables");
    expect(rows).toContain('aria-label="Value for TOKEN"');
    expect(rows).toContain(">loaded-value</textarea>");
    expect(rows).toContain('aria-label="Value for EMPTY"');
    expect(rows).toContain("Copy as .env");
    expect(rows).toContain("Download .env");
    expect(rows).not.toContain('aria-label="Variable changes"');
    expect(button(rows, "Review changes")).toContain('disabled=""');

    const raw = renderEditor(dotenvEditorReducer(loaded, { type: "mode", mode: "raw" }));
    expect(raw).toContain('aria-label="Environment variables, one KEY=value per line"');
    expect(raw).toContain(`>${env}</textarea>`);
    expect(button(raw, "Review changes")).toContain('disabled=""');
  });

  it("uses the loaded baseline for masked added, changed and removed review entries", () => {
    let state = dotenvEditorReducer(createEditorState(null), {
      type: "loaded", env: "CHANGED=old-secret\nREMOVED=removed-secret\nUNCHANGED=same-secret",
    });
    state = dotenvEditorReducer(state, {
      type: "edit", text: "CHANGED=new-secret\nADDED=added-secret\nUNCHANGED=same-secret",
    });
    const draft = renderEditor(state);
    expect(button(draft, "Review changes")).not.toContain('disabled=""');

    const review = renderEditor(dotenvEditorReducer(state, { type: "review" }));
    for (const kind of ["added", "changed", "removed"]) expect(review).toContain(`${kind} (1)`);
    for (const key of ["CHANGED", "ADDED", "REMOVED"]) expect(review).toContain(`${key}=••••••••`);
    for (const value of ["old-secret", "removed-secret", "same-secret", "new-secret", "added-secret"]) {
      expect(review).not.toContain(value);
    }
    expect(review).not.toContain("UNCHANGED=••••••••");
    expect(review).not.toContain("<textarea");
    expect(button(review, "Confirm changes")).not.toContain('disabled=""');
    expect(review).toContain("Back to editing");
  });

  it("renders a clean editor after saving the reviewed draft", () => {
    let state = dotenvEditorReducer(createEditorState(null), { type: "loaded", env: "KEY=original" });
    state = dotenvEditorReducer(state, { type: "mode", mode: "raw" });
    state = dotenvEditorReducer(state, { type: "edit", text: "KEY=saved-value" });
    state = dotenvEditorReducer(state, { type: "review" });
    state = dotenvEditorReducer(state, { type: "saved", text: state.review! });

    const html = renderEditor(state);
    expect(html).toContain(">KEY=saved-value</textarea>");
    expect(html).not.toContain('aria-label="Variable changes"');
    expect(html).not.toContain("Confirm changes");
    expect(button(html, "Review changes")).toContain('disabled=""');
  });

  it("shows a load failure without editors, review or export controls", () => {
    const failed = dotenvEditorReducer(createEditorState(null), {
      type: "failed", error: "Could not load environment variables.",
    });
    const html = renderEditor(failed);

    expect(html).toContain('role="alert"');
    expect(html).toContain("Could not load environment variables.");
    expect(html).not.toContain("Loading environment variables");
    expect(html).not.toContain("<textarea");
    expect(html).not.toContain("<button");
  });
});

// Restored from main: the base reducer still backs dotenvEditorReducer.
describe("variables editor reducer", () => {
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
});
