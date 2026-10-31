/**
 * One-off: the Softstyle studio product has no Shopify category, so promote
 * refuses. Sets Clothing Tops > T-Shirts on the staging base product only.
 */
import { and, eq } from "drizzle-orm";
import { customizerPages, productTypes } from "@shared/schema";
import { db } from "./db";
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
  if (!res.ok || json?.errors?.length) {
    const message = json?.errors?.map((err: { message?: string }) => err.message).filter(Boolean).join("; ");
    throw new Error(message || `Shopify HTTP ${res.status}`);
  }
  return json.data;
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
  const token = installation.accessToken;
  const productId = `gid://shopify/Product/${page.baseProductId}`;
  const current = await adminGql(
    shop,
    token,
    `query($id: ID!) { product(id: $id) { category { id fullName } } }`,
    { id: productId },
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
    { product: { id: productId, category: matches[0].id } },
  );
  const errors = updated?.productUpdate?.userErrors || [];
  if (errors.length) throw new Error(errors.map((err: { message?: string }) => err.message).join("; "));
  const category = updated?.productUpdate?.product?.category;
  if (!category?.id) throw new Error("Shopify did not return a category after the update.");
  return { categoryId: category.id, fullName: String(category.fullName || matches[0].fullName || ""), already: false };
}
