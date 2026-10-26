import { parseDotenvRaw } from "./dotenv-raw";

export type EditorMode = "rows" | "raw";
export type ExportKind = "copy" | "download";

export interface EditorState {
  text: string;
  mode: EditorMode;
  review: string | null;
  exporting: ExportKind | null;
}

export type EditorAction =
  | { type: "edit"; text: string }
  | { type: "mode"; mode: EditorMode }
  | { type: "review" }
  | { type: "cancelReview" }
  | { type: "export"; kind: ExportKind }
  | { type: "cancelExport" }
  | { type: "saved"; text: string };

export function createEditorState(env: string): EditorState {
  const parsed = parseDotenvRaw(env);
  return {
    text: env,
    mode: parsed.errors.length ? "raw" : "rows",
    review: null,
    exporting: null,
  };
}

/** Keep drafts and confirmation snapshots local until the existing save succeeds. */
export function dotenvEditorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case "edit":
      return { ...state, text: action.text, review: null, exporting: null };
    case "mode":
      if (action.mode === "rows" && parseDotenvRaw(state.text).errors.length) return state;
      return { ...state, mode: action.mode };
    case "review": {
      const parsed = parseDotenvRaw(state.text);
      if (parsed.errors.length) return state;
      return { ...state, review: state.text, exporting: null };
    }
    case "cancelReview":
      return { ...state, review: null };
    case "export":
      if (parseDotenvRaw(state.text).errors.length) return state;
      return { ...state, exporting: action.kind };
    case "cancelExport":
      return { ...state, exporting: null };
    case "saved":
      return { ...state, text: action.text, review: null, exporting: null };
  }
}
