import { beforeEach, describe, expect, it, vi } from "vitest";
import { ComposeEditorTab } from "../components/service/ComposeTabs";
import { VariablesTab } from "../components/service/VariablesTab";
import type { ComposeService } from "./dokploy";
import { setVariable, sharedReference } from "./shared-variables";
import { initialVariablesEditorState, variablesEditorReducer } from "./variables-editor";

const mocks = vi.hoisted(() => ({
  useState: vi.fn(),
  useReducer: vi.fn(),
  useDirtyGuard: vi.fn(),
}));

vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(),
  useState: mocks.useState,
  useReducer: mocks.useReducer,
  useEffect: vi.fn(),
  useTransition: () => [false, vi.fn()],
}));
vi.mock("@/components/DirtyGuard", () => ({ useDirtyGuard: mocks.useDirtyGuard }));
vi.mock("@/app/actions", () => ({}));
vi.mock("@/components/use-shared-variables", () => ({
  useSharedVariableKeys: () => ({ keys: { project: ["SHARED_TOKEN"], environment: [] } }),
}));

const service = { kind: "compose", id: "compose-id", env: null, composeFile: null } as ComposeService;
const loaded = variablesEditorReducer(initialVariablesEditorState, { type: "loaded", env: "TOKEN=loaded" });
const edited = variablesEditorReducer(loaded, { type: "edited", value: "TOKEN=edited" });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.useState.mockImplementation((initial) => [initial, vi.fn()]);
});

describe.each(["Variables", "Compose"] as const)("%s on-demand dirty baseline", (tab) => {
  it.each([
    ["loading", initialVariablesEditorState, false],
    ["failed", variablesEditorReducer(initialVariablesEditorState, { type: "failed", error: "Load failed" }), false],
    ["loaded", loaded, false],
    ["loaded empty", variablesEditorReducer(initialVariablesEditorState, { type: "loaded", env: "" }), false],
    ["edited", edited, true],
    ["reverted", variablesEditorReducer(edited, { type: "edited", value: loaded.value }), false],
    ["saved", variablesEditorReducer(edited, { type: "saved", submittedValue: edited.value }), false],
    ["failed after editing", variablesEditorReducer(edited, { type: "failed", error: "Load failed" }), false],
  ] as const)("registers the correct guard while %s", (_, state, dirty) => {
    if (tab === "Variables") {
      mocks.useReducer.mockReturnValue([state, vi.fn()]);
      VariablesTab({ service });
    } else {
      mocks.useState
        .mockReturnValueOnce([state.value, vi.fn()])
        .mockReturnValueOnce([state.baseline, vi.fn()])
        .mockReturnValueOnce([state.loadError, vi.fn()]);
      ComposeEditorTab({ compose: service });
    }

    expect(mocks.useDirtyGuard).toHaveBeenCalledExactlyOnceWith(tab, dirty);
  });
});

it("guards inserted shared references until the submitted value is saved", () => {
  const inserted = variablesEditorReducer(loaded, {
    type: "edited",
    value: setVariable(loaded.value, "API_TOKEN", sharedReference("project", "SHARED_TOKEN")),
  });
  mocks.useReducer.mockReturnValue([inserted, vi.fn()]);
  VariablesTab({ service });
  expect(mocks.useDirtyGuard).toHaveBeenLastCalledWith("Variables", true);

  mocks.useReducer.mockReturnValue([
    variablesEditorReducer(inserted, { type: "saved", submittedValue: inserted.value }),
    vi.fn(),
  ]);
  VariablesTab({ service });
  expect(mocks.useDirtyGuard).toHaveBeenLastCalledWith("Variables", false);
});
