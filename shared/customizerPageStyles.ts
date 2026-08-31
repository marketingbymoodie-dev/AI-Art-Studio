/**
 * Per–customizer-page art style selection.
 * Merchants attach explicit presets or allow all styles in a category.
 */

import { canonicalCreatorStyleName } from "./creatorMarketplace";
import {
  type CustomizerPageStyleCategory,
  type StylePresetCategory,
  CUSTOMIZER_PAGE_CATEGORY_OPTIONS,
  isValidStylePresetCategory,
  selectableCategoriesForDesignerType,
  styleMatchesSelectableCategories,
} from "./styleCategories";

export type { CustomizerPageStyleCategory, StylePresetCategory } from "./styleCategories";
export {
  CUSTOMIZER_PAGE_CATEGORY_OPTIONS,
  CUSTOMIZER_PAGE_CATEGORY_LABELS,
  STYLE_PRESET_CATEGORY_LABELS,
  selectableCategoriesForDesignerType,
  styleMatchesSelectableCategories,
} from "./styleCategories";

export type CustomizerPageStyleConfig =
  | { mode: "category"; category: CustomizerPageStyleCategory }
  | { mode: "selected"; presetIds: string[] };

export function parseCustomizerPageStyleConfig(
  raw: unknown,
): CustomizerPageStyleConfig | null {
  if (!raw) return null;
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== "object") return null;
  const o = parsed as Record<string, unknown>;
  if (o.mode === "category" && typeof o.category === "string") {
    if (isValidStylePresetCategory(o.category)) {
      return { mode: "category", category: o.category };
    }
  }
  if (o.mode === "selected" && Array.isArray(o.presetIds)) {
    const ids = o.presetIds.map(String).filter(Boolean);
    if (ids.length > 0) return { mode: "selected", presetIds: [...new Set(ids)] };
  }
  return null;
}

/**
 * Remap retired Graphics twin ids and the Graphics category bundle.
 * Returns the original value when nothing changes.
 */
export function remapCustomizerStyleConfigAfterGraphicsRetire(
  raw: unknown,
  idMap: Map<string, string>,
): { config: CustomizerPageStyleConfig | unknown; changed: boolean } {
  const parsed = parseCustomizerPageStyleConfig(raw);
  if (!parsed) return { config: raw, changed: false };
  if (parsed.mode === "category") {
    if (parsed.category === "graphics") {
      return { config: { mode: "category", category: "all" }, changed: true };
    }
    return { config: raw, changed: false };
  }
  const nextIds = parsed.presetIds.map((id) => idMap.get(String(id)) ?? String(id));
  const deduped = [...new Set(nextIds)];
  const changed =
    deduped.length !== parsed.presetIds.length ||
    deduped.some((id, i) => id !== String(parsed.presetIds[i]));
  if (!changed) return { config: raw, changed: false };
  return { config: { mode: "selected", presetIds: deduped }, changed: true };
}

export function validateCustomizerPageStyleConfig(
  config: CustomizerPageStyleConfig | null | undefined,
): string | null {
  if (!config) {
    return "Choose one or more art styles, or select all styles in a category (Decor, Apparel, Graphics, or All).";
  }
  if (config.mode === "selected" && config.presetIds.length === 0) {
    return "Select at least one art style.";
  }
  return null;
}

export function defaultStyleConfigForDesignerType(
  designerType?: string | null,
): CustomizerPageStyleConfig {
  const dt = (designerType || "").toLowerCase();
  if (dt === "apparel" || dt === "all-over-print") {
    return { mode: "category", category: "apparel" };
  }
  if (dt === "pillow" || dt === "framed-print" || dt === "mug") {
    return { mode: "category", category: "decor" };
  }
  return { mode: "category", category: "all" };
}

export function suggestedStyleCategoryForDesignerType(
  designerType?: string | null,
): CustomizerPageStyleCategory {
  const def = defaultStyleConfigForDesignerType(designerType);
  return def.mode === "category" ? def.category : "all";
}

export function dedupeStylePresets<
  T extends { id: string; name?: string; catalogSlug?: string | null },
>(presets: T[]): T[] {
  const seenIds = new Set<string>();
  const seenSlugs = new Set<string>();
  return presets.filter((p) => {
    const idKey = String(p.id);
    const slugKey = String(p.catalogSlug || "")
      .trim()
      .toLowerCase();
    if (seenIds.has(idKey)) return false;
    if (slugKey && seenSlugs.has(slugKey)) return false;
    seenIds.add(idKey);
    if (slugKey) seenSlugs.add(slugKey);
    return true;
  });
}

/** Apparel DTG vs Graphics chroma twins share a customer-facing name. */
function isGraphicsStyleTwin<T extends { name?: string; category?: string | null; catalogSlug?: string | null }>(
  style: T,
): boolean {
  const slug = String((style as any).catalogSlug || "").trim().toLowerCase();
  if (slug.startsWith("graphics-")) return true;
  return style.category === "graphics";
}

/**
 * Phone cases / decor / generic flats should use the Graphics twin.
 * Apparel / AOP keep the DTG (non-Graphics) twin.
 */
export function preferGraphicsStyleTwin(
  designerType?: string | null,
  pageCategory?: string | null,
): boolean {
  if (pageCategory === "apparel") return false;
  if (pageCategory === "graphics") return true;
  const dt = (designerType || "").toLowerCase();
  return dt !== "apparel" && dt !== "all-over-print";
}

/**
 * Collapse apparel DTG + Graphics chroma twins that share a customer-facing
 * name ("Centered Graphic" / "Centered Graphic (Graphics)").
 * Do not collapse rows that only share a display name across categories
 * (Pet Portraits apparel vs decor).
 */
function apparelGraphicsTwinKey<
  T extends { id: string; name?: string; category?: string | null; catalogSlug?: string | null },
>(style: T): string | null {
  const name = canonicalCreatorStyleName(style.name || style.id);
  if (!name) return null;
  if (isGraphicsStyleTwin(style)) return name;
  if ((style.category || "").toLowerCase() === "apparel") return name;
  return null;
}

/** Map a twin that collapse dropped onto the row still shown in the dropdown. */
export function findSurvivingStyleTwin<
  T extends { id: string | number; name?: string; category?: string | null; catalogSlug?: string | null },
>(dropped: T, survivors: T[]): T | undefined {
  const droppedId = String(dropped.id);
  const exact = survivors.find((s) => String(s.id) === droppedId);
  if (exact) return exact;
  const droppedTwin = apparelGraphicsTwinKey({
    ...dropped,
    id: droppedId,
  } as T & { id: string });
  if (droppedTwin) {
    const hit = survivors.find(
      (s) =>
        apparelGraphicsTwinKey({
          ...s,
          id: String(s.id),
        } as T & { id: string }) === droppedTwin,
    );
    if (hit) return hit;
  }
  const droppedName = canonicalCreatorStyleName(dropped.name || "");
  if (droppedName) {
    const hit = survivors.find(
      (s) => canonicalCreatorStyleName(s.name || "") === droppedName,
    );
    if (hit) return hit;
  }
  return undefined;
}

export function collapseStyleNameTwins<
  T extends { id: string; name?: string; category?: string | null; catalogSlug?: string | null },
>(presets: T[], designerType?: string | null, pageCategory?: string | null): T[] {
  const preferGraphics = preferGraphicsStyleTwin(designerType, pageCategory);
  const rank = (p: T) => (isGraphicsStyleTwin(p) ? 0 : 1);
  const best = new Map<string, T>();
  const order: string[] = [];
  for (const p of presets) {
    const twinKey = apparelGraphicsTwinKey(p);
    const key = twinKey ? `ag:${twinKey}` : `id:${String(p.id)}`;
    const prev = best.get(key);
    if (!prev) {
      best.set(key, p);
      order.push(key);
      continue;
    }
    const takeNew = preferGraphics ? rank(p) < rank(prev) : rank(p) > rank(prev);
    if (takeNew) best.set(key, p);
  }
  return order.map((key) => best.get(key)!);
}

/**
 * Styles shown in admin "choose specific styles" multi-select.
 * Merchants may pick any preset (Decor / Apparel / Graphics) regardless of
 * product designer type — e.g. leggings AOP can use Graphics or Decor motifs.
 * Category *bundles* ("All Apparel styles") still use designer-type defaults.
 */
export function stylesForCustomizerPagePicker<T extends { category?: string | null }>(
  presets: T[],
  _designerType?: string | null,
): T[] {
  void _designerType;
  return presets;
}

export function filterStylePresetsForPage<
  T extends { id: string; name?: string; category?: string | null },
>(
  presets: T[],
  config: CustomizerPageStyleConfig | null | undefined,
  designerType?: string | null,
): T[] {
  const deduped = dedupeStylePresets(presets);
  const cfg = config ?? defaultStyleConfigForDesignerType(designerType);
  let filtered = deduped;
  if (cfg.mode === "selected") {
    const idSet = new Set(cfg.presetIds.map(String));
    filtered = deduped.filter((p) => idSet.has(String(p.id)));
  } else if (cfg.category !== "all") {
    filtered = deduped.filter(
      (p) => p.category === cfg.category || p.category === "all" || !p.category,
    );
  }
  return collapseStyleNameTwins(
    filtered,
    designerType,
    cfg.mode === "category" ? cfg.category : undefined,
  );
}

/** Strip decor full-bleed language when generating isolated AOP motifs. */
export function sanitizeStylePrefixForAop(prefix: string): string {
  let cleaned = prefix.trim();
  cleaned = cleaned.replace(/\bfull-bleed\b/gi, "centered");
  cleaned = cleaned.replace(/\bfills?\s+the\s+entire\s+canvas\b/gi, "centers the subject on");
  cleaned = cleaned.replace(/\b(reaching|extending)\s+to\s+all\s+edges\b/gi, "with clear space around the subject");
  cleaned = cleaned.replace(/\bedge-to-edge\b/gi, "centered");
  cleaned = cleaned.replace(/\s{2,}/g, " ").trim();
  if (cleaned && !/isolated|centered|motif/i.test(cleaned)) {
    cleaned = `${cleaned}, isolated centered motif`;
  }
  return cleaned;
}

/** Category bundle buttons for the admin page wizard (excludes the recommended default). */
export function customizerPageCategoryOptions(
  suggested: CustomizerPageStyleCategory,
): CustomizerPageStyleCategory[] {
  return CUSTOMIZER_PAGE_CATEGORY_OPTIONS.filter((c) => c !== suggested);
}

function firstImageUrl(urls: unknown): string | null {
  if (!Array.isArray(urls)) return null;
  for (const u of urls) {
    if (typeof u === "string" && u.trim()) return u.trim();
  }
  return null;
}

/** First pictorial example for the storefront style eye preview. */
export function styleExampleImageUrl(style: {
  baseImageUrl?: string | null;
  baseImageUrls?: string[] | null;
  options?: {
    choices?: Array<{
      baseImageUrl?: string | null;
      baseImageUrls?: string[] | null;
    }>;
  } | null;
}): string | null {
  const fromList = firstImageUrl(style.baseImageUrls);
  if (fromList) return fromList;
  if (typeof style.baseImageUrl === "string" && style.baseImageUrl.trim()) {
    return style.baseImageUrl.trim();
  }
  for (const choice of style.options?.choices || []) {
    const fromChoice = firstImageUrl(choice.baseImageUrls);
    if (fromChoice) return fromChoice;
    if (typeof choice.baseImageUrl === "string" && choice.baseImageUrl.trim()) {
      return choice.baseImageUrl.trim();
    }
  }
  return null;
}
