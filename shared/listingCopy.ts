/**
 * Per-type listing copy. The design name and description are shared.
 * Garment word, handle suffix, and style label belong to the product type.
 */

export type ListingCopy = {
  garmentWord: string;
  handleSuffix: string;
  styleLabel: string;
};

function slug(value: string): string {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/**
 * A spaced dash, or an en dash / em dash / minus even when it touches the words.
 * A hyphen glued inside a short token such as "T-Shirt" is left alone.
 */
const SEPARATOR_DASH = /\s+[\u002D\u2010\u2011\u2012\u2013\u2014\u2015\u2212\uFE58\uFE63\uFF0D]+\s*|\s*[\u2010\u2011\u2012\u2013\u2014\u2015\u2212\uFE58\uFE63\uFF0D]+\s*/g;
const GLUED_WORD_DASH = /(?<=\p{L}{2,})[\u002D\u2010\u2011](?=\p{Lu})/gu;

/**
 * The design name uses one em dash with a single space either side.
 * "Husky -Collector's Card" and "Husky–Collector's Card" both become
 * "Husky — Collector's Card". The garment word is appended afterwards.
 */
export function normaliseDesignName(designName: string): string {
  return designName
    .replace(SEPARATOR_DASH, " — ")
    .replace(GLUED_WORD_DASH, " — ")
    .replace(/\s+/g, " ")
    .trim();
}

/** A Printify blueprint title, turned into the three listing fields. */
export function suggestListingCopy(blueprintName: string): ListingCopy {
  const lower = blueprintName.toLowerCase();
  let garmentWord = "";
  if (/long[\s-]?sleeve/.test(lower)) garmentWord = "Long Sleeve Shirt";
  else if (/sweatshirt|\bcrewneck\b/.test(lower)) garmentWord = "Sweatshirt";
  else if (/hoodie/.test(lower)) garmentWord = "Hoodie";
  else if (/\btank\b/.test(lower)) garmentWord = "Tank Top";
  else if (/t-?\s?shirt|\btee\b/.test(lower)) garmentWord = "T-Shirt";

  const handleSuffix = /softstyle/.test(lower) ? "-softstyle" : "";
  let styleLabel = "";
  if (/softstyle/.test(lower)) styleLabel = "Lighter Softstyle Tee";
  else if (/garment[-\s]?dyed|comfort colors/.test(lower)) styleLabel = "Garment-Dyed Tee";
  else if (garmentWord) styleLabel = garmentWord;
  return { garmentWord, handleSuffix, styleLabel };
}

/** Empty, or a leading-hyphen slug. A numeric suffix is rejected so Shopify cannot own "-1". */
export function normaliseHandleSuffix(value: string | null | undefined): string | null {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw || raw === "-") return "";
  const body = raw.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (!body || /^\d+$/.test(body)) return null;
  return `-${body}`;
}

/**
 * First letter of each word, rest lower. A hyphen starts a new word, so
 * "t-shirt" stays "T-Shirt". Apostrophes stay inside the word.
 */
export function listingTitleCase(value: string): string {
  return value.replace(/\p{L}[\p{L}\p{N}'’]*/gu, (word) =>
    word.charAt(0).toLocaleUpperCase() + word.slice(1).toLocaleLowerCase(),
  );
}

export function listingTitle(designName: string, garmentWord: string): string {
  const name = normaliseDesignName(designName);
  const word = garmentWord.replace(/\s+/g, " ").trim();
  const composed = !word || name.toLowerCase().endsWith(` ${word.toLowerCase()}`) || name.toLowerCase() === word.toLowerCase()
    ? name
    : `${name} ${word}`.trim();
  return listingTitleCase(composed);
}

/** Title slug plus the type suffix. Never appends Shopify's "-1". */
export function listingHandle(title: string, handleSuffix: string | null | undefined): string {
  const base = slug(title) || "design";
  const suffix = normaliseHandleSuffix(handleSuffix) || "";
  return `${base}${suffix}`;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function asHtml(value: string): string {
  const text = value.trim();
  if (!text) return "";
  if (/<[a-z][\s\S]*>/i.test(text)) return text;
  return text.split(/\n{2,}/).map((part) => `<p>${escapeHtml(part).replace(/\n/g, "<br>")}</p>`).join("");
}

/**
 * The product description is the design's own backstory. The style label and
 * the blueprint marketing paragraph stay off this tab; the short spec lives
 * on the Premium Everyday Comfort accordion.
 */
export function listingBody(args: {
  styleLabel?: string | null;
  designDescription?: string | null;
  garmentDetails?: string | null;
}): string {
  void args.styleLabel;
  void args.garmentDetails;
  return asHtml(String(args.designDescription || ""));
}

/** Owned types stay open until this design has a listing on that type. A type added later is open. */
export function openPublishTypeIds(ownedTypeIds: number[], publishedTypeIds: number[]): number[] {
  const published = new Set(publishedTypeIds);
  return ownedTypeIds.filter((id) => !published.has(id));
}

export type PublishPhaseTiming = {
  printMs: number;
  mockupMs: number;
  storeMs: number;
};

/**
 * A multi-type publish builds every print file and mockup together, then
 * creates the listings one after another. Separate publishes run each type
 * in series and write the shared description once.
 */
export function comparePublishTiming(input: {
  listingWriteMs: number;
  types: PublishPhaseTiming[];
}): { togetherMs: number; separateMs: number } {
  const peaks = input.types.flatMap((row) => [row.printMs, row.mockupMs]);
  const parallelMs = Math.max(input.listingWriteMs, ...peaks, 0);
  const storeMs = input.types.reduce((sum, row) => sum + row.storeMs, 0);
  const togetherMs = parallelMs + storeMs;
  const separateMs = input.types.reduce(
    (sum, row) => sum + row.printMs + row.mockupMs + row.storeMs,
    input.listingWriteMs,
  );
  return { togetherMs, separateMs };
}
