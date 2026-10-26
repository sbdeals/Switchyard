import { decodeStoredEnv } from "./references";

export interface VariablesEditorState {
  value: string;
  baseline: string | null;
  loadError: string | null;
}

type VariablesEditorEvent =
  | { type: "loaded"; env: string }
  | { type: "edited"; value: string }
  | { type: "saved"; submittedValue: string }
  | { type: "failed"; error: string };

export const initialVariablesEditorState: VariablesEditorState = {
  value: "",
  baseline: null,
  loadError: null,
};

export function variablesEditorReducer(
  state: VariablesEditorState,
  event: VariablesEditorEvent,
): VariablesEditorState {
  switch (event.type) {
    case "loaded": {
      const template = decodeStoredEnv(event.env);
      return { value: template, baseline: template, loadError: null };
    }
    case "edited":
      if (state.baseline === null || state.loadError !== null) return state;
      return { ...state, value: event.value };
    case "saved":
      // The editor may have changed while the submitted value was saving.
      return { ...state, baseline: event.submittedValue };
    case "failed":
      return { ...state, loadError: event.error };
  }
}

/** A successful env save remains the baseline even if a later staged step fails. */
export function appliedVariablesEditorState(
  state: VariablesEditorState,
  appliedArgs: string | undefined,
): VariablesEditorState {
  if (state.baseline === null || !appliedArgs) return state;
  const args: unknown = JSON.parse(appliedArgs);
  const submittedValue = Array.isArray(args) ? args.at(-1) : undefined;
  if (typeof submittedValue !== "string" || submittedValue === state.baseline) return state;
  return variablesEditorReducer(state, { type: "saved", submittedValue });
}
