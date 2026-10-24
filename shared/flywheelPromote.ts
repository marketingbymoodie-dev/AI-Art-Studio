/**
 * Decisions for promoting an approved catalogue design.
 * Nothing here creates a Shopify or Printify product.
 *
 * The product is a published catalogue item. It does not use the unlisted
 * visibility of a customizer base product, and it does not use the hidden
 * visibility of a shadow SKU.
 */

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
  publishNow: boolean;
  capMessage: string | null;
  missingPrices: string[];
}): string[] {
  const missing: string[] = [];
  if (!input.printFilePath) missing.push("No print file for this candidate.");
  if (!input.panelId) missing.push("No mockup panel is chosen for this candidate.");
  for (const colour of input.tickedColours) {
    if (!input.panelColours.includes(colour)) {
      missing.push(`No mockup panel for ${colour} on ${input.productTypeName}.`);
    }
    if (!input.storedMockupColours.includes(colour)) {
      missing.push(`No stored mockup for ${colour}. Approve stores the images; promote does not render them again.`);
    }
  }
  if (!input.tickedColours.length) missing.push("No colours are ticked.");
  if (!String(input.title || "").trim()) missing.push("Title is not stored on the candidate.");
  if (!String(input.description || "").trim()) missing.push("Description is not stored on the candidate.");
  const taxonomy = [
    ["style", input.artStyle],
    ["species", input.species],
    ["humour operator", input.humourOperator],
  ].filter(([, value]) => !String(value || "").trim()).map(([name]) => name);
  if (taxonomy.length) {
    missing.push(`The candidate is missing ${taxonomy.join(", ")}. Promote does not invent tags.`);
  }
  if (input.shippingRefusal) missing.push(input.shippingRefusal);
  if (input.missingPrices.length) {
    missing.push(`No front price for ${input.missingPrices.join(", ")}.`);
  }
  if (input.publishNow && input.capMessage) missing.push(input.capMessage);
  return missing;
}
