/** Return a boundary only when Tab would leave the dialog's tab order. */
export function focusBoundaryIndex(activeIndex: number, count: number, backwards: boolean): number | null {
  if (count === 0) return null;
  if (activeIndex === -1) return backwards ? count - 1 : 0;
  if (backwards && activeIndex === 0) return count - 1;
  if (!backwards && activeIndex === count - 1) return 0;
  return null;
}

export interface DialogEntry<T> {
  panel: T;
  opener: T | null;
}

/** Transfer the return target when an outgoing popover opened another dialog. */
export function removeDialog<T>(
  stack: DialogEntry<T>[],
  entry: DialogEntry<T>,
  contains: (panel: T, target: T) => boolean
): T | null {
  const index = stack.indexOf(entry);
  if (index === -1) return null;
  const topmost = index === stack.length - 1;
  for (const other of stack) {
    if (other !== entry && other.opener !== null && contains(entry.panel, other.opener)) {
      other.opener = entry.opener;
    }
  }
  stack.splice(index, 1);
  return topmost ? entry.opener : null;
}
