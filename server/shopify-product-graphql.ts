/**
 * GraphQL product create/read for customizer base products (Branch C Phase 0b).
 *
 * REST /products endpoints are capped at 100 variants for both writes and reads
 * (deprecated 2024-04, maintenance-only). The GraphQL product APIs support the
 * 2048-variant store default. These helpers keep the REST *shapes* the existing
 * call sites consume (`product.variants[].id/option1/option2/price`, numeric ids),
 * so each site swaps one call.
 */

const API_VERSION = "2025-10";
/** Variants per read page; nested media keeps cost well under the 1000-point query cap. */
const VARIANT_PAGE_SIZE = 100;

export type RestVariantInput = {
  option1?: string | null;
  option2?: string | null;
  option3?: string | null;
  price?: string | number | null;
  sku?: string | null;
  inventory_management?: string | null;
  inventory_policy?: string | null;
};

export type RestProductInput = {
  title: string;
  body_html?: string | null;
  vendor?: string | null;
  product_type?: string | null;
  status?: string | null;
  tags?: string[] | string | null;
  options?: Array<{ name: string; values: string[] }>;
  variants?: RestVariantInput[];
  images?: Array<{ src: string; alt?: string | null }>;
  metafields?: Array<{ namespace: string; key: string; value: string; type: string }>;
};

export type RestCompatVariant = {
  id: number;
  product_id: number;
  title: string;
  price: string;
  sku: string | null;
  position: number;
  option1: string | null;
  option2: string | null;
  option3: string | null;
  inventory_policy: "continue" | "deny";
  inventory_management: "shopify" | null;
  featured_image: { src: string } | null;
};

export type RestCompatProduct = {
  id: number;
  title: string;
  handle: string;
  status: string;
  published_at: string | null;
  body_html: string;
  variants: RestCompatVariant[];
  images: Array<{ id: number; src: string; alt: string | null; position: number }>;
};

const DEFAULT_OPTION = "Title";
const DEFAULT_VALUE = "Default Title";

export function numericShopifyId(gid: string | number | null | undefined): number {
  const n = Number(String(gid ?? "").replace(/\D/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function mapStatus(status: string | null | undefined): string {
  switch (String(status || "").toLowerCase()) {
    case "unlisted": return "UNLISTED";
    case "draft": return "DRAFT";
    case "archived": return "ARCHIVED";
    default: return "ACTIVE";
  }
}

/** REST `{ product }` body → GraphQL `ProductSetInput`. */
export function buildProductSetInput(p: RestProductInput): Record<string, unknown> {
  const options = (p.options ?? []).filter((o) => o && o.name && o.values?.length);
  const optionNames = options.length > 0 ? options.map((o) => o.name) : [DEFAULT_OPTION];
  const restVariants = p.variants && p.variants.length > 0 ? p.variants : [{ price: "0.00" }];

  const variants = restVariants.map((v) => {
    const raw = [v.option1, v.option2, v.option3];
    const optionValues = optionNames.map((name, i) => ({
      optionName: name,
      name: options.length > 0 ? String(raw[i] ?? "") : DEFAULT_VALUE,
    }));
    return {
      optionValues,
      price: v.price != null && v.price !== "" ? String(v.price) : "0.00",
      ...(v.sku ? { sku: v.sku } : {}),
      inventoryPolicy: String(v.inventory_policy || "").toLowerCase() === "continue" ? "CONTINUE" : "DENY",
      inventoryItem: { tracked: String(v.inventory_management || "").toLowerCase() === "shopify" },
    };
  });

  const productOptions = options.length > 0
    ? options.map((o, i) => ({ name: o.name, position: i + 1, values: o.values.map((name) => ({ name })) }))
    : [{ name: DEFAULT_OPTION, position: 1, values: [{ name: DEFAULT_VALUE }] }];

  const tags = Array.isArray(p.tags)
    ? p.tags
    : typeof p.tags === "string"
      ? p.tags.split(",").map((t) => t.trim()).filter(Boolean)
      : undefined;

  return {
    title: p.title,
    ...(p.body_html ? { descriptionHtml: p.body_html } : {}),
    ...(p.vendor ? { vendor: p.vendor } : {}),
    ...(p.product_type ? { productType: p.product_type } : {}),
    status: mapStatus(p.status),
    ...(tags ? { tags } : {}),
    productOptions,
    variants,
    ...(p.images?.length
      ? { files: p.images.map((img) => ({ originalSource: img.src, ...(img.alt ? { alt: img.alt } : {}), contentType: "IMAGE" })) }
      : {}),
    ...(p.metafields?.length ? { metafields: p.metafields } : {}),
  };
}

type VariantNode = {
  id: string;
  title: string;
  price: string;
  sku: string | null;
  position: number;
  inventoryPolicy: string;
  inventoryItem?: { tracked?: boolean } | null;
  selectedOptions: Array<{ name: string; value: string }>;
  media?: { nodes?: Array<{ preview?: { image?: { url?: string } | null } | null }> } | null;
};

/** GraphQL variant node → REST variant shape; option slots follow product option position. */
export function restVariantFromNode(node: VariantNode, productId: number, optionNames: string[]): RestCompatVariant {
  const byName = new Map(node.selectedOptions.map((o) => [o.name, o.value]));
  const slot = (i: number) => {
    const name = optionNames[i];
    if (!name) return null;
    return byName.get(name) ?? null;
  };
  const imgUrl = node.media?.nodes?.[0]?.preview?.image?.url;
  return {
    id: numericShopifyId(node.id),
    product_id: productId,
    title: node.title,
    price: String(node.price ?? "0.00"),
    sku: node.sku ?? null,
    position: node.position,
    option1: slot(0),
    option2: slot(1),
    option3: slot(2),
    inventory_policy: String(node.inventoryPolicy).toUpperCase() === "CONTINUE" ? "continue" : "deny",
    inventory_management: node.inventoryItem?.tracked ? "shopify" : null,
    featured_image: imgUrl ? { src: imgUrl } : null,
  };
}

type GqlResult = { status: number; body: any; text: string };

async function gql(shop: string, token: string, query: string, variables: Record<string, unknown>): Promise<GqlResult> {
  const res = await fetch(`https://${shop}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({ query, variables }),
  });
  const text = await res.text();
  let body: any = null;
  try { body = JSON.parse(text); } catch { /* non-JSON error page */ }
  return { status: res.status, body, text };
}

const VARIANT_FIELDS = `
  id title price sku position inventoryPolicy
  inventoryItem { tracked }
  selectedOptions { name value }
  media(first: 1) { nodes { preview { image { url } } } }
`;

const PRODUCT_QUERY = `query AppaiProductRead($id: ID!, $first: Int!, $after: String) {
  product(id: $id) {
    id title handle status publishedAt descriptionHtml
    options { name position }
    media(first: 20) { nodes { ... on MediaImage { id alt image { url } } } }
    variants(first: $first, after: $after) {
      nodes { ${VARIANT_FIELDS} }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;

const VARIANTS_PAGE_QUERY = `query AppaiProductVariants($id: ID!, $first: Int!, $after: String) {
  product(id: $id) {
    variants(first: $first, after: $after) {
      nodes { ${VARIANT_FIELDS} }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;

function gqlErrorText(r: GqlResult): string | null {
  if (r.status < 200 || r.status >= 300) return `API error ${r.status}: ${r.text.slice(0, 500)}`;
  const errs = r.body?.errors;
  if (Array.isArray(errs) && errs.length) return `GraphQL error: ${errs.map((e: any) => e?.message).join("; ")}`;
  return null;
}

type ReadResult = { ok: boolean; data?: { product: RestCompatProduct }; error?: string; needsReinstall?: boolean };

/**
 * Drop-in for `shopifyApiCall(shop, token, "products/{id}.json")` that returns
 * every variant (paginated) instead of REST's first 100.
 */
export async function getProductRestCompat(shop: string, token: string, productId: string | number): Promise<ReadResult> {
  const pid = numericShopifyId(productId);
  if (!pid) return { ok: false, error: "Invalid product id" };
  const id = `gid://shopify/Product/${pid}`;
  try {
    const first = await gql(shop, token, PRODUCT_QUERY, { id, first: VARIANT_PAGE_SIZE, after: null });
    if (first.status === 401 || first.status === 403) {
      return { ok: false, error: `API error ${first.status}`, needsReinstall: true };
    }
    const err = gqlErrorText(first);
    if (err) return { ok: false, error: err };
    const p = first.body?.data?.product;
    if (!p) return { ok: false, error: "API error 404: product not found" };

    const optionNames: string[] = [...(p.options ?? [])]
      .sort((a: any, b: any) => (a.position ?? 0) - (b.position ?? 0))
      .map((o: any) => String(o.name));
    const nodes: VariantNode[] = [...(p.variants?.nodes ?? [])];
    let pageInfo = p.variants?.pageInfo;
    while (pageInfo?.hasNextPage) {
      const next = await gql(shop, token, VARIANTS_PAGE_QUERY, { id, first: VARIANT_PAGE_SIZE, after: pageInfo.endCursor });
      const nextErr = gqlErrorText(next);
      if (nextErr) return { ok: false, error: nextErr };
      const conn = next.body?.data?.product?.variants;
      nodes.push(...(conn?.nodes ?? []));
      pageInfo = conn?.pageInfo;
    }

    const images = (p.media?.nodes ?? [])
      .filter((m: any) => m?.image?.url)
      .map((m: any, i: number) => ({ id: numericShopifyId(m.id), src: String(m.image.url), alt: m.alt ?? null, position: i + 1 }));

    return {
      ok: true,
      data: {
        product: {
          id: pid,
          title: p.title,
          handle: p.handle,
          status: String(p.status || "").toLowerCase(),
          published_at: p.publishedAt ?? null,
          body_html: p.descriptionHtml ?? "",
          variants: nodes
            .map((n) => restVariantFromNode(n, pid, optionNames))
            .sort((a, b) => a.position - b.position),
          images,
        },
      },
    };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Network error" };
  }
}

/**
 * Drop-in for REST `DELETE products/{id}.json`, which returns 422 on products with
 * more than 100 variants. 404 = already gone (callers treat it as success).
 */
export async function deleteProductRestCompat(
  shop: string,
  token: string,
  productId: string | number,
): Promise<{ ok: boolean; status: number; text: string }> {
  const pid = numericShopifyId(productId);
  if (!pid) return { ok: false, status: 400, text: "Invalid product id" };
  let r: GqlResult;
  try {
    r = await gql(shop, token, `mutation AppaiProductDelete($id: ID!) {
      productDelete(input: { id: $id }) { deletedProductId userErrors { field message } }
    }`, { id: `gid://shopify/Product/${pid}` });
  } catch (e: any) {
    return { ok: false, status: 502, text: e?.message || "Network error" };
  }
  if (r.status === 401 || r.status === 403) return { ok: false, status: r.status, text: r.text };
  const err = gqlErrorText(r);
  if (err) return { ok: false, status: r.status >= 400 ? r.status : 502, text: err };
  const payload = r.body?.data?.productDelete;
  if (payload?.deletedProductId) return { ok: true, status: 200, text: "" };
  const msgs = (payload?.userErrors ?? []).map((e: any) => String(e?.message || "")).join("; ");
  if (/not exist|not found|could not find/i.test(msgs)) return { ok: false, status: 404, text: msgs };
  return { ok: false, status: 422, text: msgs || "productDelete returned no id" };
}

/** Replaces REST `PUT products/{id}.json { body_html }` (REST product writes are capped at 100 variants). */
export async function updateProductDescriptionRestCompat(
  shop: string,
  token: string,
  productId: string | number,
  bodyHtml: string,
): Promise<{ ok: boolean; status: number; text: string }> {
  const pid = numericShopifyId(productId);
  if (!pid) return { ok: false, status: 400, text: "Invalid product id" };
  let r: GqlResult;
  try {
    r = await gql(shop, token, `mutation AppaiProductDescription($product: ProductUpdateInput!) {
      productUpdate(product: $product) { product { id } userErrors { field message } }
    }`, { product: { id: `gid://shopify/Product/${pid}`, descriptionHtml: bodyHtml } });
  } catch (e: any) {
    return { ok: false, status: 502, text: e?.message || "Network error" };
  }
  if (r.status === 401 || r.status === 403) return { ok: false, status: r.status, text: r.text };
  const err = gqlErrorText(r);
  if (err) return { ok: false, status: r.status >= 400 ? r.status : 502, text: err };
  const payload = r.body?.data?.productUpdate;
  if (payload?.product?.id) return { ok: true, status: 200, text: "" };
  const msgs = (payload?.userErrors ?? []).map((e: any) => String(e?.message || "")).join("; ");
  return { ok: false, status: 422, text: msgs || "productUpdate returned no product" };
}

/** Minimal fetch-Response surface the REST create call sites use. */
export type RestCompatResponse = {
  ok: boolean;
  status: number;
  text(): Promise<string>;
  json(): Promise<{ product: RestCompatProduct }>;
};

function compatResponse(status: number, payload: { product: RestCompatProduct } | null, errorText: string): RestCompatResponse {
  return {
    ok: status >= 200 && status < 300 && !!payload,
    status,
    text: async () => (payload ? JSON.stringify(payload) : errorText),
    json: async () => {
      if (!payload) throw new Error(errorText);
      return payload;
    },
  };
}

const PRODUCT_SET_MUTATION = `mutation AppaiProductSet($input: ProductSetInput!) {
  productSet(synchronous: true, input: $input) {
    product { id handle }
    userErrors { field message code }
  }
}`;

/**
 * Drop-in for `fetch(".../products.json", { method: "POST", body: { product } })` — pass the inner `product`.
 * Creates via synchronous `productSet`, then reads back every variant.
 */
export async function createProductRestCompat(
  shop: string,
  token: string,
  product: RestProductInput,
): Promise<RestCompatResponse> {
  const input = buildProductSetInput(product);
  const variantCount = Array.isArray((input as any).variants) ? (input as any).variants.length : 0;
  const t0 = Date.now();
  let r: GqlResult;
  try {
    r = await gql(shop, token, PRODUCT_SET_MUTATION, { input });
  } catch (e: any) {
    return compatResponse(502, null, e?.message || "Network error");
  }
  if (r.status === 401 || r.status === 403) return compatResponse(r.status, null, r.text);
  const err = gqlErrorText(r);
  if (err) return compatResponse(r.status >= 400 ? r.status : 502, null, err);
  const payload = r.body?.data?.productSet;
  const userErrors: Array<{ field?: unknown; message?: string }> = payload?.userErrors ?? [];
  if (userErrors.length > 0 || !payload?.product?.id) {
    return compatResponse(422, null, JSON.stringify({ errors: userErrors.length ? userErrors : "productSet returned no product" }));
  }

  const read = await getProductRestCompat(shop, token, payload.product.id);
  if (!read.ok || !read.data) {
    return compatResponse(502, null, `Product created (${payload.product.id}) but read-back failed: ${read.error}`);
  }
  console.log(
    `[ProductGQL] created ${read.data.product.id} variants=${read.data.product.variants.length}/${variantCount} ms=${Date.now() - t0}`,
  );
  return compatResponse(201, read.data, "");
}
