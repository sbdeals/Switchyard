export interface EditorDraft {
  value: string;
  savedValue: string;
}

type DraftAction = { type: "edit" | "refresh" | "saved"; value: string };

/** A refresh updates pristine text; a save acknowledges its submitted snapshot. */
export function reduceEditorDraft(draft: EditorDraft, action: DraftAction): EditorDraft {
  switch (action.type) {
    case "edit":
      return { ...draft, value: action.value };
    case "refresh":
      return {
        value: draft.value === draft.savedValue ? action.value : draft.value,
        savedValue: action.value,
      };
    case "saved":
      return { ...draft, savedValue: action.value };
  }
}
