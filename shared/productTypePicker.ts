/** Minimal fields needed to dedupe product-type picker rows. */
export type ProductTypePickerRow = {
  id: number;
  name: string;
  sortOrder?: number | null;
  printifyBlueprintId?: number | null;
  printifyProviderId?: number | null;
};

/**
 * Collapse duplicate catalog rows in admin pickers (e.g. Generator Tester).
 * Legacy imports may have the same Printify blueprint twice; cross-tenant leaks
 * from the old public /api/product-types list showed other merchants' copies too.
 * Keeps the highest id (most recent) per blueprint+provider key.
 */
export function dedupeProductTypesForPicker<T extends ProductTypePickerRow>(types: T[]): T[] {
  const byKey = new Map<string, T>();
  for (const pt of types) {
    const key =
      pt.printifyBlueprintId != null
        ? `bp:${pt.printifyBlueprintId}:prov:${pt.printifyProviderId ?? 0}`
        : `id:${pt.id}`;
    const prev = byKey.get(key);
    if (!prev || pt.id > prev.id) byKey.set(key, pt);
  }
  return [...byKey.values()].sort(
    (a, b) =>
      (a.sortOrder ?? 0) - (b.sortOrder ?? 0) ||
      String(a.name || "").localeCompare(String(b.name || "")) ||
      a.id - b.id,
  );
}

/** Fields needed to collapse Create Page product dropdown rows. */
export type CreatePageBlankRow = {
  productTypeId: number;
  productId?: string | null;
  title: string;
  printifyBlueprintId?: number | null;
  needsShopifySync?: boolean;
};

/**
 * Identity for Create Page options. Never key by Shopify product id — a synced
 * copy and an unsynced copy of the same blueprint used to show up as
 * "Comforter" + "Comforter (will be created)".
 */
export function createPageBlankDedupeKey(blank: CreatePageBlankRow): string {
  if (blank.printifyBlueprintId != null) return `bp:${blank.printifyBlueprintId}`;
  const title = blank.title.trim().toLowerCase();
  return title ? `title:${title}` : `pt:${blank.productTypeId}`;
}

export function preferCreatePageBlank<T extends CreatePageBlankRow>(
  a: T,
  b: T,
  liveProductTypeIds: Set<number>,
): T {
  const aLive = liveProductTypeIds.has(a.productTypeId);
  const bLive = liveProductTypeIds.has(b.productTypeId);
  if (aLive !== bLive) return aLive ? a : b;
  const aOnStore = !a.needsShopifySync && !!a.productId;
  const bOnStore = !b.needsShopifySync && !!b.productId;
  if (aOnStore !== bOnStore) return aOnStore ? a : b;
  return a.productTypeId >= b.productTypeId ? a : b;
}

/** One dropdown row per Printify blueprint (or title if no blueprint). */
export function dedupeCreatePageBlanks<T extends CreatePageBlankRow>(
  blanks: T[],
  liveProductTypeIds: Set<number>,
): T[] {
  const byKey = new Map<string, T>();
  for (const blank of blanks) {
    const key = createPageBlankDedupeKey(blank);
    const prev = byKey.get(key);
    byKey.set(key, prev ? preferCreatePageBlank(prev, blank, liveProductTypeIds) : blank);
  }
  return [...byKey.values()].sort((a, b) => {
    const aLive = liveProductTypeIds.has(a.productTypeId) ? 0 : 1;
    const bLive = liveProductTypeIds.has(b.productTypeId) ? 0 : 1;
    if (aLive !== bLive) return aLive - bLive;
    return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
  });
}
