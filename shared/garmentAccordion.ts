/**
 * Product-page accordion copy, stored per product type and edited in Customizer Pages.
 * Comfort is weight, fabric, fit, and feel. Durability is construction, a short
 * disclaimer, and fabric blends for colours that type actually sells.
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

const SKIP = /direct-to-film|\bdtf\b|print providers?|shirt monkey|opt ondemand/i;
const COMFORT = /fabric|cotton|polyester|\boz\b|yd²|\/yd|\bfit\b|soft|breath|shrink|blend|washed|lightweight|heavyweight|garment-dyed|garment dyed|ring-spun|unisex|\bwear\b/gi;
const DURABILITY = /stitch|seams?|label|collar|durab|oeko|ethical|trust protocol|reinforced|tear-?away|twill|tubular|certif/gi;

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

function norm(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function sentence(parts: string[]): string {
  const items = parts.map((part) => part.trim()).filter(Boolean);
  if (!items.length) return "";
  const body = items.length === 1
    ? items[0]
    : items.some((item) => /\band\b/i.test(item))
      ? items.join(", ")
      : items.length === 2
        ? `${items[0]} and ${items[1]}`
        : `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
  return `${body.charAt(0).toUpperCase()}${body.slice(1).replace(/\.$/, "")}.`;
}

export function activeColorNames(
  frameColors: Array<{ id?: string; name?: string; title?: string }>,
  selectedIds: string[],
): string[] {
  const selected = new Set(selectedIds.map(String));
  return frameColors
    .filter((color) => !selected.size || selected.has(String(color.id)))
    .map((color) => String(color.name || color.title || "").trim())
    .filter(Boolean);
}

function offers(active: string[], label: string): boolean {
  const want = norm(label).replace(/\bcolou?rs?\b/g, "").trim();
  if (!want) return false;
  return active.some((color) => {
    const name = norm(color);
    return name === want || name.includes(want) || want.includes(name);
  });
}

function offersWhite(active: string[]): boolean {
  return active.some((color) => /^white\b/i.test(color.trim()));
}

type Blend = { label: string; recipe: string };

function parseBlends(text: string): Blend[] {
  const match = text.match(/fabric blends?:\s*([\s\S]+)/i);
  if (!match) return [];
  const body = match[1].split(/[.]|\bdisclaimer\b/i)[0];
  const found: Blend[] = [];
  const fiber = "(?:ring-spun\\s+)?(?:cotton|polyester|poly)";
  const pattern = new RegExp(`([^,;]+?)\\s*-\\s*(\\d+%\\s+${fiber}(?:,\\s*\\d+%\\s+${fiber})*)`, "gi");
  let hit: RegExpExecArray | null;
  while ((hit = pattern.exec(body))) {
    found.push({
      label: hit[1].replace(/^[^A-Za-z]+/, "").trim(),
      recipe: hit[2].replace(/\s+/g, " ").replace(/\.$/, "").replace(/ring-spun\s+/gi, "").trim(),
    });
  }
  return found;
}

function labelParts(label: string): Array<{ name: string; category: boolean }> {
  return label.split(/\s+and\s+/i).map((part) => {
    const name = part.trim();
    return { name, category: /colou?rs/i.test(name) };
  }).filter((part) => part.name);
}

function recipeFor(color: string, blends: Blend[]): { recipe: string; specific: boolean; category: string } {
  let best = { recipe: "", specific: false, category: "" };
  let bestScore = 0;
  for (const blend of blends) {
    for (const part of labelParts(blend.label)) {
      const matches = part.category
        ? norm(color).includes(norm(part.name).replace(/\bcolou?rs?\b/g, "").trim())
        : offers([color], part.name);
      if (!matches) continue;
      const score = part.category ? 1 : 2 + part.name.length;
      if (score > bestScore) {
        bestScore = score;
        best = { recipe: blend.recipe, specific: !part.category, category: part.category ? part.name : "" };
      }
    }
  }
  return best;
}

function categoryPhrase(name: string): string {
  const cleaned = name.replace(/\bcolors\b/gi, "colours").replace(/\s+/g, " ").trim();
  return `${cleaned.charAt(0).toUpperCase()}${cleaned.slice(1)}`;
}

function blendLine(text: string, active: string[]): string {
  if (!active.length) return "";
  const blends = parseBlends(text);
  const groups = new Map<string, { named: string[]; categories: Map<string, string[]> }>();
  for (const color of active) {
    const hit = recipeFor(color, blends);
    if (!hit.recipe) continue;
    const group = groups.get(hit.recipe) || { named: [], categories: new Map<string, string[]>() };
    if (hit.specific) group.named.push(color);
    else if (hit.category) {
      const phrase = categoryPhrase(hit.category);
      const list = group.categories.get(phrase) || [];
      list.push(color);
      group.categories.set(phrase, list);
    }
    groups.set(hit.recipe, group);
  }
  return Array.from(groups.entries()).map(([recipe, group]) => {
    const named = [...group.named];
    for (const [phrase, colors] of group.categories) {
      if (colors.length === 1) named.push(colors[0]);
      else named.push(phrase);
    }
    if (named.length === 1) {
      const verb = /colours$/i.test(named[0]) ? "are" : "is";
      return `${named[0]} ${verb} ${recipe}.`;
    }
    if (named.length <= 3) return `${named.slice(0, -1).join(", ")} and ${named[named.length - 1]} are ${recipe}.`;
    if (named.every((color) => /heather/i.test(color))) return `Heather colours are ${recipe}.`;
    return `These colours are ${recipe}.`;
  }).join(" ");
}

function fabricLine(text: string): string {
  const oz = text.match(/(\d+(?:\.\d+)?)\s*oz/i);
  let weight = "";
  if (/medium[-\s]?heavy/i.test(text)) weight = "Medium-heavy";
  else if (/heavyweight/i.test(text)) weight = "Heavyweight";
  else if (/extra light/i.test(text)) weight = "Extra light";
  else if (/medium weight/i.test(text)) weight = "Medium weight";
  else if (/lightweight|light fabric/i.test(text)) weight = "Lightweight";
  let fiber = "";
  if (/faux suede/i.test(text)) fiber = "faux suede";
  else if (/pre-shrunk\s+100%\s+ring-spun/i.test(text)) fiber = "pre-shrunk ring-spun cotton";
  else if (/100%\s+airlume|airlume combed/i.test(text)) fiber = "combed ring-spun cotton";
  else if (/100%\s+ring-spun/i.test(text)) fiber = "ring-spun cotton";
  else if (/50%\s+cotton,?\s*(?:and\s+)?50%\s+polyester/i.test(text)) fiber = "50% cotton, 50% polyester";
  else if (/52%[\s\S]{0,40}48%\s+polyester/i.test(text)) fiber = "52% cotton, 48% polyester";
  else if (/100%\s+(?:spun\s+)?polyester/i.test(text)) fiber = "100% polyester";
  else if (/100%\s+cotton/i.test(text)) fiber = "100% cotton";
  else if (/\bcotton\b/i.test(text)) fiber = "cotton";
  const ozLabel = oz ? `${oz[1].replace(/\.0+$/, "")} oz` : "";
  const bits = [weight, ozLabel, fiber].filter(Boolean);
  if (!bits.length) return "";
  const soft = weight && ozLabel && fiber && /ultra-soft|feels blissful/i.test(text) && !/soft-washed|garment-dyed/i.test(text)
    ? " with a soft hand feel"
    : "";
  const line = `${bits.join(" ")}${soft}.`;
  return `${line.charAt(0).toUpperCase()}${line.slice(1)}`;
}

function fitLine(text: string): string {
  let fit = "";
  if (/relaxed fit/i.test(text)) fit = "Relaxed fit";
  else if (/modern classic fit/i.test(text)) fit = "Modern classic fit";
  else if (/retail fit/i.test(text)) fit = "Retail fit";
  else if (/classic fit/i.test(text)) fit = /unisex/i.test(text) ? "Classic unisex fit" : "Classic fit";
  else if (/\bfitted\b/i.test(text)) fit = "Fitted cut";
  const extra: string[] = [];
  if (/crew neck/i.test(text) && fit) extra.push("crew neck");
  if (/runs smaller/i.test(text)) extra.push("runs small");
  else if (/runs true to size/i.test(text)) extra.push("true to size");
  if (!fit && !extra.length) return "";
  if (!fit) return sentence(extra);
  if (!extra.length) return `${fit}.`;
  return `${fit}, ${extra.join(", ")}.`;
}

function feelLine(text: string): string {
  if (/soft-washed/i.test(text) && /garment-dyed/i.test(text)) return "Soft-washed and garment-dyed.";
  if (/soft-washed/i.test(text)) return "Soft-washed.";
  if (/garment-dyed/i.test(text)) return "Garment-dyed for a worn-in feel.";
  if (/reduced pilling|softer fleece|soft cotton-poly/i.test(text)) return "Soft fleece that pills less.";
  if (/ultra-soft|feels blissful/i.test(text)) return "Soft hand feel.";
  return "";
}

function constructionLine(text: string): string {
  const bits: string[] = [];
  if (/twill tape/i.test(text)) bits.push("twill-taped shoulders");
  if (/double-needle/i.test(text)) bits.push("double-needle stitching");
  if (/no side seams|lack of side seams|without side seams/i.test(text)) bits.push("no side seams");
  else if (/side[-\s]?seamed?/i.test(text)) bits.push("side-seamed body");
  if (/ribbed cuffs/i.test(text)) bits.push("ribbed cuffs and hem");
  else if (/ribbed(?:-knit)? collar/i.test(text)) bits.push("ribbed collar");
  if (/tear[\s-]?away label/i.test(text)) bits.push("tear-away label");
  else if (/sewn-in label/i.test(text)) bits.push("sewn-in label");
  return sentence(bits.slice(0, 4));
}

function disclaimerLine(text: string, active: string[]): string {
  if (!/off-white/i.test(text)) return "";
  if (!offersWhite(active)) return "";
  return "White may look slightly off-white.";
}

function certLine(text: string): string {
  const bits: string[] = [];
  if (/oeko-tex/i.test(text)) bits.push("OEKO-TEX certified");
  if (/ethically grown|us cotton trust/i.test(text)) bits.push("ethically grown US cotton");
  return sentence(bits);
}

function mentionsInactiveColor(line: string, active: string[]): boolean {
  if (!active.length) return false;
  const variant = line.match(/the ([A-Za-z][\w\s/]+?) colou?r variant/i);
  if (variant && !offers(active, variant[1])) return true;
  for (const name of ["graphite heather", "antique"]) {
    if (line.toLowerCase().includes(name) && !offers(active, name)) return true;
  }
  return false;
}

function fallback(html: string, active: string[]): GarmentAccordionCopy {
  const comfort: string[] = [];
  const durability: string[] = [];
  for (const line of pieces(html)) {
    if (/available in \d+ colou?rs/i.test(line)) continue;
    if (/discount has been applied/i.test(line)) continue;
    if (/fiber content may vary/i.test(line)) continue;
    if (/fabric blends?:/i.test(line)) continue;
    if (mentionsInactiveColor(line, active)) continue;
    const short = line.length <= 140 ? line : `${line.slice(0, 137).replace(/\s+\S*$/, "")}.`;
    const finished = /[.!]$/.test(short) ? short : `${short}.`;
    if (count(finished, DURABILITY) > count(finished, COMFORT)) durability.push(finished);
    else comfort.push(finished);
    if (comfort.length + durability.length >= 5) break;
  }
  return { comfort, durability };
}

/** 3–5 short lines. Colour counts and colours this type does not sell are left out. */
export function cleanGarmentAccordion(html: string | null | undefined, activeColors: string[] = []): GarmentAccordionCopy {
  const text = pieces(String(html || "")).join(" ");
  if (!text) return { comfort: [], durability: [] };
  const ranked: Array<{ side: "comfort" | "durability"; line: string }> = [
    { side: "comfort", line: fabricLine(text) },
    { side: "comfort", line: fitLine(text) },
    { side: "durability", line: constructionLine(text) },
    { side: "durability", line: disclaimerLine(text, activeColors) },
    { side: "durability", line: blendLine(text, activeColors) },
    { side: "comfort", line: feelLine(text) },
    { side: "durability", line: certLine(text) },
  ].filter((item) => item.line);
  const chosen = ranked.slice(0, 5);
  if (!chosen.length) return fallback(html, activeColors);
  return {
    comfort: chosen.filter((item) => item.side === "comfort").map((item) => item.line),
    durability: chosen.filter((item) => item.side === "durability").map((item) => item.line),
  };
}

export function accordionLines(value: string | null | undefined): string[] {
  return String(value || "").split(/\n+/).map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean);
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

export function garmentAccordionMetafields(
  source: string | GarmentAccordionCopy | null | undefined,
  activeColors: string[] = [],
): ProductMetafieldInput[] {
  const copy = source && typeof source === "object"
    ? source
    : cleanGarmentAccordion(source, activeColors);
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
