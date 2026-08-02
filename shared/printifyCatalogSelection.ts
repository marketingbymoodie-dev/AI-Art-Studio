/**
 * Merge size/color selection after a Printify catalog refresh.
 *
 * Full-catalog refresh can surface colors that were omitted when import used the
 * in-stock-only list. Preserve intentional deselections of colors that already
 * existed. For newly appeared ids, optionally limit auto-select (e.g. only
 * colors with at least one in-stock size) so dead colorways like Deep Heather
 * with no stock aren't forced into the storefront selection.
 */
export function mergeNewlyAppearedSelectionIds(args: {
  existingSelectedIds: string[];
  previousOptionIds: string[];
  refreshedOptionIds: string[];
  /**
   * When provided, only these newly appeared ids are auto-checked.
   * Omit to auto-select every newly appeared id (legacy).
   */
  autoSelectNewlyAppearedIds?: string[];
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
  const autoSelectSet =
    args.autoSelectNewlyAppearedIds != null
      ? new Set(args.autoSelectNewlyAppearedIds)
      : null;
  const toAdd = autoSelectSet
    ? newlyAppeared.filter((id) => autoSelectSet.has(id))
    : newlyAppeared;
  return Array.from(new Set([...kept, ...toAdd]));
}

/** Color ids that have at least one variantMap entry whose Printify id is in-stock. */
export function colorIdsWithInStockVariants(args: {
  variantMap: Record<string, { printifyVariantId?: number | string } | null | undefined>;
  inStockVariantIds: Array<number | string>;
}): string[] {
  const inStock = new Set(
    args.inStockVariantIds
      .map((id) => Number(id))
      .filter((id) => Number.isFinite(id) && id > 0),
  );
  const out = new Set<string>();
  for (const [key, entry] of Object.entries(args.variantMap || {})) {
    const parts = key.split(":");
    const colorId = parts.length > 1 ? parts[1] : parts[0];
    if (!colorId || colorId === "default") continue;
    const pid = Number(entry?.printifyVariantId);
    if (Number.isFinite(pid) && inStock.has(pid)) out.add(colorId);
  }
  return Array.from(out);
}
