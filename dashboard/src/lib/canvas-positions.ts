/** Prune deleted services without discarding positions hidden by project filters. */
export function pruneCanvasPositions(
  positions: Record<string, { x: number; y: number }>,
  liveServiceIds: readonly string[],
): Record<string, { x: number; y: number }> {
  const live = new Set(liveServiceIds);
  return Object.fromEntries(Object.entries(positions).filter(([id]) => live.has(id)));
}
