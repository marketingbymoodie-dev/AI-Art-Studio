/**
 * Stable catalog identity for style presets.
 * Display `name` is merchant-editable. Functional lookups must use `catalogSlug`
 * (STYLE_PRESETS.id), never the display string.
 */

import { STYLE_PRESETS } from "./schema";

export type CatalogStyle = (typeof STYLE_PRESETS)[number];

const EXTRA_NAME_ALIASES: Array<{ name: string; slug: string; category?: string }> = [
  { name: "opinionated", slug: "opinionated", category: "apparel" },
  { name: "opinionated text", slug: "opinionated", category: "apparel" },
  { name: "minimal line art", slug: "minimal-line", category: "decor" },
  { name: "minimal line art", slug: "minimal-line", category: "all" },
  { name: "minimalist", slug: "minimal-line" },
];

function norm(value: string | null | undefined): string {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .trim()
    .toLowerCase();
}

function nameAliasRows(): Array<{ name: string; slug: string; category?: string }> {
  const rows: Array<{ name: string; slug: string; category?: string }> = [];
  for (const preset of STYLE_PRESETS) {
    if (preset.id === "none") continue;
    rows.push({ name: norm(preset.name), slug: preset.id, category: preset.category });
  }
  rows.push(...EXTRA_NAME_ALIASES);
  return rows;
}

export function isCatalogSlug(slug: string | null | undefined): boolean {
  const key = norm(slug);
  return !!key && STYLE_PRESETS.some((p) => p.id === key);
}

export function inferCatalogSlug(
  name: string | null | undefined,
  category?: string | null,
): string | null {
  const n = norm(name);
  if (!n) return null;
  const cat = norm(category);
  const aliases = nameAliasRows();
  const uniqueSlug = (hits: Array<{ slug: string }>): string | null => {
    const slugs = [...new Set(hits.map((h) => h.slug))];
    return slugs.length === 1 ? slugs[0] : null;
  };
  if (cat) {
    const byCat = uniqueSlug(aliases.filter((a) => a.name === n && a.category === cat));
    if (byCat) return byCat;
  }
  return uniqueSlug(aliases.filter((a) => a.name === n));
}

export function resolveCatalogSlug(row: {
  catalogSlug?: string | null;
  name?: string | null;
  category?: string | null;
}): string | null {
  const stored = norm(row.catalogSlug);
  if (stored && isCatalogSlug(stored)) return stored;
  return inferCatalogSlug(row.name, row.category);
}

export function findCatalogPreset(row: {
  catalogSlug?: string | null;
  id?: string | number | null;
  name?: string | null;
  category?: string | null;
}): CatalogStyle | undefined {
  const slug = resolveCatalogSlug(row);
  if (slug) return STYLE_PRESETS.find((p) => p.id === slug);
  const id = String(row.id || "").trim();
  if (id) return STYLE_PRESETS.find((p) => p.id === id);
  return undefined;
}

export const LITERAL_TEXT_CATALOG_SLUGS = new Set(["opinionated"]);
export const PATTERN_MAKER_CATALOG_SLUGS = new Set(["pattern-maker", "graphics-pattern-maker"]);
export const TEXT_FRIENDLY_CATALOG_SLUGS = new Set([
  "opinionated",
  "quotes",
  "vintage-poster",
  "vintage-print",
  "one-color-print",
  "retro-sunset-stack",
  "playful-cartoon",
  "minimal-line",
]);

export function isLiteralTextCatalogSlug(slug: string | null | undefined): boolean {
  return LITERAL_TEXT_CATALOG_SLUGS.has(norm(slug));
}

export function isPatternMakerCatalogSlug(slug: string | null | undefined): boolean {
  return PATTERN_MAKER_CATALOG_SLUGS.has(norm(slug));
}

export function isTextFriendlyCatalogSlug(slug: string | null | undefined): boolean {
  return TEXT_FRIENDLY_CATALOG_SLUGS.has(norm(slug));
}

export function isGraphicsCatalogSlug(slug: string | null | undefined): boolean {
  return norm(slug).startsWith("graphics-");
}

export function catalogSlugBackfillRows(): Array<{ slug: string; name: string; category: string }> {
  return STYLE_PRESETS.filter((p) => p.id !== "none").map((p) => ({
    slug: p.id,
    name: p.name,
    category: p.category,
  }));
}
