/**
 * Storefront mockup mode vs fulfillment layout — independently overridable.
 *
 * - storefrontMockupMode: what the customer sees in the editor (flat Printify mockups,
 *   on-the-fly flat placer, AOP pattern UI, etc.)
 * - fulfillmentLayout: how we build the print file for Printify orders
 */

import { TOTE_FOLDED_V1_TEMPLATE } from "./toteFoldedLayout";

export type StorefrontMockupMode = "auto" | "flat" | "aop" | "printify";
export type FulfillmentLayout = "auto" | "standard" | "flat" | "aop" | typeof TOTE_FOLDED_V1_TEMPLATE;

export const STOREFRONT_MOCKUP_MODE_LABELS: Record<StorefrontMockupMode, string> = {
  auto: "Auto (from AOP flag + catalog)",
  flat: "Flat lay (Printify front/back, same art)",
  aop: "AOP panel customizer",
  printify: "Printify mockups (legacy)",
};

export const FULFILLMENT_LAYOUT_LABELS: Record<FulfillmentLayout, string> = {
  auto: "Auto (from catalog / product name)",
  standard: "Standard (front/back placeholders)",
  flat: "Flat on-the-fly bake",
  aop: "AOP panel URLs",
  tote_folded_v1: "Folded tote (duplicate + 180° bottom panel)",
};

/** Printify blueprint: Adjustable Tote Bag (AOP). */
export const ADJUSTABLE_TOTE_BLUEPRINT_ID = 1300;
/** Printify blueprint: Shoulder Tote Bag (AOP) — flat on-the-fly, not folded. */
export const SHOULDER_TOTE_BLUEPRINT_ID = 836;

/** Flat totes that keep front/back scale matched (40a5a6c). */
export function isFlatToteBlueprint(blueprintId: number | null | undefined): boolean {
  const bp = Number(blueprintId);
  return bp === ADJUSTABLE_TOTE_BLUEPRINT_ID || bp === SHOULDER_TOTE_BLUEPRINT_ID;
}

export type LayoutPolicySource = {
  isAllOverPrint?: boolean | null;
  /** Mesh-warp AOP panel mapper template — enables HoodieAopPlacer when set. */
  panelMappingTemplate?: string | null;
  storefrontMockupMode?: string | null;
  fulfillmentLayout?: string | null;
  printifyBlueprintId?: number | null;
  forceFlatHarvest?: boolean | null;
  /**
   * On-the-fly mockup tier from flat calibration harvest.
   * When `flat` or `mesh` with a ready calibration, storefront uses FlatProductPlacer
   * instead of the legacy AOP PatternCustomizer — even if the product title is `(AOP)`.
   */
  onTheFlyTier?: string | null;
};

function normMode(raw: string | null | undefined): StorefrontMockupMode | null {
  if (!raw || raw === "auto") return null;
  if (raw === "flat" || raw === "aop" || raw === "printify") return raw;
  return null;
}

function normFulfillment(raw: string | null | undefined): FulfillmentLayout | null {
  if (!raw || raw === "auto") return null;
  if (
    raw === "standard" ||
    raw === "flat" ||
    raw === "aop" ||
    raw === TOTE_FOLDED_V1_TEMPLATE
  ) {
    return raw;
  }
  return null;
}

function hasOnTheFlyFlatOrMesh(
  product: LayoutPolicySource,
  catalog?: LayoutPolicySource | null,
): boolean {
  const tier = product.onTheFlyTier ?? catalog?.onTheFlyTier ?? null;
  return tier === "flat" || tier === "mesh";
}

export function resolveStorefrontMockupMode(
  product: LayoutPolicySource,
  catalog?: LayoutPolicySource | null,
): StorefrontMockupMode {
  const explicit = normMode(product.storefrontMockupMode) ?? normMode(catalog?.storefrontMockupMode);
  if (explicit) return explicit;

  // Folded tote and harvested *flat* beat a leftover AOP panel-mapping name.
  // Catalog sync used to stamp hoodie templates onto totes titled (AOP).
  // Mesh-tier + template still means HoodieAopPlacer (zip/pullover).
  const fulfillment = resolveFulfillmentLayout(product, catalog);
  if (fulfillment === TOTE_FOLDED_V1_TEMPLATE) return "flat";
  const tier = product.onTheFlyTier ?? catalog?.onTheFlyTier ?? null;
  if (tier === "flat") return "flat";

  // Mesh AOP panel mapper when this is actually a mesh product.
  if (product.panelMappingTemplate || catalog?.panelMappingTemplate) return "aop";
  if (hasOnTheFlyFlatOrMesh(product, catalog)) return "flat";

  if (product.isAllOverPrint || catalog?.isAllOverPrint) {
    return "aop";
  }
  return "printify";
}

export function resolveFulfillmentLayout(
  product: LayoutPolicySource,
  catalog?: LayoutPolicySource | null,
): FulfillmentLayout {
  const explicit =
    normFulfillment(product.fulfillmentLayout) ?? normFulfillment(catalog?.fulfillmentLayout);
  if (explicit) return explicit;

  const bp = product.printifyBlueprintId ?? catalog?.printifyBlueprintId;
  if (bp === ADJUSTABLE_TOTE_BLUEPRINT_ID) return TOTE_FOLDED_V1_TEMPLATE;

  if (product.isAllOverPrint || catalog?.isAllOverPrint) return "aop";
  return "standard";
}

/** PatternCustomizer / HoodieAopPlacer vs flat Printify mockups / FlatProductPlacer. */
export function usesAopStorefrontCustomizer(
  product: LayoutPolicySource,
  catalog?: LayoutPolicySource | null,
): boolean {
  // Explicit operator override wins over harvest heuristics.
  const explicit =
    normMode(product.storefrontMockupMode) ?? normMode(catalog?.storefrontMockupMode);
  if (explicit === "aop") return true;
  if (explicit === "flat" || explicit === "printify") return false;
  // Folded tote / harvested flat never share the mesh PatternCustomizer.
  if (resolveFulfillmentLayout(product, catalog) === TOTE_FOLDED_V1_TEMPLATE) {
    return false;
  }
  const tier = product.onTheFlyTier ?? catalog?.onTheFlyTier ?? null;
  if (tier === "flat") return false;
  // Published mesh panel-mapping template → HoodieAopPlacer.
  if (product.panelMappingTemplate || catalog?.panelMappingTemplate) return true;
  if (hasOnTheFlyFlatOrMesh(product, catalog)) return false;
  const mode = resolveStorefrontMockupMode(product, catalog);
  if (mode === "aop") return true;
  if (mode === "flat" || mode === "printify") return false;
  return !!product.isAllOverPrint;
}

export function usesToteFoldedFulfillment(
  product: LayoutPolicySource,
  catalog?: LayoutPolicySource | null,
): boolean {
  return resolveFulfillmentLayout(product, catalog) === TOTE_FOLDED_V1_TEMPLATE;
}

/** Tote folded products always print both faces from one panel design. */
export function resolveToteFoldedDoubleSided(
  product: LayoutPolicySource,
  catalog?: LayoutPolicySource | null,
): boolean {
  if (usesToteFoldedFulfillment(product, catalog)) return true;
  return false;
}

export function shouldAllowFlatHarvest(args: {
  name: string;
  blueprintId: number;
  forceFlatHarvest?: boolean | null;
  isAllOverPrint?: boolean | null;
  fulfillmentLayout?: string | null;
}): boolean {
  if (args.forceFlatHarvest) return true;
  if (normFulfillment(args.fulfillmentLayout) === TOTE_FOLDED_V1_TEMPLATE) return true;
  if (args.blueprintId === ADJUSTABLE_TOTE_BLUEPRINT_ID) return true;
  if (!args.isAllOverPrint) return true;
  return false;
}

/** Skip curved/wrap probe rejection — operator tagged flat despite AOP name or tote_folded layout. */
export function shouldForceFlatTierDespiteProbe(source: LayoutPolicySource): boolean {
  if (source.forceFlatHarvest) return true;
  return usesToteFoldedFulfillment(source);
}

export function shouldBlockFlatCatalogTag(args: {
  name: string;
  blueprintId: number;
  forceFlatHarvest?: boolean | null;
}): boolean {
  if (args.forceFlatHarvest) return false;
  return /\(aop\)/i.test(args.name.trim());
}
