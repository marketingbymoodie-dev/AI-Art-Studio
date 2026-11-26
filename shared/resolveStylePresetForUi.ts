/**
 * Map a saved style key (merchant id, catalog slug, or name) onto a
 * dropdown option the Art Style selector can display (option.id === selected).
 */

import { canonicalCreatorStyleName } from "./creatorMarketplace";
import { findSurvivingStyleTwin } from "./customizerPageStyles";
import { findCatalogPreset, resolveCatalogSlug } from "./styleCatalog";

export type StylePresetMatchRow = {
  id: string | number;
  name?: string;
  catalogSlug?: string | null;
  category?: string | null;
};

export function coerceStyleHint(value: unknown): string {
  if (value == null) return "";
  return String(value).trim();
}

function rowId(row: StylePresetMatchRow): string {
  return String(row.id).trim();
}

function matchOneStyleKey<T extends StylePresetMatchRow>(
  presets: T[],
  raw: unknown,
): T | undefined {
  const key = coerceStyleHint(raw);
  if (!key) return undefined;
  const lower = key.toLowerCase();
  const keyCanon = canonicalCreatorStyleName(key);
  const keySlug = resolveCatalogSlug({ catalogSlug: key, name: key });

  // 1. Exact id (string-coerced — numeric JSON vs "42")
  const byId = presets.find((p) => {
    const id = rowId(p);
    return id === key || id.toLowerCase() === lower;
  });
  if (byId) return byId;

  // 2. catalogSlug on the option
  const bySlug = presets.find(
    (p) => String(p.catalogSlug || "").trim().toLowerCase() === lower,
  );
  if (bySlug) return bySlug;

  // 3. styleName — exact and canonical (Centered Graphic vs Centered Graphic (Graphics))
  const byStyleName = presets.find((p) => {
    const name = String(p.name || "").trim();
    if (!name) return false;
    if (name.toLowerCase() === lower) return true;
    return !!(keyCanon && canonicalCreatorStyleName(name) === keyCanon);
  });
  if (byStyleName) return byStyleName;

  // 4. resolveCatalogSlug both sides (retired graphics-* → keeper)
  const byResolved = presets.find((p) => {
    const presetSlug = resolveCatalogSlug({
      catalogSlug: p.catalogSlug,
      name: p.name,
      category: p.category,
    });
    return !!(keySlug && presetSlug && keySlug === presetSlug);
  });
  if (byResolved) return byResolved;

  // 5. Catalog display name — renamed merchant row with empty catalogSlug
  //    still matches if the saved key is the catalog slug / original name.
  const catalog = findCatalogPreset({
    catalogSlug: key,
    id: key,
    name: key,
  });
  if (catalog) {
    const catName = canonicalCreatorStyleName(catalog.name);
    const byCatalogName = presets.find(
      (p) => canonicalCreatorStyleName(p.name) === catName,
    );
    if (byCatalogName) return byCatalogName;
  }

  return undefined;
}

/** Search `presets` with each saved key until one row matches. */
export function findStylePresetForFill<T extends StylePresetMatchRow>(
  presets: T[],
  ...keys: unknown[]
): T | undefined {
  for (const raw of keys) {
    const hit = matchOneStyleKey(presets, raw);
    if (hit) return hit;
  }
  return undefined;
}

export type SavedStyleHints = {
  stylePreset?: unknown;
  catalogSlug?: unknown;
  styleName?: unknown;
};

/**
 * Resolve a saved design's style onto a *displayable* dropdown row.
 * Searches selectable options first, then an unfiltered pool so a twin
 * dropped by collapseStyleNameTwins maps to the surviving counterpart.
 */
export function resolveSelectableStylePreset<T extends StylePresetMatchRow>(
  selectable: T[],
  hints: SavedStyleHints,
  opts?: { pool?: T[] },
): T | undefined {
  const keys = [hints.stylePreset, hints.catalogSlug, hints.styleName];
  const direct = findStylePresetForFill(selectable, ...keys);
  if (direct) return direct;

  const pool = opts?.pool;
  if (pool && pool.length > 0) {
    const inPool = findStylePresetForFill(pool, ...keys);
    if (inPool) {
      const survivor = findSurvivingStyleTwin(inPool, selectable);
      if (survivor) return survivor;
    }
  }

  // Job stored catalogSlug + styleName; option was renamed and has no catalogSlug.
  // If the option's current name still canonically matches the saved styleName,
  // treat the saved slug as that option's identity.
  const savedSlug = coerceStyleHint(hints.catalogSlug) || coerceStyleHint(hints.stylePreset);
  const savedName = coerceStyleHint(hints.styleName);
  const savedCanon = canonicalCreatorStyleName(savedName);
  const slugFromHints = resolveCatalogSlug({
    catalogSlug: savedSlug,
    name: savedName || savedSlug,
  });
  if (slugFromHints && savedCanon) {
    const bySavedName = selectable.find((p) => {
      const optionCanon = canonicalCreatorStyleName(p.name);
      if (optionCanon !== savedCanon) return false;
      const optionSlug = resolveCatalogSlug({
        catalogSlug: p.catalogSlug,
        name: p.name,
        category: p.category,
      });
      return !optionSlug || optionSlug === slugFromHints;
    });
    if (bySavedName) return bySavedName;
  }

  if (slugFromHints) {
    const catalog = findCatalogPreset({
      catalogSlug: slugFromHints,
      name: savedName || undefined,
    });
    if (catalog) {
      const catName = canonicalCreatorStyleName(catalog.name);
      const byCatalog = selectable.find(
        (p) => canonicalCreatorStyleName(p.name) === catName,
      );
      if (byCatalog) return byCatalog;
    }
  }

  return undefined;
}
