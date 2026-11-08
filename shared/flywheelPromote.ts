/**
 * Decisions for promoting an approved catalogue design.
 * Nothing here creates a Shopify or Printify product.
 *
 * The product is a published catalogue item. It does not use the unlisted
 * visibility of a customizer base product, and it does not use the hidden
 * visibility of a shadow SKU.
 */
import { printifyColorIdForMockup } from "./mockupBundle";
import { resolveVariantFromMap, type VariantMap } from "./variantMapResolve";

export const PRINTIFY_FULL_BLEED = { x: 0.5, y: 0.5, scale: 1 } as const;

export type CapOccupant = { title: string; promotedAt: string };

export type StoredMockup = { name: string; hex: string; path: string };

/** Publish immediately, or hold a draft. The Studio page is already the approval. */
export function catalogueVisibility(publishNow: boolean): "active" | "draft" {
  return publishNow ? "active" : "draft";
}

export function catalogueTags(row: {
  artStyle: string;
  species: string;
  humourOperator: string;
}): string[] {
  return [row.artStyle, row.species, row.humourOperator].map((value) => value.trim());
}

export function mockupFileName(handle: string, colour: string): string {
  const slug = (value: string) => value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${slug(handle)}-${slug(colour)}-front.jpg`;
}

export function mockupAlt(title: string, colour: string): string {
  return `${title.trim()} on ${colour.trim()}`;
}

export type VariantMediaUpdate = { id: string; mediaId: string };

/**
 * One mockup image per colour, applied to every size of that colour.
 * Matches the alt text and filename promote stores, so "light grey" cannot
 * take the file that belongs to "grey".
 */
export function variantMediaAssignments(input: {
  title: string;
  handle: string;
  variants: Array<{ id: string; colour: string }>;
  media: Array<{ id: string; alt: string; filename: string }>;
}): { updates: VariantMediaUpdate[]; missing: string[] } {
  const colours = [...new Set(input.variants.map((variant) => variant.colour.trim()).filter(Boolean))];
  const mediaForColour = new Map<string, string>();
  for (const colour of colours) {
    const expectedAlt = mockupAlt(input.title, colour).toLowerCase();
    const stem = mockupFileName(input.handle, colour).replace(/\.jpg$/i, "").toLowerCase();
    const hit = input.media.find((item) => {
      const alt = item.alt.trim().toLowerCase();
      const filename = item.filename.trim().toLowerCase();
      return alt === expectedAlt || filename.startsWith(stem);
    });
    if (hit) mediaForColour.set(colour.toLowerCase(), hit.id);
  }
  const updates: VariantMediaUpdate[] = [];
  for (const variant of input.variants) {
    const mediaId = mediaForColour.get(variant.colour.trim().toLowerCase());
    if (mediaId) updates.push({ id: variant.id, mediaId });
  }
  const missing = colours.filter((colour) => !mediaForColour.has(colour.toLowerCase()));
  return { updates, missing };
}

/** Refuse, name the cap, and list who is holding the slots. */
export function capRefusal(limit: number, occupants: CapOccupant[]): string | null {
  if (occupants.length < limit) return null;
  const holding = occupants.map((row) => `${row.title} (${row.promotedAt})`).join("; ");
  return `Active design-product cap is ${limit}. Holding the slots: ${holding}`;
}

export function promoteRefusals(input: {
  printFilePath: string | null;
  panelId: string | null;
  productTypeName: string;
  tickedColours: string[];
  panelColours: string[];
  storedMockupColours: string[];
  title: string | null;
  description: string | null;
  artStyle: string | null;
  species: string | null;
  humourOperator: string | null;
  shippingRefusal: string | null;
  /** Set when the shop token cannot link colour swatches. Checked before any create. */
  metaobjectRefusal: string | null;
  publishNow: boolean;
  capMessage: string | null;
  missingPrices: string[];
  /**
   * The combined publish button builds the print file, listing, and mockups
   * after this check. Those gaps are not refusals yet.
   */
  deferApprovalArtifacts?: boolean;
}): string[] {
  const missing: string[] = [];
  const defer = input.deferApprovalArtifacts === true;
  if (!defer && !input.printFilePath) missing.push("No print file for this candidate.");
  if (!input.panelId) missing.push("No mockup panel is chosen for this candidate.");
  for (const colour of input.tickedColours) {
    if (!input.panelColours.includes(colour)) {
      missing.push(`No mockup panel for ${colour} on ${input.productTypeName}.`);
    }
    if (!defer && !input.storedMockupColours.includes(colour)) {
      missing.push(`No stored mockup for ${colour}. Approve stores the images; promote does not render them again.`);
    }
  }
  if (!input.tickedColours.length) missing.push("No colours are ticked.");
  if (!defer && !String(input.title || "").trim()) missing.push("Title is not stored on the candidate.");
  if (!defer && !String(input.description || "").trim()) missing.push("Description is not stored on the candidate.");
  const taxonomy = [
    ["style", input.artStyle],
    ["species", input.species],
    ["humour operator", input.humourOperator],
  ].filter(([, value]) => !String(value || "").trim()).map(([name]) => name);
  if (taxonomy.length) {
    missing.push(`The candidate is missing ${taxonomy.join(", ")}. Promote does not invent tags.`);
  }
  if (input.shippingRefusal) missing.push(input.shippingRefusal);
  if (input.metaobjectRefusal) missing.push(input.metaobjectRefusal);
  if (input.missingPrices.length) {
    missing.push(`No front price for ${input.missingPrices.join(", ")}.`);
  }
  if (input.publishNow && input.capMessage) missing.push(input.capMessage);
  return missing;
}

export const METAOBJECT_SCOPE_REFUSAL =
  "This shop's Shopify token has no metaobject scope, so colour swatches cannot be linked. Reinstall the app before promoting.";

/** Display names on the Softstyle ticks, and the Printify titles those hexes map to. */
const SWATCH_BASE_COLOR: Record<string, string> = {
  white: "White",
  black: "Black",
  blue: "Blue",
  sapphire: "Blue",
  pink: "Pink",
  azalea: "Pink",
  red: "Red",
  "cherry red": "Red",
  sage: "Green",
  green: "Green",
  "light grey": "Gray",
  "light gray": "Gray",
  "dark grey": "Gray",
  "dark gray": "Gray",
  "sport grey": "Gray",
  "sport gray": "Gray",
  charcoal: "Gray",
  grey: "Gray",
  gray: "Gray",
};

/** Shopify's Base color name for a garment colour. Null when we have no mapping. */
export function swatchBaseColorName(colourName: string): string | null {
  return SWATCH_BASE_COLOR[colourName.trim().toLowerCase()] ?? null;
}

/** Fields shopify--color-pattern requires. Base color is a taxonomy id list, not the hex. */
export function colorPatternMetaobjectFields(args: {
  label: string;
  hex: string;
  baseColorId: string;
  solidPatternId: string;
}): Array<{ key: string; value: string }> {
  return [
    { key: "label", value: args.label },
    { key: "color", value: `#${args.hex.replace(/^#/, "")}` },
    { key: "color_taxonomy_reference", value: JSON.stringify([args.baseColorId]) },
    { key: "pattern_taxonomy_reference", value: args.solidPatternId },
  ];
}

/** Sizes this colour can actually print. Names stay in the offered order. */
export function printableSizeNames(
  variantMap: VariantMap | null | undefined,
  color: { name: string; hex: string },
  offered: Array<{ id: string; name: string }>,
): string[] {
  const colorId = printifyColorIdForMockup(color.hex)?.colorId || "";
  if (!colorId) return [];
  return offered
    .filter((size) => resolveVariantFromMap(variantMap, size.id, colorId, { allowSizeFallbackForColor: false })?.entry.printifyVariantId)
    .map((size) => size.name);
}

/** Storefront and Studio colour order. Missing names are skipped, not filled in. */
export const CATALOGUE_COLOUR_ORDER = [
  "White",
  "Black",
  "Sage",
  "Dark grey",
  "Red",
  "Light grey",
  "Blue",
  "Pink",
] as const;

export function catalogueColourRank(name: string): number {
  const index = CATALOGUE_COLOUR_ORDER.findIndex((colour) => colour.toLowerCase() === name.trim().toLowerCase());
  return index === -1 ? CATALOGUE_COLOUR_ORDER.length : index;
}

/** Stable sort. Unknown colours stay after the eight, in their original order. */
export function sortCatalogueColours<T extends { name: string }>(colours: readonly T[]): T[] {
  return colours
    .map((colour, index) => ({ colour, index }))
    .sort((a, b) => catalogueColourRank(a.colour.name) - catalogueColourRank(b.colour.name) || a.index - b.index)
    .map((row) => row.colour);
}

/**
 * An empty stored list has not been chosen yet, so every available colour starts ticked.
 * A stored subset stays ticked, in catalogue order. Legibility is not an input.
 */
export function initialTickedColours<T extends { name: string; hex: string }>(
  stored: readonly T[],
  available: readonly T[],
): T[] {
  const ordered = sortCatalogueColours(available);
  if (!stored.length) return ordered.map((colour) => ({ ...colour }));
  const wanted = new Set(stored.map((colour) => colour.name.toLowerCase()));
  return ordered.filter((colour) => wanted.has(colour.name.toLowerCase()));
}

/**
 * Index of size M in the first catalogue colour that this product actually sells.
 * -1 when that colour has no M. Display order of the size option is separate.
 */
export function indexOfDefaultMedium<T extends { size: string; colour: string }>(
  variants: readonly T[],
  colourOrder: readonly string[],
): number {
  const present = new Set(variants.map((row) => row.colour.trim().toLowerCase()));
  const named = colourOrder.find((name) => present.has(name.trim().toLowerCase()));
  const defaultColour = (named || variants[0]?.colour || "").trim().toLowerCase();
  if (!defaultColour) return -1;
  return variants.findIndex((row) =>
    row.size.trim().toUpperCase() === "M" && row.colour.trim().toLowerCase() === defaultColour,
  );
}

/** Shopify variant positions: catalogue colour, then XS–3XL. M stays in that run. */
export function catalogueVariantPositions(
  variants: Array<{ id: string; colour: string; size: string }>,
): Array<{ id: string; position: number }> {
  const colourOrder: string[] = [];
  for (const variant of sortCatalogueColours(variants.map((row) => ({ name: row.colour })))) {
    if (!variant.name) continue;
    if (colourOrder.some((name) => name.toLowerCase() === variant.name.toLowerCase())) continue;
    colourOrder.push(variant.name);
  }
  const sorted = [...variants].sort((a, b) => compareColourThenSize(
    { colour: a.colour, size: a.size },
    { colour: b.colour, size: b.size },
    colourOrder,
  ));
  return sorted.map((variant, index) => ({ id: variant.id, position: index + 1 }));
}

export const APPAREL_SIZE_ORDER = ["XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL"] as const;

/** Unknown labels sort after the canonical run, and keep their own relative order. */
export function apparelSizeRank(name: string): number {
  const index = APPAREL_SIZE_ORDER.indexOf(name.trim().toUpperCase() as typeof APPAREL_SIZE_ORDER[number]);
  return index === -1 ? APPAREL_SIZE_ORDER.length : index;
}

/** Unique size labels in canonical order. */
export function sortApparelSizeNames(names: string[]): string[] {
  return [...new Set(names)].sort((a, b) => apparelSizeRank(a) - apparelSizeRank(b) || a.localeCompare(b));
}

/** Colour position first, then canonical size. */
export function compareColourThenSize(
  a: { colour: string; size: string },
  b: { colour: string; size: string },
  colourOrder: readonly string[],
): number {
  const colourRank = (name: string) => {
    const index = colourOrder.findIndex((colour) => colour.toLowerCase() === name.toLowerCase());
    return index === -1 ? colourOrder.length : index;
  };
  const byColour = colourRank(a.colour) - colourRank(b.colour);
  if (byColour) return byColour;
  const bySize = apparelSizeRank(a.size) - apparelSizeRank(b.size);
  if (bySize) return bySize;
  return a.size.localeCompare(b.size);
}

/** "XS–3XL" when the printable sizes are a contiguous run. Apparel sizes use size order, so XS last in the offered list still reads XS–3XL. */
export function formatSizeRange(offeredNames: string[], printableNames: string[]): string {
  if (!printableNames.length) return "no sizes";
  const ranks = printableNames.map((name) => apparelSizeRank(name));
  if (ranks.every((rank) => rank < APPAREL_SIZE_ORDER.length)) {
    const ordered = printableNames
      .map((name, i) => ({ name, rank: ranks[i] }))
      .sort((a, b) => a.rank - b.rank);
    if (ordered.length === 1) return ordered[0].name;
    const contiguous = ordered.every((row, i) => i === 0 || row.rank === ordered[i - 1].rank + 1);
    if (contiguous) return `${ordered[0].name}–${ordered[ordered.length - 1].name}`;
    return ordered.map((row) => row.name).join(", ");
  }
  const index = new Map(offeredNames.map((name, i) => [name, i]));
  const at = printableNames.map((name) => index.get(name)).filter((n): n is number => n != null).sort((a, b) => a - b);
  if (at.length !== printableNames.length) return printableNames.join(", ");
  const contiguous = at.every((n, i) => i === 0 || n === at[i - 1] + 1);
  if (contiguous && at.length > 1) return `${offeredNames[at[0]]}–${offeredNames[at[at.length - 1]]}`;
  return printableNames.join(", ");
}
