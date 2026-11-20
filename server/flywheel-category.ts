/**
 * One-off: the Softstyle studio product has no Shopify category, so promote
 * refuses. Sets Clothing Tops > T-Shirts on the staging base product only.
 */
import { and, eq, inArray } from "drizzle-orm";
import { customizerPages, productTypes } from "@shared/schema";
import { db } from "./db";
import { hasShopifyAppCredentials } from "./shopify-app-credentials";
import { ensureValidOfflineAccessToken } from "./shopify-offline-token";
import { storage } from "./storage";

const STAGING_SHOP = "ai-art-studio-staging.myshopify.com";
const SHOPIFY_API = "2025-10";

async function adminGql(shop: string, token: string, query: string, variables: Record<string, unknown> = {}) {
  const res = await fetch(`https://${shop}/admin/api/${SHOPIFY_API}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json().catch(() => ({}));
  const graphqlErrors = Array.isArray(json?.errors) ? json.errors : [];
  if (!res.ok || graphqlErrors.length) {
    const message = graphqlErrors.map((err: { message?: string }) => err.message).filter(Boolean).join("; ");
    const fallback = typeof json?.errors === "string" ? json.errors : "";
    throw new Error(message || fallback || `Shopify HTTP ${res.status}`);
  }
  return json.data;
}

export async function ensureTshirtCategory(
  shop: string,
  productId: string,
  token: string,
): Promise<{ categoryId: string; fullName: string; already: boolean }> {
  const gid = `gid://shopify/Product/${String(productId).replace(/\D/g, "")}`;
  const current = await adminGql(
    shop,
    token,
    `query($id: ID!) { product(id: $id) { category { id fullName } } }`,
    { id: gid },
  );
  const existing = current?.product?.category;
  if (existing?.id) return { categoryId: existing.id, fullName: String(existing.fullName || ""), already: true };

  const search = await adminGql(
    shop,
    token,
    `query { taxonomy { categories(search: "T-Shirts", first: 15) { nodes { id fullName } } } }`,
  );
  const nodes = (search?.taxonomy?.categories?.nodes || []) as Array<{ id?: string; fullName?: string }>;
  const matches = nodes.filter((node) => /clothing tops\s*>\s*t-shirts$/i.test(String(node.fullName || "")));
  if (matches.length !== 1 || !matches[0].id) {
    const names = nodes.map((node) => node.fullName).filter(Boolean).join("; ") || "none";
    throw new Error(`Shopify taxonomy did not return one Clothing Tops > T-Shirts category. Saw: ${names}`);
  }
  const updated = await adminGql(
    shop,
    token,
    `mutation($product: ProductUpdateInput!) {
      productUpdate(product: $product) { product { category { id fullName } } userErrors { message } }
    }`,
    { product: { id: gid, category: matches[0].id } },
  );
  const errors = updated?.productUpdate?.userErrors || [];
  if (errors.length) throw new Error(errors.map((err: { message?: string }) => err.message).join("; "));
  const category = updated?.productUpdate?.product?.category;
  if (!category?.id) throw new Error("Shopify did not return a category after the update.");
  return { categoryId: category.id, fullName: String(category.fullName || matches[0].fullName || ""), already: false };
}

export async function ensureSoftstyleProductCategory(): Promise<{ categoryId: string; fullName: string; already: boolean }> {
  const [page] = await db
    .select({ shop: customizerPages.shop, baseProductId: customizerPages.baseProductId })
    .from(customizerPages)
    .innerJoin(productTypes, eq(customizerPages.productTypeId, productTypes.id))
    .where(and(eq(customizerPages.handle, "softstyle-t-shirt"), eq(customizerPages.status, "active")))
    .limit(1);
  const shop = String(page?.shop || "");
  if (shop !== STAGING_SHOP) throw new Error("The Softstyle category fix is staging only.");
  if (!page?.baseProductId) throw new Error("The Softstyle studio product was not found.");
  const installation = await storage.getShopifyInstallationByShop(shop);
  if (!installation?.accessToken) throw new Error("Shopify is not connected for the staging shop.");
  return ensureTshirtCategory(shop, page.baseProductId, installation.accessToken);
}

const SHELL_SHOPS: Record<number, string> = {
  54: "ai-art-studio-staging.myshopify.com",
  56: "h7epay-gh.myshopify.com",
  58: "h7epay-gh.myshopify.com",
};

/**
 * Staging boot: put Clothing Tops > T-Shirts on the catalogue shells that
 * promote reads. Skips production. A category that is already set is left as it is.
 */
export async function ensureCatalogueShellCategories(): Promise<void> {
  if (process.env.RAILWAY_ENVIRONMENT_NAME === "production") return;
  if (!hasShopifyAppCredentials()) return;
  const rows = await db
    .select({
      id: productTypes.id,
      shop: productTypes.shopifyShopDomain,
      productId: productTypes.shopifyProductId,
    })
    .from(productTypes)
    .where(inArray(productTypes.id, [54, 56, 58]));
  const tokenByShop = new Map<string, string>();
  for (const row of rows) {
    const expectedShop = SHELL_SHOPS[row.id];
    const shop = String(row.shop || "");
    if (!expectedShop || shop !== expectedShop || !row.productId) continue;
    let token = tokenByShop.get(shop) || "";
    if (!token) {
      const installation = await storage.getShopifyInstallationByShop(shop);
      if (!installation?.accessToken) {
        console.error(`[shell-category] ${row.id} has no Shopify token`);
        continue;
      }
      token = installation.accessToken;
      try {
        const result = await ensureTshirtCategory(shop, row.productId, token);
        tokenByShop.set(shop, token);
        console.log(`[shell-category] type ${row.id} ${result.already ? "already" : "set"} ${result.fullName} ${result.categoryId}`);
        continue;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (!/invalid api key|unrecognized login|401/i.test(message)) throw err;
        const refreshed = await ensureValidOfflineAccessToken(installation, { forceRefresh: true });
        if (!refreshed.ok) throw new Error(refreshed.error);
        token = refreshed.accessToken;
        tokenByShop.set(shop, token);
      }
    }
    const result = await ensureTshirtCategory(shop, row.productId, token);
    console.log(`[shell-category] type ${row.id} ${result.already ? "already" : "set"} ${result.fullName} ${result.categoryId}`);
  }
}
