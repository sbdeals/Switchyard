import { parseDotenvRaw } from "./dotenv-raw";

export type EditorMode = "rows" | "raw";
export type ExportKind = "copy" | "download";

export interface EditorState {
  text: string;
  baseline: string | null;
  loadError: string | null;
  mode: EditorMode;
  review: string | null;
  exporting: ExportKind | null;
}

export type EditorAction =
  | { type: "loaded"; env: string }
  | { type: "failed"; error: string }
  | { type: "edit"; text: string }
  | { type: "mode"; mode: EditorMode }
  | { type: "review" }
  | { type: "cancelReview" }
  | { type: "export"; kind: ExportKind }
  | { type: "cancelExport" }
  | { type: "saved"; text: string };

export function createEditorState(env: string | null): EditorState {
  const text = env ?? "";
  const parsed = parseDotenvRaw(text);
  return {
    text,
    baseline: env,
    loadError: null,
    mode: parsed.errors.length ? "raw" : "rows",
    review: null,
    exporting: null,
  };
}

/** Keep drafts and confirmation snapshots local until the existing save succeeds. */
export function dotenvEditorReducer(state: EditorState, action: EditorAction): EditorState {
  const loaded = state.baseline !== null && state.loadError === null;
  switch (action.type) {
    case "loaded":
      return createEditorState(action.env);
    case "failed":
      return { ...state, loadError: action.error, review: null, exporting: null };
    case "edit":
      if (!loaded) return state;
      return { ...state, text: action.text, review: null, exporting: null };
    case "mode":
      if (!loaded) return state;
      if (action.mode === "rows" && parseDotenvRaw(state.text).errors.length) return state;
      return { ...state, mode: action.mode };
    case "review": {
      if (!loaded) return state;
      const parsed = parseDotenvRaw(state.text);
      if (parsed.errors.length) return state;
      return { ...state, review: state.text, exporting: null };
    }
    case "cancelReview":
      return { ...state, review: null };
    case "export":
      if (!loaded) return state;
      if (parseDotenvRaw(state.text).errors.length) return state;
      return { ...state, exporting: action.kind };
    case "cancelExport":
      return { ...state, exporting: null };
    case "saved":
      // Preserve edits made while the submitted review snapshot was saving.
      return { ...state, baseline: action.text, review: null, exporting: null };
  }
}
