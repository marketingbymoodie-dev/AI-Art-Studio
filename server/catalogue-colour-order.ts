/**
 * Put live catalogue products into the Studio colour order.
 * Option values drive the swatches. Variant positions follow colour, then size.
 */
import { eq, and, isNotNull, ne } from "drizzle-orm";
import {
  apparelSizeRank,
  catalogueVariantPositions,
  sortCatalogueColours,
} from "@shared/flywheelPromote";
import { designCandidates } from "@shared/schema";
import { db } from "./db";
import { storage } from "./storage";
import { paceVendor, shopifyThrottled, vendorRetryDelayMs } from "./vendor-backoff";

const STAGING_SHOP = "ai-art-studio-staging.myshopify.com";
const SHOPIFY_API = "2025-10";

type OptionValue = { id: string; name: string };
type ProductOption = { id: string; name: string; optionValues: OptionValue[] };
type ProductVariant = { id: string; selectedOptions: Array<{ name: string; value: string }> };

async function adminGql(shop: string, token: string, query: string, variables: Record<string, unknown>) {
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
      console.warn(`[catalogue-colour-order] Shopify ${res.status} — retry in ${delay}ms`);
      await new Promise((resolve) => setTimeout(resolve, delay));
      continue;
    }
    if (!res.ok || json?.errors?.length) {
      const message = json?.errors?.map((err: { message?: string }) => err.message).filter(Boolean).join("; ");
      throw new Error(message || `Shopify HTTP ${res.status}`);
    }
    return json.data;
  }
}

function optionReorderInput(option: ProductOption): { id: string; values: Array<{ id: string }> } {
  const values = /^colou?r$/i.test(option.name)
    ? sortCatalogueColours(option.optionValues)
    : option.name.toLowerCase() === "size"
      ? [...option.optionValues].sort((a, b) => apparelSizeRank(a.name) - apparelSizeRank(b.name) || a.name.localeCompare(b.name))
      : option.optionValues;
  return { id: option.id, values: values.map((value) => ({ id: value.id })) };
}

export async function reorderStagingCatalogueColours(): Promise<Array<{
  id: string;
  title: string;
  colours: string[];
  error: string;
}>> {
  if (process.env.RAILWAY_ENVIRONMENT_NAME === "production") {
    throw new Error("Catalogue colour order is staging only.");
  }
  const installation = await storage.getShopifyInstallationByShop(STAGING_SHOP);
  if (!installation?.accessToken) throw new Error("Staging Shopify token is not stored.");
  const rows = await db
    .select({
      id: designCandidates.shopifyProductId,
      title: designCandidates.title,
    })
    .from(designCandidates)
    .where(and(
      eq(designCandidates.shopDomain, STAGING_SHOP),
      isNotNull(designCandidates.shopifyProductId),
      ne(designCandidates.shopifyProductId, ""),
    ));
  const results: Array<{ id: string; title: string; colours: string[]; error: string }> = [];
  for (const row of rows) {
    const numeric = String(row.id || "").replace(/\D/g, "");
    const title = String(row.title || numeric);
    if (!numeric) continue;
    const productGid = `gid://shopify/Product/${numeric}`;
    try {
      const data = await adminGql(STAGING_SHOP, installation.accessToken, `
        query($id: ID!) {
          product(id: $id) {
            options { id name optionValues { id name } }
            variants(first: 100) { nodes { id selectedOptions { name value } } }
          }
        }
      `, { id: productGid });
      const product = data?.product;
      if (!product) throw new Error("Shopify product was not found");
      const options = (product.options || []) as ProductOption[];
      const colour = options.find((option) => /^colou?r$/i.test(option.name));
      if (!colour) throw new Error("No Color option");
      const reordered = await adminGql(STAGING_SHOP, installation.accessToken, `
        mutation($productId: ID!, $options: [OptionReorderInput!]!) {
          productOptionsReorder(productId: $productId, options: $options) {
            userErrors { message }
          }
        }
      `, {
        productId: productGid,
        options: options.map(optionReorderInput),
      });
      const optionErrors = reordered?.productOptionsReorder?.userErrors || [];
      if (optionErrors.length) {
        throw new Error(optionErrors.map((err: { message?: string }) => err.message).join("; "));
      }
      const variants = (product.variants?.nodes || []) as ProductVariant[];
      const positions = catalogueVariantPositions(variants.map((variant) => ({
        id: variant.id,
        colour: variant.selectedOptions.find((option) => /^colou?r$/i.test(option.name))?.value || "",
        size: variant.selectedOptions.find((option) => option.name.toLowerCase() === "size")?.value || "",
      })));
      const moved = await adminGql(STAGING_SHOP, installation.accessToken, `
        mutation($productId: ID!, $positions: [ProductVariantPositionInput!]!) {
          productVariantsBulkReorder(productId: $productId, positions: $positions) {
            userErrors { message }
          }
        }
      `, { productId: productGid, positions });
      const variantErrors = moved?.productVariantsBulkReorder?.userErrors || [];
      if (variantErrors.length) {
        throw new Error(variantErrors.map((err: { message?: string }) => err.message).join("; "));
      }
      const colours = sortCatalogueColours(colour.optionValues).map((value) => value.name);
      results.push({ id: numeric, title, colours, error: "" });
    } catch (err) {
      results.push({
        id: numeric,
        title,
        colours: [],
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return results;
}
