/**
 * Who may publish or edit a catalogue design on this backend.
 * Staging keeps the demo shop and Petposterous. Production stays locked until
 * CATALOGUE_PUBLISH_ALLOWED_SHOPS is set, and then only those shops.
 * Concept generation, blueprint import, and shell categories stay staging-only.
 */
import { catalogueShopDomain, PETPOSTEROUS_CATALOGUE_SHOP, PETSTAGE_CATALOGUE_SHOP, STAGING_CATALOGUE_SHOP } from "./operatorCatalogue";

export const CATALOGUE_PUBLISH_ALLOWED_SHOPS_ENV = "CATALOGUE_PUBLISH_ALLOWED_SHOPS";
export const CATALOGUE_PUBLISH_LOCKED_MESSAGE = "Catalogue publish is locked on this backend.";
export const CATALOGUE_PUBLISH_SHOP_MESSAGE = "Catalogue publish is not available for this store.";
export const CATALOGUE_STUDIO_LOCKED_MESSAGE = "Catalogue changes are locked on this backend.";
export const CATALOGUE_STUDIO_SHOP_MESSAGE = "Catalogue changes are not available for this store.";

export type CataloguePublishEnv = {
  RAILWAY_ENVIRONMENT_NAME?: string;
  CATALOGUE_PUBLISH_ALLOWED_SHOPS?: string;
};

export function parseCataloguePublishAllowlist(raw: string | null | undefined): string[] {
  const out: string[] = [];
  for (const part of String(raw || "").split(",")) {
    const domain = catalogueShopDomain(part);
    if (!domain || out.includes(domain)) continue;
    out.push(domain);
  }
  return out;
}

/** Production uses only the env list. An empty list is the first-boot lock. */
export function cataloguePublishAllowedShops(env: CataloguePublishEnv = process.env): string[] {
  if (env.RAILWAY_ENVIRONMENT_NAME === "production") {
    return parseCataloguePublishAllowlist(env.CATALOGUE_PUBLISH_ALLOWED_SHOPS);
  }
  return [STAGING_CATALOGUE_SHOP, PETPOSTEROUS_CATALOGUE_SHOP, PETSTAGE_CATALOGUE_SHOP];
}

export function cataloguePublishLocked(env: CataloguePublishEnv = process.env): boolean {
  return env.RAILWAY_ENVIRONMENT_NAME === "production" && cataloguePublishAllowedShops(env).length === 0;
}

export function cataloguePublishAllowedForShop(
  shop: string | null | undefined,
  env: CataloguePublishEnv = process.env,
): boolean {
  if (cataloguePublishLocked(env)) return false;
  const domain = catalogueShopDomain(shop);
  return Boolean(domain) && cataloguePublishAllowedShops(env).includes(domain);
}

export function cataloguePublishBlockMessage(
  shop: string | null | undefined,
  env: CataloguePublishEnv = process.env,
): string | null {
  if (cataloguePublishAllowedForShop(shop, env)) return null;
  if (cataloguePublishLocked(env)) return CATALOGUE_PUBLISH_LOCKED_MESSAGE;
  return CATALOGUE_PUBLISH_SHOP_MESSAGE;
}

/** Import, drop, delete, My Pet, colour reorder, wording, and tick saves. */
export function catalogueStudioBlockMessage(
  shop: string | null | undefined,
  env: CataloguePublishEnv = process.env,
): string | null {
  if (cataloguePublishAllowedForShop(shop, env)) return null;
  if (cataloguePublishLocked(env)) return CATALOGUE_STUDIO_LOCKED_MESSAGE;
  return CATALOGUE_STUDIO_SHOP_MESSAGE;
}
