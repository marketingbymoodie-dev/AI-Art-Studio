/**
 * Add or remove colours on one already-published design product.
 * Shopify variants are created or deleted on that product. Printify variants
 * are enabled or disabled on that Printify product. No second product is created.
 */
import { and, eq, inArray } from "drizzle-orm";
import { SOFTSTYLE_CATALOGUE_PRICES } from "@shared/softstyleCataloguePrices";
import { diffColourNames, scenesMissingApprovedBlank, colourKey, type SceneBlank } from "@shared/designColourEdit";
import { printifyColorIdForMockup } from "@shared/mockupBundle";
import { slugPrintifyColorId } from "@shared/printifyColorSlug";
import { mockupAlt } from "@shared/flywheelPromote";
import { normalizeVariantKeyLoose, resolveVariantFromMap, type VariantMap } from "@shared/variantMapResolve";
import { desiredInventoryPolicy } from "./catalogue-inventory-policy";
import { db, pool } from "./db";
import { listScenes, readChoice, signedLibraryUrl, storeCandidateColourMockup } from "./mockup-library-store";
import { blankLibraryTypeId } from "./colour-blanks";
import { colourPatternMetaobjectId } from "./flywheel-promote";
import { attachVariantToShipping } from "./shipping-reconciler";
import { normalizeMyshopifyShopDomain } from "./shopDomain";
import { paceVendor, shopifyThrottled, vendorRetryDelayMs } from "./vendor-backoff";
import { storage } from "./storage";
import {
  designCandidates,
  designProducts,
  productTypes,
  shippingStoreVariants,
} from "@shared/schema";

const SHOPIFY_API = "2025-10";
const PRINTIFY_API = "https://api.printify.com/v1";

export class ColourEditRefusal extends Error {
  readonly reasons: string[];
  constructor(reasons: string[]) {
    const list = reasons.map((reason) => String(reason || "").trim()).filter(Boolean);
    super(list.join("\n") || "Colour edit stopped");
    this.name = "ColourEditRefusal";
    this.reasons = list.length ? list : ["Colour edit stopped"];
  }
}

export type ColourChoice = { name: string; hex: string; live: boolean };

export type ColourEditPlan = {
  designProductId: string;
  title: string;
  shop: string;
  shopifyProductId: string;
  printifyProductId: string;
  colours: ColourChoice[];
  add: Array<{ name: string; variants: number }>;
  remove: Array<{ name: string; variants: number }>;
  mockupsToMake: string[];
  warnings: string[];
  blockers: string[];
};

type SizeRow = { id: string; name: string };
type FrameColour = { id: string; name: string; hex: string };
type LiveVariant = { shopifyVariantId: string; sizeId: string; colorId: string; printifyVariantId: number };
type ShopifyVariant = { id: string; price: string; compareAt: string; size: string; colour: string; extra: string };
type AddVariant = {
  sizeId: string;
  sizeName: string;
  colorId: string;
  colourName: string;
  hex: string;
  printifyVariantId: number;
  price: string;
  compareAt: string;
  studioVariantId: string;
  policy: "CONTINUE" | "DENY";
};

type Work = {
  plan: ColourEditPlan;
  shop: string;
  token: string;
  printifyToken: string;
  printifyShopId: string;
  productTypeId: number;
  typeName: string;
  panelId: string;
  artworkPath: string;
  candidateId: string;
  handle: string;
  optionNames: { size: string; colour: string };
  colourOptionLinked: boolean;
  add: Array<{ name: string; hex: string; variants: AddVariant[] }>;
  remove: Array<{ name: string; colorId: string; shopifyVariantIds: string[]; printifyVariantIds: number[] }>;
};

function parseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw === "string") {
    try { return JSON.parse(raw) as T; } catch { return fallback; }
  }
  return (raw as T) ?? fallback;
}

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
    if (!res.ok || json?.errors?.length) {
      const message = json?.errors?.map((err: { message?: string }) => err.message).filter(Boolean).join("; ");
      throw new Error(message || `Shopify HTTP ${res.status}`);
    }
    return json.data;
  }
}

async function printifyJson(token: string, method: string, path: string, body?: unknown) {
  for (let attempt = 0; ; attempt++) {
    await paceVendor("printify");
    const res = await fetch(`${PRINTIFY_API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const delay = vendorRetryDelayMs(res.status, res.headers.get("retry-after"), attempt);
    if (delay != null) {
      await res.arrayBuffer().catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, delay));
      continue;
    }
    const text = await res.text();
    if (!res.ok) throw new Error(`Printify ${method} ${path} failed (${res.status}): ${text.slice(0, 240)}`);
    return text ? JSON.parse(text) : {};
  }
}

function gid(kind: "Product" | "ProductVariant", id: string): string {
  const numeric = String(id).replace(/\D/g, "");
  return `gid://shopify/${kind}/${numeric}`;
}

function numericId(id: string): string {
  return String(id || "").replace(/\D/g, "");
}

function colourIdFor(color: { name: string; hex: string }, frame: FrameColour[], catalogIds: Set<string>): string {
  const fromHex = printifyColorIdForMockup(color.hex);
  const slug = fromHex?.colorId || slugPrintifyColorId(color.name);
  if (catalogIds.has(slug)) return slug;
  const named = frame.find((row) =>
    row.id === slug
    || slugPrintifyColorId(row.id) === slug
    || slugPrintifyColorId(row.name) === slug
    || colourKey(row.name) === colourKey(color.name),
  );
  return named && catalogIds.has(named.id) ? named.id : "";
}

function studioVariantId(ids: Record<string, unknown>, sizeName: string, colourName: string, sizeId: string, colorId: string): string {
  const loose = new Map<string, string>();
  for (const [label, value] of Object.entries(ids)) {
    if (value != null) loose.set(normalizeVariantKeyLoose(label), numericId(String(value)));
  }
  for (const key of [`${sizeName}:${colourName}`, `${sizeId}:${colorId}`, `${sizeId}:${colourName}`]) {
    const hit = loose.get(normalizeVariantKeyLoose(key));
    if (hit) return hit;
  }
  return "";
}

async function readShopifyVariants(shop: string, token: string, productId: string): Promise<{ variants: ShopifyVariant[]; sizeOption: string; colourOption: string; colourOptionLinked: boolean }> {
  const data = await adminGql(shop, token, `query($id: ID!) {
    product(id: $id) {
      options { name linkedMetafield { namespace key } }
      variants(first: 100) {
        nodes { id price compareAtPrice selectedOptions { name value } }
      }
    }
  }`, { id: gid("Product", productId) });
  const product = data?.product;
  if (!product) throw new Error("Shopify did not return this design's product.");
  const options = (product.options || []) as Array<{ name?: string; linkedMetafield?: { namespace?: string; key?: string } | null }>;
  const optionNames = options.map((option) => String(option.name || ""));
  const sizeOption = optionNames.find((name: string) => /^size$/i.test(name)) || "Size";
  const colourOption = optionNames.find((name: string) => /^colou?r$/i.test(name)) || "Color";
  const colourRow = options.find((option) => String(option.name || "") === colourOption);
  const colourOptionLinked = Boolean(colourRow?.linkedMetafield?.namespace && colourRow?.linkedMetafield?.key);
  const extraOption = optionNames.find((name: string) => name !== sizeOption && name !== colourOption);
  if (extraOption) {
    throw new ColourEditRefusal([`This product has a ${extraOption} option. Colour edit changes Size and Color only.`]);
  }
  const variants: ShopifyVariant[] = (product.variants?.nodes || []).map((node: {
    id: string;
    price: string;
    compareAtPrice: string | null;
    selectedOptions: Array<{ name: string; value: string }>;
  }) => ({
    id: numericId(node.id),
    price: String(node.price || ""),
    compareAt: String(node.compareAtPrice || ""),
    size: node.selectedOptions.find((option) => option.name === sizeOption)?.value || "",
    colour: node.selectedOptions.find((option) => option.name === colourOption)?.value || "",
    extra: "",
  }));
  return { variants, sizeOption, colourOption, colourOptionLinked };
}

async function openOrderWarnings(shop: string, token: string, variantIds: Set<string>, colourName: string): Promise<string[]> {
  const warnings: string[] = [];
  try {
    const data = await adminGql(shop, token, `query {
      orders(first: 40, query: "status:open") {
        nodes { name lineItems(first: 80) { nodes { variant { id } } } }
      }
    }`);
    const names: string[] = [];
    for (const order of data?.orders?.nodes || []) {
      const hit = (order.lineItems?.nodes || []).some((line: { variant?: { id?: string } }) => variantIds.has(numericId(String(line.variant?.id || ""))));
      if (hit) names.push(String(order.name || "an open order"));
    }
    if (names.length) warnings.push(`${colourName} is on ${names.slice(0, 5).join(", ")}.`);
  } catch (err) {
    warnings.push(`Open orders for ${colourName} could not be checked (${err instanceof Error ? err.message : String(err)}).`);
  }
  try {
    const data = await adminGql(shop, token, `query {
      abandonedCheckouts(first: 30) {
        nodes { name lineItems(first: 40) { nodes { variant { id } } } }
      }
    }`);
    let carts = 0;
    for (const cart of data?.abandonedCheckouts?.nodes || []) {
      const hit = (cart.lineItems?.nodes || []).some((line: { variant?: { id?: string } }) => variantIds.has(numericId(String(line.variant?.id || ""))));
      if (hit) carts += 1;
    }
    if (carts) warnings.push(`${colourName} is in ${carts} abandoned cart${carts === 1 ? "" : "s"}.`);
  } catch {
    // Abandoned-checkout access is optional. Recent cart events below still count.
  }
  return warnings;
}

async function recentCartWarning(designProductId: string, variantIds: Set<string>, colourName: string): Promise<string | null> {
  const rows = await pool.query<{ cart_token: string }>(
    `SELECT cart_token FROM design_product_events
      WHERE design_product_id = $1 AND event_type = 'atc' AND created_at > now() - interval '14 days'`,
    [designProductId],
  );
  const hits = rows.rows.filter((row) => {
    const token = String(row.cart_token || "");
    const variantId = token.slice(token.lastIndexOf(":") + 1);
    return variantIds.has(variantId);
  });
  if (!hits.length) return null;
  return `${colourName} was added to ${hits.length} cart${hits.length === 1 ? "" : "s"} in the last 14 days.`;
}

async function loadWork(designProductId: string, wantedNames: string[] | null, shopLimit?: string): Promise<Work> {
  const [product] = await db.select().from(designProducts).where(eq(designProducts.id, designProductId)).limit(1);
  if (!product) throw new ColourEditRefusal(["That design product was not found."]);
  const shop = normalizeMyshopifyShopDomain(product.shop);
  if (shopLimit && normalizeMyshopifyShopDomain(shopLimit) !== shop) {
    throw new ColourEditRefusal(["That design belongs to another shop."]);
  }
  if (!product.shopifyProductId || !product.printifyProductId || !product.productTypeId) {
    throw new ColourEditRefusal(["This design is not a published Shopify and Printify product."]);
  }
  const [typeRow] = await db.select().from(productTypes).where(eq(productTypes.id, product.productTypeId)).limit(1);
  if (!typeRow) throw new ColourEditRefusal(["This design's product type was not found."]);
  const installation = await storage.getShopifyInstallationByShop(shop);
  if (!installation?.accessToken) throw new ColourEditRefusal(["Shopify is not connected for this shop."]);
  const { cataloguePrintifyMerchant } = await import("./operatorCatalogue");
  const merchant = await cataloguePrintifyMerchant(typeRow.merchantId, shop);
  if (!merchant?.printifyApiToken || !merchant.printifyShopId) {
    throw new ColourEditRefusal(["Printify is not connected for this product type."]);
  }

  const frame = parseJson<FrameColour[]>(typeRow.frameColors, []);
  const sizes = parseJson<SizeRow[]>(typeRow.sizes, []);
  const selectedSizeIds = parseJson<string[]>(typeRow.selectedSizeIds, []);
  const offered = selectedSizeIds.length ? sizes.filter((size) => selectedSizeIds.includes(size.id)) : sizes;
  const catalog = parseJson<VariantMap>(typeRow.variantMap, {});
  const catalogIds = new Set<string>();
  for (const key of Object.keys(catalog)) {
    const colorId = key.slice(key.indexOf(":") + 1);
    if (colorId) catalogIds.add(colorId);
  }
  const studioIds = parseJson<Record<string, unknown>>(typeRow.shopifyVariantIds, {});
  const availability = parseJson<Record<string, string>>(typeRow.variantAvailability, {});
  const liveMap = parseJson<Record<string, { sizeId?: string; colorId?: string; printifyVariantId?: number }>>(product.variantMap, {});
  const liveVariants: LiveVariant[] = Object.entries(liveMap).map(([shopifyVariantId, entry]) => ({
    shopifyVariantId: numericId(shopifyVariantId),
    sizeId: String(entry?.sizeId || ""),
    colorId: String(entry?.colorId || ""),
    printifyVariantId: Number(entry?.printifyVariantId),
  })).filter((row) => row.shopifyVariantId && row.colorId);

  const frameById = new Map(frame.map((color) => [color.id, color]));
  const liveColorIds = [...new Set(liveVariants.map((row) => row.colorId))];
  const liveNames = liveColorIds.map((id) => frameById.get(id)?.name || id);
  const colours: ColourChoice[] = frame
    .filter((color) => color.name && color.hex)
    .map((color) => ({ name: color.name, hex: color.hex, live: liveColorIds.includes(color.id) }));
  for (const id of liveColorIds) {
    if (!frame.some((color) => color.id === id)) {
      colours.push({ name: frameById.get(id)?.name || id, hex: frameById.get(id)?.hex || "999999", live: true });
    }
  }

  const wanted = (wantedNames ?? liveNames).map((name) => name.trim()).filter(Boolean);
  const wantedResolved = wanted.map((name) => {
    const color = frame.find((row) => colourKey(row.name) === colourKey(name));
    return { name: color?.name || name, hex: color?.hex || "", colorId: color ? colourIdFor(color, frame, catalogIds) : "" };
  });
  const { add, remove } = diffColourNames(liveNames, wantedResolved.map((color) => color.name));
  const blockers: string[] = [];
  const warnings: string[] = [];
  if (liveNames.length - remove.length + add.length <= 0) blockers.push("Keep at least one colour.");

  const libraryId = await blankLibraryTypeId(typeRow.id);
  const scenes = await listScenes(libraryId);
  const blanks: SceneBlank[] = scenes.map((scene) => ({
    panelId: scene.panelId,
    label: scene.label,
    colours: scene.colours.map((colour) => ({ name: colour.name, kind: colour.kind })),
  }));
  const [candidate] = await db.select().from(designCandidates).where(eq(designCandidates.id, product.jobId)).limit(1);
  const choice = candidate ? await readChoice(product.jobId) : null;
  const panelId = String(choice?.panelId || candidate?.panelId || blanks.find((scene) => scene.panelId)?.panelId || "");
  const artworkPath = String(choice?.artworkPath || candidate?.artworkPath || "");

  let shopify: { variants: ShopifyVariant[]; sizeOption: string; colourOption: string; colourOptionLinked: boolean };
  try {
    shopify = await readShopifyVariants(shop, installation.accessToken, product.shopifyProductId);
  } catch (err) {
    if (err instanceof ColourEditRefusal) throw err;
    throw new ColourEditRefusal([err instanceof Error ? err.message : String(err)]);
  }
  if (shopify.variants.length && shopify.variants.length >= 100 && add.length) {
    blockers.push("This product already has 100 Shopify variants.");
  }

  const addWork: Work["add"] = [];
  for (const name of add) {
    const color = wantedResolved.find((row) => colourKey(row.name) === colourKey(name));
    if (!color?.colorId) {
      blockers.push(`${name} is not a colour on ${typeRow.name}.`);
      continue;
    }
    const missing = scenesMissingApprovedBlank(blanks, color.name);
    if (missing.length) {
      blockers.push(`${color.name} has no approved blank on ${missing.map((scene) => scene.label).join(", ")}.`);
      continue;
    }
    if (!panelId || !artworkPath) {
      blockers.push(`${color.name} needs the design's scene and artwork before a mockup can be made.`);
      continue;
    }
    const variants: AddVariant[] = [];
    for (const size of offered) {
      const resolved = resolveVariantFromMap(catalog, size.id, color.colorId, { allowSizeFallbackForColor: false });
      const printifyVariantId = Number(resolved?.entry.printifyVariantId);
      if (!printifyVariantId) {
        blockers.push(`${color.name} ${size.name} has no Printify variant on ${typeRow.name}.`);
        continue;
      }
      const table = SOFTSTYLE_CATALOGUE_PRICES[size.name];
      const sibling = shopify.variants.find((row) => row.size === size.name && Number(row.price) > 0);
      const price = table?.price || (sibling ? Number(sibling.price).toFixed(2) : "");
      if (!price || price === "0.00") {
        blockers.push(`${color.name} ${size.name} has no price.`);
        continue;
      }
      const studio = studioVariantId(studioIds, size.name, color.name, size.id, color.colorId);
      if (!studio) blockers.push(`${color.name} ${size.name} has no studio variant to copy a delivery profile from.`);
      const availabilityKey = `${size.id}:${color.colorId}`;
      variants.push({
        sizeId: size.id,
        sizeName: size.name,
        colorId: color.colorId,
        colourName: color.name,
        hex: color.hex,
        printifyVariantId,
        price,
        compareAt: table?.compareAtPrice || sibling?.compareAt || "",
        studioVariantId: studio,
        policy: desiredInventoryPolicy(availability[availabilityKey]) || "CONTINUE",
      });
    }
    addWork.push({ name: color.name, hex: color.hex, variants });
  }

  const removeWork: Work["remove"] = [];
  for (const name of remove) {
    const colorId = liveColorIds.find((id) => colourKey(frameById.get(id)?.name || id) === colourKey(name)) || "";
    const rows = liveVariants.filter((row) => row.colorId === colorId);
    const ids = new Set(rows.map((row) => row.shopifyVariantId));
    warnings.push(...await openOrderWarnings(shop, installation.accessToken, ids, name));
    const cart = await recentCartWarning(product.id, ids, name);
    if (cart) warnings.push(cart);
    removeWork.push({
      name,
      colorId,
      shopifyVariantIds: rows.map((row) => row.shopifyVariantId),
      printifyVariantIds: [...new Set(rows.map((row) => row.printifyVariantId).filter((id) => Number.isFinite(id) && id > 0))],
    });
  }

  const mockupsToMake = addWork.filter((row) => row.variants.length).map((row) => row.name);
  const plan: ColourEditPlan = {
    designProductId: product.id,
    title: product.title,
    shop,
    shopifyProductId: String(product.shopifyProductId),
    printifyProductId: String(product.printifyProductId),
    colours,
    add: addWork.map((row) => ({ name: row.name, variants: row.variants.length })),
    remove: removeWork.map((row) => ({ name: row.name, variants: row.shopifyVariantIds.length })),
    mockupsToMake,
    warnings,
    blockers,
  };
  return {
    plan,
    shop,
    token: installation.accessToken,
    printifyToken: merchant.printifyApiToken,
    printifyShopId: String(merchant.printifyShopId),
    productTypeId: typeRow.id,
    typeName: typeRow.name,
    panelId,
    artworkPath,
    candidateId: product.jobId,
    handle: String(product.handle || "design"),
    optionNames: { size: shopify.sizeOption, colour: shopify.colourOption },
    colourOptionLinked: shopify.colourOptionLinked,
    add: addWork,
    remove: removeWork,
  };
}

export async function readDesignColourChoices(designProductId: string, shopLimit?: string): Promise<ColourEditPlan> {
  const work = await loadWork(designProductId, null, shopLimit);
  return { ...work.plan, add: [], remove: [], mockupsToMake: [], warnings: [], blockers: [] };
}

export async function planDesignColourEdit(designProductId: string, wantedNames: string[], shopLimit?: string): Promise<ColourEditPlan> {
  return (await loadWork(designProductId, wantedNames, shopLimit)).plan;
}

async function setPrintifyEnabled(work: Work, variantIds: number[], enabled: boolean) {
  if (!variantIds.length) return;
  const product = await printifyJson(work.printifyToken, "GET", `/shops/${work.printifyShopId}/products/${work.plan.printifyProductId}.json`);
  const wanted = new Set(variantIds);
  const variants = (product.variants || []).map((variant: { id: number; price: number; is_enabled: boolean }) => ({
    id: variant.id,
    price: variant.price,
    is_enabled: wanted.has(Number(variant.id)) ? enabled : Boolean(variant.is_enabled),
  }));
  const known = new Set(variants.map((variant: { id: number }) => Number(variant.id)));
  const missing = variantIds.filter((id) => !known.has(id));
  if (missing.length) throw new ColourEditRefusal([`Printify product ${work.plan.printifyProductId} has no variant ${missing.join(", ")}.`]);
  const areas = (product.print_areas || []).map((area: { variant_ids?: number[]; placeholders?: Array<{ position?: string; images?: Array<Record<string, unknown>> }> }) => {
    const current = new Set((area.variant_ids || []).map(Number));
    // Printify requires every product variant id to stay in print_areas.
    // Disabling a colour only flips is_enabled.
    if (enabled) {
      for (const id of variantIds) current.add(id);
    }
    const placeholders = (area.placeholders || []).flatMap((placeholder) => {
      const images = (placeholder.images || []).flatMap((image) => {
        if (!image?.id) return [];
        return [{ id: image.id, x: image.x, y: image.y, scale: image.scale, angle: image.angle }];
      });
      if (!images.length || !placeholder.position) return [];
      return [{ position: placeholder.position, images }];
    });
    return { variant_ids: [...current], placeholders };
  });
  await printifyJson(work.printifyToken, "PUT", `/shops/${work.printifyShopId}/products/${work.plan.printifyProductId}.json`, {
    variants,
    print_areas: areas,
  });
}

async function linkedColourOptionValueId(work: Work, colourName: string, hex: string): Promise<string> {
  const { missingShopifyBaseColourMessage } = await import("@shared/flywheelPromote");
  const { resolvedShopifyBaseColor, shopifyBaseColorsByName } = await import("./colour-blanks");
  const baseColor = resolvedShopifyBaseColor(colourName, await shopifyBaseColorsByName(work.productTypeId));
  if (!baseColor) {
    throw new ColourEditRefusal([missingShopifyBaseColourMessage([colourName]) || `${colourName} has no Shopify base colour.`]);
  }
  const metaobjectId = await colourPatternMetaobjectId(work.shop, work.token, colourName, hex, baseColor);
  const productId = gid("Product", work.plan.shopifyProductId);
  const readOption = async () => {
    const data = await adminGql(work.shop, work.token, `query($id: ID!) {
      product(id: $id) {
        options { id name optionValues { id name linkedMetafieldValue } }
      }
    }`, { id: productId });
    return (data?.product?.options || []).find((row: { name?: string }) => String(row.name || "") === work.optionNames.colour) as {
      id?: string;
      optionValues?: Array<{ id?: string; name?: string; linkedMetafieldValue?: string | null }>;
    } | undefined;
  };
  const existing = await readOption();
  if (!existing?.id) throw new ColourEditRefusal([`This product has no ${work.optionNames.colour} option.`]);
  const matchOf = (option: typeof existing) => (option?.optionValues || []).find((row) =>
    String(row.name || "").toLowerCase() === colourName.toLowerCase()
    || String(row.linkedMetafieldValue || "") === metaobjectId);
  const already = matchOf(existing);
  if (already?.id) return already.id;
  const updated = await adminGql(work.shop, work.token, `mutation($productId: ID!, $option: OptionUpdateInput!, $values: [OptionValueCreateInput!]!) {
    productOptionUpdate(productId: $productId, option: $option, optionValuesToAdd: $values) {
      product { options { id name optionValues { id name linkedMetafieldValue } } }
      userErrors { message }
    }
  }`, {
    productId,
    option: { id: existing.id },
    values: [{ linkedMetafieldValue: metaobjectId }],
  });
  const errors = updated?.productOptionUpdate?.userErrors || [];
  if (errors.length) throw new ColourEditRefusal([errors.map((err: { message?: string }) => err.message).filter(Boolean).join("; ") || `Shopify did not add ${colourName}.`]);
  const option = (updated?.productOptionUpdate?.product?.options || []).find((row: { name?: string }) => String(row.name || "") === work.optionNames.colour);
  const added = matchOf(option) || matchOf(await readOption());
  if (!added?.id) throw new ColourEditRefusal([`Shopify did not return the ${colourName} option value.`]);
  return added.id;
}

async function createShopifyVariants(work: Work, variants: AddVariant[]): Promise<Array<{ id: string; size: string; colour: string }>> {
  const colourValueIds = new Map<string, string>();
  if (work.colourOptionLinked) {
    for (const variant of variants) {
      const key = colourKey(variant.colourName);
      if (colourValueIds.has(key)) continue;
      colourValueIds.set(key, await linkedColourOptionValueId(work, variant.colourName, variant.hex));
    }
  }
  const created = await adminGql(work.shop, work.token, `mutation($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkCreate(productId: $productId, variants: $variants) {
      productVariants { id selectedOptions { name value } }
      userErrors { message }
    }
  }`, {
    productId: gid("Product", work.plan.shopifyProductId),
    variants: variants.map((variant) => {
      const colourValueId = colourValueIds.get(colourKey(variant.colourName));
      return {
        price: variant.price,
        ...(variant.compareAt ? { compareAtPrice: variant.compareAt } : {}),
        inventoryPolicy: variant.policy,
        inventoryItem: { tracked: false },
        optionValues: [
          { optionName: work.optionNames.size, name: variant.sizeName },
          colourValueId
            ? { optionName: work.optionNames.colour, id: colourValueId }
            : { optionName: work.optionNames.colour, name: variant.colourName },
        ],
      };
    }),
  });
  const errors = created?.productVariantsBulkCreate?.userErrors || [];
  if (errors.length) throw new ColourEditRefusal([errors.map((err: { message?: string }) => err.message).filter(Boolean).join("; ") || "Shopify did not add the variants."]);
  return (created?.productVariantsBulkCreate?.productVariants || []).map((node: { id: string; selectedOptions: Array<{ name: string; value: string }> }) => ({
    id: numericId(node.id),
    size: node.selectedOptions.find((option) => option.name === work.optionNames.size)?.value || "",
    colour: node.selectedOptions.find((option) => option.name === work.optionNames.colour)?.value || "",
  }));
}

async function colourMedia(work: Work, colourName: string): Promise<string[]> {
  const alt = mockupAlt(work.plan.title, colourName);
  const data = await adminGql(work.shop, work.token, `query($id: ID!) {
    product(id: $id) { media(first: 50) { nodes { id alt } } }
  }`, { id: gid("Product", work.plan.shopifyProductId) });
  return (data?.product?.media?.nodes || [])
    .filter((node: { alt?: string | null }) => String(node.alt || "") === alt)
    .map((node: { id?: string }) => String(node.id || ""))
    .filter(Boolean);
}

async function deleteMedia(work: Work, mediaIds: string[]) {
  if (!mediaIds.length) return;
  const deleted = await adminGql(work.shop, work.token, `mutation($productId: ID!, $mediaIds: [ID!]!) {
    productDeleteMedia(productId: $productId, mediaIds: $mediaIds) {
      mediaUserErrors { message }
    }
  }`, {
    productId: gid("Product", work.plan.shopifyProductId),
    mediaIds,
  });
  const errors = deleted?.productDeleteMedia?.mediaUserErrors || [];
  if (errors.length) throw new ColourEditRefusal([errors.map((err: { message?: string }) => err.message).join("; ")]);
}

async function attachMockup(work: Work, colourName: string, path: string, variantIds: string[]) {
  const alt = mockupAlt(work.plan.title, colourName);
  const existing = await colourMedia(work, colourName);
  let mediaId = existing[0] || "";
  if (existing.length > 1) await deleteMedia(work, existing.slice(1));
  if (!mediaId) {
    const src = await signedLibraryUrl(path);
    const uploaded = await adminGql(work.shop, work.token, `mutation($productId: ID!, $media: [CreateMediaInput!]!) {
      productCreateMedia(productId: $productId, media: $media) {
        media { id alt status }
        mediaUserErrors { message }
      }
    }`, {
      productId: gid("Product", work.plan.shopifyProductId),
      media: [{ originalSource: src, alt, mediaContentType: "IMAGE" }],
    });
    const errors = uploaded?.productCreateMedia?.mediaUserErrors || [];
    if (errors.length) throw new ColourEditRefusal([errors.map((err: { message?: string }) => err.message).join("; ")]);
    mediaId = String(uploaded?.productCreateMedia?.media?.[0]?.id || "");
  }
  if (!mediaId) throw new ColourEditRefusal([`Shopify did not store the ${colourName} mockup.`]);
  for (let attempt = 0; attempt < 12; attempt++) {
    const data = await adminGql(work.shop, work.token, `query($id: ID!) { node(id: $id) { ... on MediaImage { status } } }`, { id: mediaId });
    const status = String(data?.node?.status || "");
    if (status === "READY") break;
    if (status === "FAILED") throw new ColourEditRefusal([`Shopify could not process the ${colourName} mockup.`]);
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  const updated = await adminGql(work.shop, work.token, `mutation($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      userErrors { message }
    }
  }`, {
    productId: gid("Product", work.plan.shopifyProductId),
    variants: variantIds.map((id) => ({ id: gid("ProductVariant", id), mediaId })),
  });
  const updateErrors = updated?.productVariantsBulkUpdate?.userErrors || [];
  if (updateErrors.length) throw new ColourEditRefusal([updateErrors.map((err: { message?: string }) => err.message).join("; ")]);
}

async function deleteShopifyVariants(work: Work, variantIds: string[]) {
  if (!variantIds.length) return;
  const deleted = await adminGql(work.shop, work.token, `mutation($productId: ID!, $variantsIds: [ID!]!) {
    productVariantsBulkDelete(productId: $productId, variantsIds: $variantsIds) {
      userErrors { message }
    }
  }`, {
    productId: gid("Product", work.plan.shopifyProductId),
    variantsIds: variantIds.map((id) => gid("ProductVariant", id)),
  });
  const errors = deleted?.productVariantsBulkDelete?.userErrors || [];
  if (errors.length) throw new ColourEditRefusal([errors.map((err: { message?: string }) => err.message).join("; ") || "Shopify did not remove the variants."]);
}

async function deleteColourOptionValue(work: Work, colourName: string) {
  const productId = gid("Product", work.plan.shopifyProductId);
  const data = await adminGql(work.shop, work.token, `query($id: ID!) {
    product(id: $id) {
      options { id name optionValues { id name hasVariants } }
      variants(first: 100) { nodes { selectedOptions { name value } } }
    }
  }`, { id: productId });
  const stillUsed = (data?.product?.variants?.nodes || []).some((node: { selectedOptions?: Array<{ name?: string; value?: string }> }) =>
    (node.selectedOptions || []).some((option) => option.name === work.optionNames.colour && String(option.value || "").toLowerCase() === colourName.toLowerCase()));
  if (stillUsed) return;
  const option = (data?.product?.options || []).find((row: { name?: string }) => String(row.name || "") === work.optionNames.colour) as {
    id?: string;
    optionValues?: Array<{ id?: string; name?: string; hasVariants?: boolean }>;
  } | undefined;
  const value = (option?.optionValues || []).find((row) => String(row.name || "").toLowerCase() === colourName.toLowerCase());
  if (!option?.id || !value?.id || value.hasVariants) return;
  const updated = await adminGql(work.shop, work.token, `mutation($productId: ID!, $option: OptionUpdateInput!, $values: [ID!]!) {
    productOptionUpdate(productId: $productId, option: $option, optionValuesToDelete: $values) {
      userErrors { message }
    }
  }`, {
    productId,
    option: { id: option.id },
    values: [value.id],
  });
  const errors = updated?.productOptionUpdate?.userErrors || [];
  if (errors.length) throw new ColourEditRefusal([errors.map((err: { message?: string }) => err.message).filter(Boolean).join("; ") || `Shopify did not remove ${colourName}.`]);
}

async function mergeVariantMap(designProductId: string, shopifyProductId: string, mutate: (map: Record<string, { sizeId: string; colorId: string; printifyVariantId: number }>) => void) {
  const [row] = await db.select({
    id: designProducts.id,
    shopifyProductId: designProducts.shopifyProductId,
    variantMap: designProducts.variantMap,
    mockupUrls: designProducts.mockupUrls,
  }).from(designProducts).where(eq(designProducts.id, designProductId)).limit(1);
  if (!row || String(row.shopifyProductId) !== shopifyProductId) {
    throw new ColourEditRefusal(["The design's Shopify product changed. Nothing else was edited."]);
  }
  const map = parseJson<Record<string, { sizeId: string; colorId: string; printifyVariantId: number }>>(row.variantMap, {});
  mutate(map);
  await db.update(designProducts).set({ variantMap: map, updatedAt: new Date() }).where(and(
    eq(designProducts.id, designProductId),
    eq(designProducts.shopifyProductId, shopifyProductId),
  ));
}

export async function applyDesignColourEdit(
  designProductId: string,
  wantedNames: string[],
  onPhase?: (phase: string) => void,
): Promise<ColourEditPlan> {
  const work = await loadWork(designProductId, wantedNames);
  if (work.plan.blockers.length) throw new ColourEditRefusal(work.plan.blockers);
  const startedId = work.plan.shopifyProductId;
  if (!work.add.length && !work.remove.length) return work.plan;

  onPhase?.("mockups");
  const mockupPaths = new Map<string, string>();
  for (const colour of work.add) {
    const stored = await storeCandidateColourMockup({
      candidateId: work.candidateId,
      productTypeId: work.productTypeId,
      typeName: work.typeName,
      panelId: work.panelId,
      colorName: colour.name,
      colorHex: colour.hex,
      artworkPath: work.artworkPath,
    });
    mockupPaths.set(colourKey(colour.name), stored.path);
  }

  onPhase?.("shopify");
  const existing = await readShopifyVariants(work.shop, work.token, startedId);
  const added: Array<{ colour: Work["add"][number]; ids: string[] }> = [];
  for (const colour of work.add) {
    const missing = colour.variants.filter((variant) => !existing.variants.some((row) => row.size === variant.sizeName && colourKey(row.colour) === colourKey(variant.colourName)));
    const created = missing.length ? await createShopifyVariants(work, missing) : [];
    const after = created.length ? await readShopifyVariants(work.shop, work.token, startedId) : existing;
    if (created.length) existing.variants = after.variants;
    const ids = colour.variants.map((variant) => {
      const hit = existing.variants.find((row) => row.size === variant.sizeName && colourKey(row.colour) === colourKey(variant.colourName));
      return hit?.id || "";
    });
    if (ids.some((id) => !id)) throw new ColourEditRefusal([`Shopify did not return every ${colour.name} variant.`]);
    const path = mockupPaths.get(colourKey(colour.name));
    if (!path) throw new ColourEditRefusal([`No mockup was stored for ${colour.name}.`]);
    await attachMockup(work, colour.name, path, ids);
    added.push({ colour, ids });
  }

  onPhase?.("printify");
  for (const colour of work.add) {
    await setPrintifyEnabled(work, colour.variants.map((variant) => variant.printifyVariantId), true);
  }
  for (const colour of work.remove) {
    await setPrintifyEnabled(work, colour.printifyVariantIds, false);
  }

  onPhase?.("shipping");
  for (const row of added) {
    for (let index = 0; index < row.colour.variants.length; index++) {
      const spec = row.colour.variants[index];
      const variantId = numericId(row.ids[index]);
      if (!spec?.studioVariantId || !variantId) continue;
      const [existingMember] = await db.select({ id: shippingStoreVariants.id }).from(shippingStoreVariants).where(and(
        eq(shippingStoreVariants.shopDomain, work.shop),
        eq(shippingStoreVariants.shopifyVariantId, variantId),
      )).limit(1);
      if (!existingMember) {
        await attachVariantToShipping({
          shop: work.shop,
          shopifyVariantId: variantId,
          sourceVariantId: spec.studioVariantId,
          source: "shadow",
        });
      }
      const [member] = existingMember
        ? [existingMember]
        : await db.select({ id: shippingStoreVariants.id }).from(shippingStoreVariants).where(and(
          eq(shippingStoreVariants.shopDomain, work.shop),
          eq(shippingStoreVariants.shopifyVariantId, variantId),
        )).limit(1);
      if (!member) throw new ColourEditRefusal([`${row.colour.name} ${spec.sizeName} was not added to the delivery profile.`]);
    }
  }
  if (added.length) {
    await mergeVariantMap(designProductId, startedId, (map) => {
      for (const row of added) {
        row.colour.variants.forEach((variant, index) => {
          map[row.ids[index]] = { sizeId: variant.sizeId, colorId: variant.colorId, printifyVariantId: variant.printifyVariantId };
        });
      }
    });
  }

  if (work.remove.length) {
    onPhase?.("shopify");
    for (const colour of work.remove) {
      await deleteShopifyVariants(work, colour.shopifyVariantIds);
      await deleteColourOptionValue(work, colour.name);
      await deleteMedia(work, await colourMedia(work, colour.name));
      if (colour.shopifyVariantIds.length) {
        await db.delete(shippingStoreVariants).where(and(
          eq(shippingStoreVariants.shopDomain, work.shop),
          inArray(shippingStoreVariants.shopifyVariantId, colour.shopifyVariantIds),
        ));
      }
      await mergeVariantMap(designProductId, startedId, (map) => {
        for (const id of colour.shopifyVariantIds) delete map[id];
      });
    }
  }

  const [check] = await db.select({
    shopifyProductId: designProducts.shopifyProductId,
    printifyProductId: designProducts.printifyProductId,
  }).from(designProducts).where(eq(designProducts.id, designProductId)).limit(1);
  if (String(check?.shopifyProductId) !== startedId || String(check?.printifyProductId) !== work.plan.printifyProductId) {
    throw new ColourEditRefusal(["The saved product ids changed. No duplicate product was created by this edit."]);
  }
  return work.plan;
}

export async function findPublishedDesign(candidateId: string, productTypeId: number): Promise<string | null> {
  const [typeRow] = await db.select({ shop: productTypes.shopifyShopDomain }).from(productTypes).where(eq(productTypes.id, productTypeId)).limit(1);
  const shop = normalizeMyshopifyShopDomain(String(typeRow?.shop || ""));
  if (!shop) return null;
  const [row] = await db.select({ id: designProducts.id }).from(designProducts).where(and(
    eq(designProducts.jobId, candidateId),
    eq(designProducts.productTypeId, productTypeId),
    eq(designProducts.shop, shop),
  )).limit(1);
  return row?.id || null;
}
