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

export function listingTitle(designName: string, garmentWord: string): string {
  const name = designName.replace(/\s+/g, " ").trim();
  const word = garmentWord.replace(/\s+/g, " ").trim();
  if (!word) return name;
  if (name.toLowerCase().endsWith(` ${word.toLowerCase()}`) || name.toLowerCase() === word.toLowerCase()) return name;
  return `${name} ${word}`.trim();
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

/** Style label, the shared design description, then this type's garment details. */
export function listingBody(args: {
  styleLabel?: string | null;
  designDescription?: string | null;
  garmentDetails?: string | null;
}): string {
  const parts: string[] = [];
  const label = String(args.styleLabel || "").trim();
  if (label) parts.push(`<p><strong>${escapeHtml(label)}</strong></p>`);
  const design = asHtml(String(args.designDescription || ""));
  if (design) parts.push(design);
  const details = asHtml(String(args.garmentDetails || ""));
  if (details) parts.push(details);
  return parts.join("\n");
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
