/**
 * Promote an approved catalogue candidate.
 *
 * Creates a published catalogue product. This is not createShopifyProductForType
 * (that helper makes an unlisted customizer base) and it is not a shadow SKU
 * (those are hidden and swept). A draft is the only held state, and only when
 * the operator unchecks Publish now.
 *
 * Printify is created first. If Shopify fails, the Printify product is deleted.
 */
import { and, eq } from "drizzle-orm";
import {
  PRINTIFY_FULL_BLEED,
  capRefusal,
  catalogueTags,
  catalogueVisibility,
  mockupAlt,
  mockupFileName,
  promoteRefusals,
  type CapOccupant,
} from "@shared/flywheelPromote";
import { requireProductVisibility, shopifyStatusForVisibility } from "@shared/productVisibility";
import { catalogueCandidateChoices, customizerPages, designCandidates, designProducts, productTypes, shippingStoreVariants } from "@shared/schema";
import { normalizeVariantKeyLoose, resolveVariantFromMap, type VariantMap } from "@shared/variantMapResolve";
import { getDesignProductLimit, getEffectivePlan } from "./customizer-plans";
import { db } from "./db";
import { uploadPrintFileToPrintify } from "./flat-print-file";
import { resolvePanelColour, type PanelColour } from "./mockup-library";
import { readChoice, readLibraryObject, signedLibraryUrl } from "./mockup-library-store";
import { assertProductTypeReadyToPromote } from "./promote-shipping";
import { normalizeMyshopifyShopDomain } from "./shopDomain";
import { attachVariantToShipping } from "./shipping-reconciler";
import {
  buildProductSetInput,
  deleteProductRestCompat,
} from "./shopify-product-graphql";
import { storage } from "./storage";

const PRINTIFY_API = "https://api.printify.com/v1";
const SHOPIFY_API = "2025-10";

export class PromoteRefusal extends Error {
  readonly status = 409;
  constructor(reasons: string[]) {
    super(reasons.join(" "));
    this.name = "PromoteRefusal";
  }
}

type SizeRow = { id: string; name: string };

function parseSizes(raw: unknown): SizeRow[] {
  const list = typeof raw === "string" ? JSON.parse(raw || "[]") : raw;
  if (!Array.isArray(list)) return [];
  return list
    .map((row) => ({ id: String(row?.id || "").trim(), name: String(row?.name || "").trim() }))
    .filter((row) => row.id && row.name);
}

function slug(value: string): string {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

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

export async function deletePrintifyProduct(shopId: string, productId: string, token: string): Promise<void> {
  const res = await fetch(`${PRINTIFY_API}/shops/${shopId}/products/${productId}.json`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(`Printify product ${productId} was left behind. Delete returned HTTP ${res.status}.`);
  }
}

async function colorMetaobjectId(shop: string, token: string, name: string, hex: string): Promise<string> {
  const found = await adminGql(
    shop,
    token,
    `query($q: String!) {
      metaobjects(type: "shopify--color-pattern", first: 10, query: $q) { nodes { id displayName } }
    }`,
    { q: `display_name:${name}` },
  );
  const existing = (found?.metaobjects?.nodes || []).find(
    (node: { displayName?: string }) => String(node.displayName || "").toLowerCase() === name.toLowerCase(),
  );
  if (existing?.id) return String(existing.id);
  const created = await adminGql(
    shop,
    token,
    `mutation($metaobject: MetaobjectCreateInput!) {
      metaobjectCreate(metaobject: $metaobject) { metaobject { id } userErrors { message } }
    }`,
    {
      metaobject: {
        type: "shopify--color-pattern",
        fields: [
          { key: "label", value: name },
          { key: "color", value: `#${hex.replace(/^#/, "")}` },
        ],
      },
    },
  );
  const errors = created?.metaobjectCreate?.userErrors || [];
  if (errors.length || !created?.metaobjectCreate?.metaobject?.id) {
    throw new Error(errors.map((err: { message?: string }) => err.message).join("; ") || `No swatch for ${name}`);
  }
  return String(created.metaobjectCreate.metaobject.id);
}

async function linkColourSwatches(
  shop: string,
  token: string,
  productGid: string,
  colours: Array<{ name: string; metaobjectId: string }>,
): Promise<void> {
  const product = await adminGql(
    shop,
    token,
    `query($id: ID!) { product(id: $id) { options { id name optionValues { id name } } } }`,
    { id: productGid },
  );
  const option = (product?.product?.options || []).find(
    (row: { name?: string }) => String(row.name || "").toLowerCase() === "color" || String(row.name || "").toLowerCase() === "colour",
  );
  if (!option?.id) throw new Error("The product has no colour option to link to a swatch.");
  const updates = colours.map((colour) => {
    const value = (option.optionValues || []).find(
      (row: { name?: string }) => String(row.name || "").toLowerCase() === colour.name.toLowerCase(),
    );
    if (!value?.id) throw new Error(`No colour option value for ${colour.name}.`);
    return { id: value.id, linkedMetafieldValue: colour.metaobjectId };
  });
  const linked = await adminGql(
    shop,
    token,
    `mutation($productId: ID!, $option: OptionUpdateInput!, $values: [OptionValueUpdateInput!]!) {
      productOptionUpdate(productId: $productId, option: $option, optionValuesToUpdate: $values) {
        userErrors { message }
      }
    }`,
    {
      productId: productGid,
      option: { id: option.id, linkedMetafield: { namespace: "shopify", key: "color-pattern" } },
      values: updates,
    },
  );
  const errors = linked?.productOptionUpdate?.userErrors || [];
  if (errors.length) throw new Error(errors.map((err: { message?: string }) => err.message).join("; "));
}

export async function promoteCatalogueCandidate(args: {
  candidateId: string;
  publishNow: boolean;
  productTypeId: number;
  pricesBySize: Record<string, string>;
}): Promise<{ shopifyProductId: string; printifyProductId: string; status: "active" | "draft" }> {
  const choice = await readChoice(args.candidateId);
  const [candidate] = await db.select().from(designCandidates).where(eq(designCandidates.id, args.candidateId)).limit(1);
  const [typeRow] = await db.select().from(productTypes).where(eq(productTypes.id, args.productTypeId)).limit(1);
  if (!typeRow) throw new PromoteRefusal([`Product type ${args.productTypeId} was not found.`]);

  const shop = String(typeRow.shopifyShopDomain || candidate?.shopDomain || "");
  const installation = shop ? await storage.getShopifyInstallationByShop(shop) : null;
  const merchant = typeRow.merchantId ? await storage.getMerchant(typeRow.merchantId) : null;

  const sizes = parseSizes(typeRow.sizes);
  const selectedIds: string[] = (() => {
    try {
      const raw = JSON.parse(typeRow.selectedSizeIds || "[]");
      return Array.isArray(raw) ? raw.map(String) : [];
    } catch {
      return [];
    }
  })();
  const offered = selectedIds.length ? sizes.filter((size) => selectedIds.includes(size.id)) : sizes;
  const missingPrices = offered.filter((size) => !args.pricesBySize[size.name]).map((size) => size.name);

  const ticked = choice.selectedColors.map((color) => color.name);
  const panelColours: string[] = [];
  if (choice.panelId) {
    const { mockupPanels } = await import("@shared/schema");
    const rows = await db
      .select({ garmentColor: mockupPanels.garmentColor, garmentHex: mockupPanels.garmentHex, kind: mockupPanels.kind })
      .from(mockupPanels)
      .where(and(eq(mockupPanels.productTypeId, args.productTypeId), eq(mockupPanels.panelId, choice.panelId)));
    const scene: PanelColour[] = rows.map((row) => ({
      name: row.garmentColor,
      hex: row.garmentHex,
      kind: row.kind === "white-master" ? "white-master" : "produced",
    }));
    for (const color of choice.selectedColors) {
      try {
        resolvePanelColour(scene, color, typeRow.name, args.productTypeId, choice.panelId);
        panelColours.push(color.name);
      } catch {
        // Named by promoteRefusals when the ticked colour is absent from the scene.
      }
    }
  }

  let shippingRefusal: string | null = null;
  if (shop) {
    try {
      await assertProductTypeReadyToPromote({
        shop,
        productTypeName: typeRow.name,
        variantIdMaps: [typeRow.shopifyVariantIds, typeRow.shopifyVariantIdsBoth],
      });
    } catch (err) {
      shippingRefusal = err instanceof Error ? err.message : String(err);
    }
  } else {
    shippingRefusal = `${typeRow.name} has no shop, so its variants cannot be placed on a delivery profile.`;
  }

  let capMessage: string | null = null;
  if (args.publishNow && installation) {
    const plan = getEffectivePlan(installation as any, shop);
    const limit = getDesignProductLimit(plan.planName);
    const occupants = await db
      .select({ title: designProducts.title, promotedAt: designProducts.createdAt })
      .from(designProducts)
      .where(and(eq(designProducts.shop, shop), eq(designProducts.status, "active")));
    const listed: CapOccupant[] = occupants.map((row) => ({
      title: row.title,
      promotedAt: row.promotedAt ? row.promotedAt.toISOString().slice(0, 10) : "unknown date",
    }));
    capMessage = capRefusal(limit, listed);
  }

  let categoryId: string | null = null;
  if (installation?.accessToken && shop) {
    const [page] = await db
      .select({ baseProductId: customizerPages.baseProductId })
      .from(customizerPages)
      .where(and(eq(customizerPages.productTypeId, typeRow.id), eq(customizerPages.shop, shop), eq(customizerPages.status, "active")))
      .limit(1);
    if (page?.baseProductId) {
      try {
        const data = await adminGql(
          shop,
          installation.accessToken,
          `query($id: ID!) { product(id: $id) { category { id } } }`,
          { id: `gid://shopify/Product/${page.baseProductId}` },
        );
        categoryId = data?.product?.category?.id ?? null;
      } catch (err) {
        throw new PromoteRefusal([err instanceof Error ? err.message : String(err)]);
      }
    }
  }

  const reasons = promoteRefusals({
    printFilePath: candidate?.printFilePath ?? null,
    panelId: choice.panelId,
    productTypeName: typeRow.name,
    tickedColours: ticked,
    panelColours: [...panelColours],
    storedMockupColours: choice.mockupImages.map((image) => image.name),
    title: candidate?.title ?? null,
    description: candidate?.description ?? null,
    artStyle: candidate?.artStyle ?? null,
    species: candidate?.species ?? null,
    humourOperator: candidate?.humourOperator ?? null,
    shippingRefusal,
    publishNow: args.publishNow,
    capMessage,
    missingPrices,
  });
  if (!categoryId) reasons.push("This product type has no product category on its studio product.");
  if (!merchant?.printifyApiToken || !merchant.printifyShopId) reasons.push("Printify is not connected on this product type.");
  if (!installation?.accessToken) reasons.push("Shopify is not connected for this shop.");
  if (!typeRow.printifyBlueprintId || !typeRow.printifyProviderId) reasons.push("This product type has no Printify blueprint.");
  if (reasons.length) throw new PromoteRefusal(reasons);

  const variantMap: VariantMap = JSON.parse(typeRow.variantMap || "{}");
  const printifyVariants: Array<{ id: number; price: number; is_enabled: boolean }> = [];
  const shopifyVariants: Array<{ option1: string; option2: string; price: string; sku: string; inventory_management: null; inventory_policy: string }> = [];
  const variantMeta: Array<{ sizeId: string; colorId: string; printifyVariantId: number; studioVariantId: string }> = [];
  const studioIds = typeof typeRow.shopifyVariantIds === "string"
    ? JSON.parse(typeRow.shopifyVariantIds || "{}")
    : (typeRow.shopifyVariantIds || {});
  const studioByLoose = new Map<string, string>();
  for (const [key, value] of Object.entries(studioIds as Record<string, unknown>)) {
    const id = String(value || "").replace(/\D/g, "");
    if (id) studioByLoose.set(normalizeVariantKeyLoose(key), id);
  }
  for (const color of choice.selectedColors) {
    const colorId = color.name.toLowerCase().replace(/\s+/g, "-");
    for (const size of offered) {
      const resolved = resolveVariantFromMap(variantMap, size.id, colorId, { allowSizeFallbackForColor: false });
      if (!resolved?.entry.printifyVariantId) {
        throw new PromoteRefusal([`${color.name} ${size.name} has no Printify variant on ${typeRow.name}.`]);
      }
      const price = args.pricesBySize[size.name];
      const printifyVariantId = Number(resolved.entry.printifyVariantId);
      printifyVariants.push({ id: printifyVariantId, price: Math.round(parseFloat(price) * 100), is_enabled: true });
      shopifyVariants.push({
        option1: size.name,
        option2: color.name,
        price,
        sku: `FW-${typeRow.id}-${size.id}-${colorId}`,
        inventory_management: null,
        inventory_policy: "continue",
      });
      const studioVariantId = studioByLoose.get(normalizeVariantKeyLoose(`${size.id}:${colorId}`))
        || studioByLoose.get(normalizeVariantKeyLoose(resolved.key))
        || "";
      variantMeta.push({ sizeId: size.id, colorId, printifyVariantId, studioVariantId });
    }
  }
  if (shopifyVariants.length > 100) {
    throw new PromoteRefusal([`Too many variants (${shopifyVariants.length}). Shopify allows 100 on this create.`]);
  }

  const title = String(candidate!.title);
  const description = String(candidate!.description);
  const tags = catalogueTags({
    artStyle: String(candidate!.artStyle),
    species: String(candidate!.species),
    humourOperator: String(candidate!.humourOperator),
  });
  const handle = slug(title) || "design";
  const visibility = requireProductVisibility("published");
  const shopifyStatus = shopifyStatusForVisibility(visibility, args.publishNow ? "publish" : "draft");
  const status = catalogueVisibility(args.publishNow);
  const printBuffer = await readLibraryObject(String(candidate!.printFilePath));
  const imageId = await uploadPrintFileToPrintify(merchant!.printifyApiToken!, `${handle}-front.png`, printBuffer);
  let printifyProductId = "";
  try {
    const created = await fetch(`${PRINTIFY_API}/shops/${merchant!.printifyShopId}/products.json`, {
      method: "POST",
      headers: { Authorization: `Bearer ${merchant!.printifyApiToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        title: title.slice(0, 250),
        description,
        blueprint_id: Number(typeRow.printifyBlueprintId),
        print_provider_id: Number(typeRow.printifyProviderId),
        variants: printifyVariants,
        print_areas: [{
          variant_ids: printifyVariants.map((variant) => variant.id),
          placeholders: [{
            position: "front",
            images: [{ id: imageId, ...PRINTIFY_FULL_BLEED, angle: 0 }],
          }],
        }],
        tags,
      }),
    });
    const text = await created.text();
    const body = text ? JSON.parse(text) : {};
    if (!created.ok || !body?.id) {
      throw new Error(`Printify rejected the product (${created.status}): ${text.slice(0, 200)}`);
    }
    printifyProductId = String(body.id);
  } catch (err) {
    throw new PromoteRefusal([err instanceof Error ? err.message : String(err)]);
  }

  const images = [];
  try {
    for (const color of choice.selectedColors) {
      const stored = choice.mockupImages.find((image) => image.name === color.name);
      if (!stored) throw new PromoteRefusal([`No stored mockup for ${color.name}.`]);
      images.push({
        src: await signedLibraryUrl(stored.path),
        alt: mockupAlt(title, color.name),
        filename: mockupFileName(handle, color.name),
      });
    }
  } catch (err) {
    await deletePrintifyProduct(String(merchant!.printifyShopId), printifyProductId, merchant!.printifyApiToken!);
    throw err instanceof PromoteRefusal ? err : new PromoteRefusal([err instanceof Error ? err.message : String(err)]);
  }

  const input = buildProductSetInput({
    title,
    body_html: description,
    vendor: merchant!.storeName || "Petposterous",
    product_type: typeRow.name,
    status: shopifyStatus,
    tags,
    options: [
      { name: "Size", values: [...new Set(shopifyVariants.map((variant) => variant.option1))] },
      { name: "Color", values: choice.selectedColors.map((color) => color.name) },
    ],
    variants: shopifyVariants,
    metafields: [{
      namespace: "ai_art_studio",
      key: "design_candidate_id",
      type: "single_line_text_field",
      value: args.candidateId,
    }],
  }) as Record<string, unknown>;
  input.handle = handle;
  input.category = categoryId;
  input.files = images.map((image) => ({
    originalSource: image.src,
    alt: image.alt,
    filename: image.filename,
    contentType: "IMAGE",
  }));

  let shopifyProductId = "";
  let createdVariants: Array<{ id: number; option1: string | null; option2: string | null }> = [];
  try {
    const data = await adminGql(
      shop,
      installation!.accessToken,
      `mutation($input: ProductSetInput!) {
        productSet(synchronous: true, input: $input) {
          product { id handle }
          userErrors { message }
        }
      }`,
      { input },
    );
    const errors = data?.productSet?.userErrors || [];
    if (errors.length || !data?.productSet?.product?.id) {
      throw new Error(errors.map((err: { message?: string }) => err.message).join("; ") || "Shopify returned no product");
    }
    shopifyProductId = String(data.productSet.product.id).replace(/\D/g, "");
    const read = await adminGql(
      shop,
      installation!.accessToken,
      `query($id: ID!) { product(id: $id) { variants(first: 100) { nodes { id selectedOptions { name value } } } } }`,
      { id: data.productSet.product.id },
    );
    createdVariants = (read?.product?.variants?.nodes || []).map((node: { id: string; selectedOptions: Array<{ name: string; value: string }> }) => ({
      id: Number(String(node.id).replace(/\D/g, "")),
      option1: node.selectedOptions.find((option) => option.name === "Size")?.value ?? null,
      option2: node.selectedOptions.find((option) => option.name === "Color")?.value ?? null,
    }));
    const swatches = [];
    for (const color of choice.selectedColors) {
      swatches.push({ name: color.name, metaobjectId: await colorMetaobjectId(shop, installation!.accessToken, color.name, color.hex) });
    }
    await linkColourSwatches(shop, installation!.accessToken, data.productSet.product.id, swatches);
  } catch (err) {
    if (shopifyProductId) {
      await deleteProductRestCompat(shop, installation!.accessToken, shopifyProductId);
    }
    await deletePrintifyProduct(String(merchant!.printifyShopId), printifyProductId, merchant!.printifyApiToken!);
    throw new PromoteRefusal([err instanceof Error ? err.message : String(err)]);
  }

  const variantMapOut: Record<string, { sizeId: string; colorId: string; printifyVariantId: number }> = {};
  const matched: Array<{ createdId: string; studioVariantId: string }> = [];
  for (const meta of variantMeta) {
    const sizeName = offered.find((size) => size.id === meta.sizeId)?.name;
    const colourName = choice.selectedColors.find((color) => color.name.toLowerCase().replace(/\s+/g, "-") === meta.colorId)?.name;
    const created = createdVariants.find((variant) => variant.option1 === sizeName && variant.option2 === colourName);
    if (!created || !meta.studioVariantId) {
      await deleteProductRestCompat(shop, installation!.accessToken, shopifyProductId);
      await deletePrintifyProduct(String(merchant!.printifyShopId), printifyProductId, merchant!.printifyApiToken!);
      throw new PromoteRefusal([`Could not match a Shopify variant for ${meta.sizeId} ${meta.colorId} onto the studio shipping profile.`]);
    }
    variantMapOut[String(created.id)] = { sizeId: meta.sizeId, colorId: meta.colorId, printifyVariantId: meta.printifyVariantId };
    matched.push({ createdId: String(created.id), studioVariantId: meta.studioVariantId });
  }

  const [designProduct] = await db.insert(designProducts).values({
    merchantId: String(typeRow.merchantId),
    shop,
    jobId: args.candidateId,
    productTypeId: typeRow.id,
    shopifyProductId,
    printifyProductId,
    handle,
    title,
    status: status === "active" ? "active" : "inactive",
    variantMap: variantMapOut,
    mockupUrls: images.map((image) => image.filename),
  }).returning({ id: designProducts.id });

  const rollback = async () => {
    if (designProduct?.id) {
      await db.delete(designProducts).where(eq(designProducts.id, designProduct.id));
    }
    await deleteProductRestCompat(shop, installation!.accessToken, shopifyProductId);
    await deletePrintifyProduct(String(merchant!.printifyShopId), printifyProductId, merchant!.printifyApiToken!);
  };

  try {
    const shopDomain = normalizeMyshopifyShopDomain(shop);
    for (const row of matched) {
      await attachVariantToShipping({
        shop,
        shopifyVariantId: row.createdId,
        sourceVariantId: row.studioVariantId,
        source: "shadow",
      });
      const [member] = await db
        .select({ shopifyVariantId: shippingStoreVariants.shopifyVariantId })
        .from(shippingStoreVariants)
        .where(and(eq(shippingStoreVariants.shopDomain, shopDomain), eq(shippingStoreVariants.shopifyVariantId, row.createdId)))
        .limit(1);
      if (!member) {
        throw new Error(`Variant ${row.createdId} was left on the General delivery profile.`);
      }
    }
    const now = new Date();
    await db.update(designCandidates).set({
      status: status === "active" ? "promoted" : "draft",
      shopifyProductId,
      printifyProductId,
      designProductId: designProduct?.id ?? null,
      updatedAt: now,
    }).where(eq(designCandidates.id, args.candidateId));
    await db.update(catalogueCandidateChoices).set({
      shopifyProductId,
      printifyProductId,
      updatedAt: now,
    }).where(eq(catalogueCandidateChoices.candidateId, args.candidateId));
  } catch (err) {
    await rollback();
    throw err instanceof PromoteRefusal ? err : new PromoteRefusal([err instanceof Error ? err.message : String(err)]);
  }

  return { shopifyProductId, printifyProductId, status };
}
