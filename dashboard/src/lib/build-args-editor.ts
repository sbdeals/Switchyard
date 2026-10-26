export interface BuildArgsEditorState {
  value: string;
  baseline: string | null;
  loadError: string | null;
}

type BuildArgsEditorEvent =
  | { type: "loading" }
  | { type: "loaded"; buildArgs: string }
  | { type: "edited"; value: string }
  | { type: "saved"; submittedValue: string }
  | { type: "failed"; error: string };

export const initialBuildArgsEditorState: BuildArgsEditorState = {
  value: "",
  baseline: null,
  loadError: null,
};

export function buildArgsEditorReducer(
  state: BuildArgsEditorState,
  event: BuildArgsEditorEvent,
): BuildArgsEditorState {
  switch (event.type) {
    case "loading":
      return initialBuildArgsEditorState;
    case "loaded":
      return { value: event.buildArgs, baseline: event.buildArgs, loadError: null };
    case "edited":
      if (state.baseline === null || state.loadError !== null) return state;
      return { ...state, value: event.value };
    case "saved":
      // Keep newer edits dirty if an earlier submitted value finishes saving.
      return { ...state, baseline: event.submittedValue };
    case "failed":
      return { ...initialBuildArgsEditorState, loadError: event.error };
  }
}
