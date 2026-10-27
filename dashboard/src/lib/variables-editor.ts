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
    case "loaded":
      return { value: event.env, baseline: event.env, loadError: null };
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
