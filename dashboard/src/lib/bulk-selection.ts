export type BulkSelection = { ids: string[]; anchor: string | null };

export const emptySelection: BulkSelection = { ids: [], anchor: null };

export function hasSelectionModifier(event: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }): boolean {
  return event.shiftKey || event.ctrlKey || event.metaKey;
}

/** React Flow emits changes for individual nodes, including deselection. */
export function applySelectionChanges(
  selectedIds: readonly string[],
  changes: readonly { id: string; selected: boolean }[]
): string[] {
  const selected = new Set(selectedIds);
  for (const change of changes) {
    if (change.selected) selected.add(change.id);
    else selected.delete(change.id);
  }
  return [...selected];
}

/** Keep selection in display order, limited to services still in this view. */
export function reconcileSelection(
  selection: BulkSelection,
  orderedIds: readonly string[]
): BulkSelection {
  const selected = new Set(selection.ids);
  const available = [...new Set(orderedIds)];
  return {
    ids: available.filter((id) => selected.has(id)),
    anchor: selection.anchor && available.includes(selection.anchor) ? selection.anchor : null,
  };
}

export function toggleSelection(
  selection: BulkSelection,
  orderedIds: readonly string[],
  id: string,
  shift: boolean
): BulkSelection {
  const current = reconcileSelection(selection, orderedIds);
  const targetIndex = orderedIds.indexOf(id);
  if (targetIndex === -1) return current;

  const selected = new Set(current.ids);
  const checked = !selected.has(id);
  const anchorIndex = current.anchor === null ? -1 : orderedIds.indexOf(current.anchor);
  const range = shift && anchorIndex !== -1
    ? orderedIds.slice(Math.min(anchorIndex, targetIndex), Math.max(anchorIndex, targetIndex) + 1)
    : [id];
  for (const rangeId of range) {
    if (checked) selected.add(rangeId);
    else selected.delete(rangeId);
  }
  return reconcileSelection({
    ids: [...selected],
    anchor: shift && anchorIndex !== -1 ? current.anchor : id,
  }, orderedIds);
}

/** React Flow supplies the complete selected set instead of checkbox toggles. */
export function replaceSelection(
  selection: BulkSelection,
  orderedIds: readonly string[],
  ids: readonly string[]
): BulkSelection {
  const next = reconcileSelection({ ids: [...ids], anchor: selection.anchor }, orderedIds);
  return {
    ids: next.ids,
    anchor: next.anchor && next.ids.includes(next.anchor)
      ? next.anchor
      : next.ids[next.ids.length - 1] ?? null,
  };
}
