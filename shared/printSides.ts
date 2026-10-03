/**
 * "Print sides" — third Shopify option on customizer base products
 * (Front / Front + Back). Each size:color blank becomes two Shopify variants;
 * Printify still sees one blank (variantMap stays size:color). Front ids live in
 * `product_types.shopify_variant_ids`, Front + Back ids in
 * `shopify_variant_ids_both`, both keyed size:color.
 *
 * Products created before the option exist have no Print sides values on any
 * variant; every helper here treats them as Front-only (legacy) so nothing
 * changes for them.
 */
import { parsePrintifyCostsCache } from "./printifyProductionCosts";

export const PRINT_SIDES_OPTION_NAME = "Print sides";
export const PRINT_SIDES_FRONT = "Front";
export const PRINT_SIDES_BOTH = "Front + Back";

export type PrintSides = "front" | "both";

type VariantLike = {
  title?: string | null;
  option1?: string | null;
  option2?: string | null;
  option3?: string | null;
  selectedOptions?: Array<{ name?: string | null; value?: string | null }> | null;
};

function norm(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const FRONT_NORM = norm(PRINT_SIDES_FRONT);
const BOTH_NORMS = new Set([norm(PRINT_SIDES_BOTH), "front+back", "front & back", "front and back"]);

/** "front" / "both" for a Print sides option value; null for anything else. */
export function printSidesOfValue(value: unknown): PrintSides | null {
  const n = norm(value);
  if (!n) return null;
  if (BOTH_NORMS.has(n)) return "both";
  if (n === FRONT_NORM) return "front";
  return null;
}

/** True for option values that belong to the Print sides axis (never a size or colour). */
export function isPrintSidesValue(value: unknown): boolean {
  return printSidesOfValue(value) != null;
}

/**
 * Print sides of a Shopify variant (REST option1..3, GraphQL selectedOptions,
 * or the "S / Black / Front + Back" title). null = the product has no Print
 * sides option (legacy, Front-only).
 */
export function printSidesOfVariant(v: VariantLike | null | undefined): PrintSides | null {
  if (!v) return null;
  for (const o of v.selectedOptions ?? []) {
    if (norm(o?.name) === norm(PRINT_SIDES_OPTION_NAME)) return printSidesOfValue(o?.value);
  }
  for (const opt of [v.option3, v.option2, v.option1]) {
    const s = printSidesOfValue(opt);
    if (s) return s;
  }
  // Callers that map only option1/option2 still pass the title.
  if (v.title) {
    const parts = String(v.title).split(/\s*\/\s*/);
    for (const p of parts) {
      const s = printSidesOfValue(p);
      if (s) return s;
    }
  }
  return null;
}

/** Variant serves the requested side. Legacy variants (no option) serve Front only. */
export function variantServesPrintSides(v: VariantLike, sides: PrintSides): boolean {
  const s = printSidesOfVariant(v) ?? "front";
  return s === sides;
}

/** True when any variant in the list carries a Print sides value. */
export function catalogHasPrintSides(variants: VariantLike[] | null | undefined): boolean {
  return (variants ?? []).some((v) => printSidesOfVariant(v) != null);
}

/** Non-sides option values of a variant, in option order (size/colour axes only). */
export function sizeColorOptionValues(v: VariantLike): string[] {
  return [v.option1, v.option2, v.option3]
    .filter((o): o is string => !!o && String(o).trim() !== "")
    .map(String)
    .filter((o) => !isPrintSidesValue(o));
}

/**
 * Split created/read-back variants into the Front and Front + Back
 * size:color → id maps. Key is `${option1}:${option2}` with the Print sides
 * value removed, matching the legacy shopifyVariantIds key shape.
 */
export function splitShopifyVariantIdsBySides<T extends VariantLike & { id: string | number }>(
  variants: T[],
): { front: Record<string, number>; both: Record<string, number> } {
  const front: Record<string, number> = {};
  const both: Record<string, number> = {};
  for (const v of variants) {
    const [size = "default", color = "default"] = sizeColorOptionValues(v);
    const key = `${size || "default"}:${color || "default"}`;
    const target = printSidesOfVariant(v) === "both" ? both : front;
    const id = Number(String(v.id).replace(/\D/g, ""));
    if (!Number.isFinite(id) || id <= 0) continue;
    if (target[key] == null) target[key] = id;
  }
  return { front, both };
}

type ProductTypeSidesInput = {
  printSidesEnabled?: boolean | null;
  printifyCosts?: unknown;
  variantPricesBoth?: unknown;
  isAllOverPrint?: boolean | null;
};

function hasEntries(raw: unknown): boolean {
  if (!raw) return false;
  let obj: unknown = raw;
  if (typeof raw === "string") {
    try {
      obj = JSON.parse(raw || "{}");
    } catch {
      return false;
    }
  }
  return !!obj && typeof obj === "object" && !Array.isArray(obj) && Object.keys(obj as object).length > 0;
}

/** Front+back costs or a saved both-tier retail map exist for this product type. */
export function productTypeHasBothSideCosts(pt: ProductTypeSidesInput): boolean {
  if (pt.isAllOverPrint) return false;
  const costsRaw =
    typeof pt.printifyCosts === "string" ? pt.printifyCosts : JSON.stringify(pt.printifyCosts ?? {});
  const { both } = parsePrintifyCostsCache(costsRaw);
  const bothCount = Object.keys(both).filter((k) => !k.startsWith("_")).length;
  return bothCount > 0 || hasEntries(pt.variantPricesBoth);
}

/**
 * Whether the base product should carry the Print sides option.
 * Derived default: on where front+back costs exist. Operator override false
 * turns it off; true cannot turn it on without both-side costs (no price).
 */
export function printSidesEnabledForProductType(pt: ProductTypeSidesInput): boolean {
  if (pt.printSidesEnabled === false) return false;
  return productTypeHasBothSideCosts(pt);
}

/** Live variant counts per tier. Legacy products (no option) count entirely as Front. */
export function printSidesTierCounts(variants: VariantLike[] | null | undefined): { front: number; both: number } {
  let front = 0;
  let both = 0;
  for (const v of variants ?? []) {
    if (printSidesOfVariant(v) === "both") both++;
    else front++;
  }
  return { front, both };
}

/** Shopify variants per size:color blank. */
export function printSidesVariantFactor(enabled: boolean): 1 | 2 {
  return enabled ? 2 : 1;
}
