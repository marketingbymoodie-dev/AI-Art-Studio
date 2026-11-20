/**
 * The product-page accordions read two rich text metafields.
 * Both are derived from the product type's garment details (its description).
 * Fabric, weight, and fit go to comfort. Construction, labels, and
 * certifications go to durability.
 */

export const GARMENT_ACCORDION_NAMESPACE = "ai_art_studio";
export const GARMENT_COMFORT_KEY = "garment_comfort";
export const GARMENT_DURABILITY_KEY = "garment_durability";

export type GarmentAccordionCopy = {
  comfort: string[];
  durability: string[];
};

export type ProductMetafieldInput = {
  namespace: string;
  key: string;
  type: "rich_text_field";
  value: string;
};

const COMFORT = /fabric|cotton|polyester|\boz\b|yd²|\/yd|\bfit\b|soft|breath|shrink|colou?rs?\b|blend|washed|lightweight|heavyweight|garment-dyed|garment dyed|ring-spun|unisex|\bwear\b/gi;
const DURABILITY = /stitch|seams?|label|collar|durab|oeko|ethical|trust protocol|reinforced|tear-?away|twill|tubular|certif/gi;
const SKIP = /direct-to-film|\bdtf\b|print providers?|shirt monkey|opt ondemand/i;

function decode(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, digits) => String.fromCharCode(Number(digits)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function visibleText(html: string): string {
  return decode(html.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!])\s+(?=[A-Z“"])/)
    .map((part) => part.replace(/^\.:+\s*/, "").trim())
    .filter((part) => part.length > 1 && !/^disclaimer:?$/i.test(part) && !SKIP.test(part));
}

function pieces(html: string): string[] {
  const blocks = Array.from(html.matchAll(/<(p|div|li)\b[^>]*>([\s\S]*?)<\/\1>/gi));
  const chunks = blocks.length ? blocks.map((match) => match[2]) : [html];
  return chunks.flatMap((chunk) => chunk.split(/<br\s*\/?>/i)).flatMap((chunk) => sentences(visibleText(chunk)));
}

function count(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length || 0;
}

export function garmentAccordionCopy(html: string | null | undefined): GarmentAccordionCopy {
  const comfort: string[] = [];
  const durability: string[] = [];
  for (const line of pieces(String(html || ""))) {
    if (count(line, DURABILITY) > count(line, COMFORT)) durability.push(line);
    else comfort.push(line);
  }
  return { comfort, durability };
}

/** Shopify rich_text_field value. One paragraph per line. */
export function shopifyRichText(paragraphs: string[]): string {
  return JSON.stringify({
    type: "root",
    children: paragraphs.filter(Boolean).map((value) => ({
      type: "paragraph",
      children: [{ type: "text", value }],
    })),
  });
}

export function garmentAccordionMetafields(html: string | null | undefined): ProductMetafieldInput[] {
  const copy = garmentAccordionCopy(html);
  const fields: ProductMetafieldInput[] = [];
  if (copy.comfort.length) {
    fields.push({
      namespace: GARMENT_ACCORDION_NAMESPACE,
      key: GARMENT_COMFORT_KEY,
      type: "rich_text_field",
      value: shopifyRichText(copy.comfort),
    });
  }
  if (copy.durability.length) {
    fields.push({
      namespace: GARMENT_ACCORDION_NAMESPACE,
      key: GARMENT_DURABILITY_KEY,
      type: "rich_text_field",
      value: shopifyRichText(copy.durability),
    });
  }
  return fields;
}
