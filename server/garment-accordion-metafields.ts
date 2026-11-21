/**
 * Product metafields for the two theme accordions.
 * Comfort is fabric, weight, and fit. Durability is construction, labels, and certifications.
 * Both are filled from the product type's garment details.
 */
import { and, eq, isNotNull, ne } from "drizzle-orm";
import {
  GARMENT_ACCORDION_NAMESPACE,
  GARMENT_COMFORT_KEY,
  GARMENT_DURABILITY_KEY,
  garmentAccordionCopy,
  garmentAccordionMetafields,
} from "@shared/garmentAccordion";
import { designProducts, productTypes } from "@shared/schema";
import { db } from "./db";
import { paceVendor, shopifyThrottled, vendorRetryDelayMs } from "./vendor-backoff";
import { normalizeMyshopifyShopDomain } from "./shopDomain";
import { storage } from "./storage";
import { ensureValidOfflineAccessToken } from "./shopify-offline-token";

const SHOPIFY_API = "2025-10";

const DEFINITIONS = [
  {
    key: GARMENT_COMFORT_KEY,
    name: "Garment comfort",
    description: "Fabric, weight, and fit for the Premium Everyday Comfort accordion. Filled from this product type's garment details.",
  },
  {
    key: GARMENT_DURABILITY_KEY,
    name: "Garment durability",
    description: "Construction, labels, and certifications for the Built to Last accordion. Filled from this product type's garment details.",
  },
] as const;

async function adminGql(shop: string, token: string, query: string, variables: Record<string, unknown> = {}) {
  for (let attempt = 0; ; attempt++) {
    await paceVendor("shopify");
    const res = await fetch(`https://${shop}/admin/api/${SHOPIFY_API}/graphql.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
      body: JSON.stringify({ query, variables }),
    });
    const json = await res.json().catch(() => ({}));
    const throttled = shopifyThrottled(json);
    const delay = vendorRetryDelayMs(throttled ? 429 : res.status, res.headers.get("retry-after"), attempt, throttled);
    if (delay != null) {
      await new Promise((resolve) => setTimeout(resolve, delay));
      continue;
    }
    if (!res.ok || json?.errors) {
      const errors = json?.errors;
      const message = Array.isArray(errors)
        ? errors.map((err: { message?: string }) => err.message).filter(Boolean).join("; ")
        : typeof errors === "string"
          ? errors
          : "";
      throw new Error(message || `Shopify HTTP ${res.status}`);
    }
    return json.data;
  }
}

function productGid(shopifyProductId: string): string {
  const numeric = String(shopifyProductId).replace(/\D/g, "");
  if (!numeric) throw new Error("Missing Shopify product id");
  return `gid://shopify/Product/${numeric}`;
}

function paragraphText(value: string | null | undefined): string {
  if (!value) return "";
  try {
    const doc = JSON.parse(value);
    return (doc.children || [])
      .map((node: { children?: Array<{ value?: string }> }) => (node.children || []).map((child) => child.value || "").join(""))
      .join("\n");
  } catch {
    return value;
  }
}

export type GarmentDefinitionResult = {
  shop: string;
  key: string;
  status: "created" | "present" | "failed";
  error?: string;
};

/** Admin access cannot be set to MERCHANT_READ_WRITE for these shops; Shopify
 * keeps it PUBLIC_READ_WRITE. Storefront PUBLIC_READ is what the theme editor needs. */
const DEFINITION_ACCESS = { storefront: "PUBLIC_READ" } as const;

function errorText(errors: Array<{ message?: string; code?: string }>): string {
  return errors.map((err) => err.message || err.code || "").filter(Boolean).join("; ");
}

/** Idempotent. Storefront read access is what lets the theme editor bind a dynamic source. */
export async function ensureGarmentAccordionDefinitions(shop: string, token: string): Promise<GarmentDefinitionResult[]> {
  const results: GarmentDefinitionResult[] = [];
  for (const definition of DEFINITIONS) {
    const input = {
      name: definition.name,
      namespace: GARMENT_ACCORDION_NAMESPACE,
      key: definition.key,
      description: definition.description,
      type: "rich_text_field",
      ownerType: "PRODUCT",
      pin: true,
      access: DEFINITION_ACCESS,
    };
    try {
      const created = await adminGql(shop, token, `
        mutation($definition: MetafieldDefinitionInput!) {
          metafieldDefinitionCreate(definition: $definition) {
            createdDefinition { id }
            userErrors { message code }
          }
        }
      `, { definition: input });
      const errors = created?.metafieldDefinitionCreate?.userErrors || [];
      const taken = errors.some((err: { code?: string }) => err.code === "TAKEN");
      const hard = errors.filter((err: { code?: string }) => err.code !== "TAKEN");
      if (hard.length) {
        const error = errorText(hard);
        console.warn(`[garment-accordion] definition ${definition.key} for ${shop}:`, error);
        results.push({ shop, key: definition.key, status: "failed", error });
        continue;
      }
      if (created?.metafieldDefinitionCreate?.createdDefinition?.id) {
        results.push({ shop, key: definition.key, status: "created" });
        continue;
      }
      const updated = await adminGql(shop, token, `
        mutation($definition: MetafieldDefinitionUpdateInput!) {
          metafieldDefinitionUpdate(definition: $definition) {
            updatedDefinition { id }
            userErrors { message code }
          }
        }
      `, {
        definition: {
          namespace: GARMENT_ACCORDION_NAMESPACE,
          key: definition.key,
          ownerType: "PRODUCT",
          name: definition.name,
          pin: true,
          access: DEFINITION_ACCESS,
        },
      });
      const updateErrors = updated?.metafieldDefinitionUpdate?.userErrors || [];
      if (updateErrors.length || !taken && !updated?.metafieldDefinitionUpdate?.updatedDefinition?.id) {
        const error = errorText(updateErrors) || "definition was not created";
        console.warn(`[garment-accordion] definition ${definition.key} for ${shop}:`, error);
        results.push({ shop, key: definition.key, status: "failed", error });
        continue;
      }
      results.push({ shop, key: definition.key, status: "present" });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      console.warn(`[garment-accordion] definition ${definition.key} for ${shop}:`, error);
      results.push({ shop, key: definition.key, status: "failed", error });
    }
  }
  return results;
}

/** Every installed shop, including one that has not published a listing yet. */
export async function ensureGarmentAccordionDefinitionsForAllShops(): Promise<GarmentDefinitionResult[]> {
  const installations = await storage.getAllShopifyInstallations();
  const results: GarmentDefinitionResult[] = [];
  for (const installation of installations) {
    const shop = normalizeMyshopifyShopDomain(installation.shopDomain);
    if (!shop || installation.uninstalledAt || installation.status === "uninstalled") continue;
    if (!installation.accessToken || installation.accessToken === "NEEDS_RECONNECT") {
      results.push({ shop, key: "*", status: "failed", error: "no token" });
      continue;
    }
    const ready = await ensureValidOfflineAccessToken(installation);
    if (!ready.ok) {
      console.warn(`[garment-accordion] ${shop} token: ${ready.error}`);
      results.push({ shop, key: "*", status: "failed", error: ready.error || "no token" });
      continue;
    }
    results.push(...await ensureGarmentAccordionDefinitions(shop, ready.accessToken));
  }
  return results;
}

export async function setGarmentAccordionMetafields(
  shop: string,
  token: string,
  shopifyProductId: string,
  garmentDetailsHtml: string | null | undefined,
): Promise<boolean> {
  const fields = garmentAccordionMetafields(garmentDetailsHtml);
  if (!fields.length) return false;
  const data = await adminGql(shop, token, `
    mutation($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) { userErrors { message } }
    }
  `, {
    metafields: fields.map((field) => ({
      ownerId: productGid(shopifyProductId),
      namespace: field.namespace,
      key: field.key,
      type: field.type,
      value: field.value,
    })),
  });
  const errors = data?.metafieldsSet?.userErrors || [];
  if (errors.length) throw new Error(errors.map((err: { message?: string }) => err.message).filter(Boolean).join("; "));
  return true;
}

async function currentCopy(shop: string, token: string, shopifyProductId: string): Promise<{ comfort: string; durability: string }> {
  const data = await adminGql(shop, token, `
    query($id: ID!) {
      product(id: $id) {
        comfort: metafield(namespace: "${GARMENT_ACCORDION_NAMESPACE}", key: "${GARMENT_COMFORT_KEY}") { value }
        durability: metafield(namespace: "${GARMENT_ACCORDION_NAMESPACE}", key: "${GARMENT_DURABILITY_KEY}") { value }
      }
    }
  `, { id: productGid(shopifyProductId) });
  return {
    comfort: paragraphText(data?.product?.comfort?.value),
    durability: paragraphText(data?.product?.durability?.value),
  };
}

/** Writes the accordion metafields on existing app-published listings. Skips a product that already matches. */
export async function backfillGarmentAccordionMetafields(): Promise<{ set: number; skipped: number; failed: number }> {
  const rows = await db
    .select({
      shop: designProducts.shop,
      shopifyProductId: designProducts.shopifyProductId,
      description: productTypes.description,
    })
    .from(designProducts)
    .leftJoin(productTypes, eq(designProducts.productTypeId, productTypes.id))
    .where(and(isNotNull(designProducts.shopifyProductId), ne(designProducts.shopifyProductId, "")));
  const tokens = new Map<string, string | null>();
  let set = 0;
  let skipped = 0;
  let failed = 0;
  for (const row of rows) {
    const shop = normalizeMyshopifyShopDomain(row.shop);
    const productId = String(row.shopifyProductId || "");
    const wanted = garmentAccordionCopy(row.description);
    if (!shop || !productId || (!wanted.comfort.length && !wanted.durability.length)) {
      skipped += 1;
      continue;
    }
    if (!tokens.has(shop)) {
      const installation = await storage.getShopifyInstallationByShop(shop);
      if (!installation?.accessToken) {
        tokens.set(shop, null);
      } else {
        const ready = await ensureValidOfflineAccessToken(installation);
        tokens.set(shop, ready.ok ? ready.accessToken : null);
        if (!ready.ok) console.warn(`[garment-accordion] ${shop} token: ${ready.error}`);
      }
      const token = tokens.get(shop);
      if (token) await ensureGarmentAccordionDefinitions(shop, token);
    }
    const token = tokens.get(shop);
    if (!token) {
      skipped += 1;
      continue;
    }
    try {
      const current = await currentCopy(shop, token, productId);
      if (current.comfort === wanted.comfort.join("\n") && current.durability === wanted.durability.join("\n")) {
        skipped += 1;
        continue;
      }
      await setGarmentAccordionMetafields(shop, token, productId, row.description);
      set += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/owner does not exist/i.test(message)) {
        skipped += 1;
        continue;
      }
      failed += 1;
      console.warn(`[garment-accordion] ${productId}:`, message);
    }
  }
  return { set, skipped, failed };
}
