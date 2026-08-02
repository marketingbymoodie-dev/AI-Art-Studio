/**
 * Merge size/color selection after a Printify catalog refresh.
 *
 * Printify's default variants.json is in-stock only; after we switch refresh to
 * show-out-of-stock=1, fully OOS colors (e.g. White/Black at JAMS) newly appear.
 * Those must join selectedColorIds so the OOS denominator matches the Printify UI,
 * while intentional deselections of colors that already existed stay deselected.
 */
export function mergeNewlyAppearedSelectionIds(args: {
  existingSelectedIds: string[];
  previousOptionIds: string[];
  refreshedOptionIds: string[];
}): string[] {
  const refreshed = args.refreshedOptionIds.filter((id) => typeof id === "string" && id.length > 0);
  const refreshedSet = new Set(refreshed);
  const previousSet = new Set(
    args.previousOptionIds.filter((id) => typeof id === "string" && id.length > 0),
  );
  const existing = args.existingSelectedIds.filter((id) => typeof id === "string" && id.length > 0);

  // Empty selection historically means "all" — adopt the full refreshed set.
  if (existing.length === 0) {
    return refreshed;
  }

  const kept = existing.filter((id) => refreshedSet.has(id));
  const newlyAppeared = refreshed.filter((id) => !previousSet.has(id));
  return Array.from(new Set([...kept, ...newlyAppeared]));
}
