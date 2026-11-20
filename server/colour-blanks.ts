/**
 * Operator colour list for the mockup library.
 * Saving a colour here does not rename blanks, products, or variants.
 */
import { and, asc, eq, ne, sql } from "drizzle-orm";
import {
  blankNameKey,
  blankNameMatch,
  colourMatchKeys,
  composeBlankChoice,
  describeColourUse,
  normaliseBlankHex,
  SOFTSTYLE_COLOUR_SEED,
  type BlankFinish,
} from "@shared/colourBlanks";
import { catalogueShopAllowed, catalogueShopDomain } from "@shared/operatorCatalogue";
import { chestZoneForProductType, type ChestPrintZone } from "@shared/printPlacement";
import { normaliseShopifyBaseColor, swatchBaseColorName } from "@shared/flywheelPromote";
import { resolvePrintifyColorHex } from "@shared/printifyColorResolver";
import { designCandidates, designProducts, designs, mockupLibraryColours, orders, productTypes } from "@shared/schema";
import { db, pool } from "./db";
import { printCanvasFromStoredPlaceholders } from "./flywheel-print-file";
import { calibratedPrintFractions, maskFromPng, printRectOffset, type PrintFractions } from "./mockup-library";
import {
  approvePaintedBlank,
  approveUploadedBlank,
  panelsForType,
  previewUploadedBlank,
  previewPaintedBlank,
  readLibraryObject,
  renameStoredBlankColour,
  restoreBlankRevision,
  signedBlankPhoto,
  signedLibraryUrl,
} from "./mockup-library-store";

let tableReady: Promise<void> | null = null;

export function ensureColourBlankTable(): Promise<void> {
  if (!tableReady) {
    tableReady = (async () => {
      await pool.query(`CREATE TABLE IF NOT EXISTS mockup_library_colours (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
        product_type_id integer NOT NULL,
        name text NOT NULL,
        printify_option_id integer,
        printify_title text NOT NULL,
        hex text NOT NULL,
        finish text NOT NULL,
        link_stored_name text,
        sort_order integer NOT NULL DEFAULT 0,
        active boolean NOT NULL DEFAULT true,
        shopify_base_color text,
        created_at timestamp NOT NULL DEFAULT now()
      )`);
      await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS mockup_library_colours_type_name_uidx
        ON mockup_library_colours (product_type_id, name)`);
      const column = await pool.query(`SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'mockup_library_colours' AND column_name = 'active'`);
      if (!column.rows.length) {
        await pool.query(`ALTER TABLE mockup_library_colours ADD COLUMN active boolean NOT NULL DEFAULT true`);
        // Existing rows become active. Comfort Colors (blueprint 706) starts with only White on.
        // This runs once, when the column is added, so later ticks are kept.
        await pool.query(`UPDATE mockup_library_colours AS c
          SET active = false
          FROM product_types AS p
          WHERE c.product_type_id = p.id
            AND p.printify_blueprint_id = 706
            AND lower(trim(c.name)) <> 'white'`);
      }
      const baseColumn = await pool.query(`SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'mockup_library_colours' AND column_name = 'shopify_base_color'`);
      if (!baseColumn.rows.length) {
        await pool.query(`ALTER TABLE mockup_library_colours ADD COLUMN shopify_base_color text`);
        await prefillShopifyBaseColours();
      }
    })().catch((err) => {
      tableReady = null;
      throw err;
    });
  }
  return tableReady;
}

/** Fill empty base colours once, when the column is added. Later edits are kept. */
export async function prefillShopifyBaseColours(): Promise<number> {
  const rows = await db
    .select({
      id: mockupLibraryColours.id,
      name: mockupLibraryColours.name,
      base: mockupLibraryColours.shopifyBaseColor,
    })
    .from(mockupLibraryColours);
  let filled = 0;
  for (const row of rows) {
    if (String(row.base || "").trim()) continue;
    const base = swatchBaseColorName(row.name);
    if (!base) continue;
    await db.update(mockupLibraryColours)
      .set({ shopifyBaseColor: base })
      .where(eq(mockupLibraryColours.id, row.id));
    filled += 1;
  }
  return filled;
}

/**
 * Base colour for one garment name on this type's colour list.
 * A row with an empty field stays empty. A type with no list uses the name map.
 */
export async function shopifyBaseColorsByName(productTypeId: number): Promise<Map<string, string | null>> {
  const libraryId = await blankLibraryTypeId(productTypeId);
  await ensureColourBlankTable();
  const rows = await db
    .select({ name: mockupLibraryColours.name, base: mockupLibraryColours.shopifyBaseColor })
    .from(mockupLibraryColours)
    .where(eq(mockupLibraryColours.productTypeId, libraryId));
  const stored = new Map<string, string | null>();
  for (const row of rows) {
    stored.set(row.name.trim().toLowerCase(), normaliseShopifyBaseColor(row.base));
  }
  return stored;
}

export function resolvedShopifyBaseColor(colourName: string, stored: Map<string, string | null>): string | null {
  const key = colourName.trim().toLowerCase();
  if (stored.has(key)) return stored.get(key) || null;
  return swatchBaseColorName(colourName);
}

async function seedSoftstyleColours(): Promise<void> {
  const [count] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(mockupLibraryColours)
    .where(eq(mockupLibraryColours.productTypeId, 54));
  if (Number(count?.n || 0) > 0) return;
  await db.insert(mockupLibraryColours).values(SOFTSTYLE_COLOUR_SEED.map((row) => ({
    productTypeId: 54,
    name: row.name,
    printifyOptionId: row.printifyOptionId,
    printifyTitle: row.printifyTitle,
    hex: row.hex,
    finish: row.finish,
    linkStoredName: row.linkStoredName,
    sortOrder: row.sortOrder,
    shopifyBaseColor: swatchBaseColorName(row.name),
  }))).onConflictDoNothing();
}

const COMFORT_BLUEPRINT = 706;
const COMFORT_PROVIDER = 99;

async function printifyGet(path: string): Promise<unknown | null> {
  const found = await db.execute(sql`
    SELECT printify_api_token AS token
    FROM merchants
    WHERE printify_api_token IS NOT NULL AND length(printify_api_token) > 20
    LIMIT 4
  `);
  const tokens = (found.rows as Array<{ token: string }>).map((row) => row.token).filter(Boolean);
  if (process.env.PRINTIFY_API_TOKEN) tokens.push(process.env.PRINTIFY_API_TOKEN);
  for (const token of tokens) {
    const res = await fetch(`https://api.printify.com/v1${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) return res.json();
  }
  return null;
}

type CatalogColour = { name: string; optionId: number | null; hex: string | null };

function coloursFromCatalog(blueprint: any, variantsPayload: any): CatalogColour[] {
  const lists = [
    ...(Array.isArray(blueprint?.options) ? blueprint.options : []),
    ...(Array.isArray(variantsPayload?.options) ? variantsPayload.options : []),
  ];
  const fromOptions: CatalogColour[] = [];
  for (const option of lists) {
    const label = String(option?.name || option?.type || "");
    if (!/color|colour/i.test(label)) continue;
    for (const value of option.values || []) {
      const name = String(value.title || value.name || "").trim();
      if (!name) continue;
      const optionId = Number(value.id);
      fromOptions.push({
        name,
        optionId: Number.isInteger(optionId) ? optionId : null,
        hex: value.colors?.[0] || value.hex_code || null,
      });
    }
  }
  if (fromOptions.length) return fromOptions;
  const variants = Array.isArray(variantsPayload?.variants) ? variantsPayload.variants : [];
  const seen = new Map<string, CatalogColour>();
  for (const variant of variants) {
    const name = String(variant?.options?.color || "").trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.set(name.toLowerCase(), { name, optionId: null, hex: null });
  }
  return [...seen.values()];
}

function frontPrintPx(raw: string | null): { width: number; height: number } | null {
  try {
    const list = JSON.parse(raw || "[]") as Array<{ position?: string; width?: number; height?: number }>;
    const front = list.find((row) => String(row?.position || "").toLowerCase() === "front");
    const width = Math.round(Number(front?.width));
    const height = Math.round(Number(front?.height));
    if (width > 0 && height > 0) return { width, height };
  } catch {
    return null;
  }
  return null;
}

/** This type's own print box, from its blueprint and its front placeholder. Photographs may be shared; this never reads another type's panel fractions. */
export async function printFractionsForType(productTypeId: number): Promise<PrintFractions | null> {
  const [typeRow] = await db
    .select({
      blueprint: productTypes.printifyBlueprintId,
      positions: productTypes.placeholderPositions,
    })
    .from(productTypes)
    .where(eq(productTypes.id, productTypeId))
    .limit(1);
  const front = frontPrintPx(typeRow?.positions ?? null);
  if (!front) return null;
  const calibrated = calibratedPrintFractions({
    blueprintId: typeRow?.blueprint ?? null,
    printWidthPx: front.width,
    printHeightPx: front.height,
  });
  if (!calibrated) return null;
  return {
    widthOfH: calibrated.widthOfH,
    heightOfH: calibrated.heightOfH,
    topOfH: calibrated.topOfH,
    rotationDeg: calibrated.rotationDeg,
  };
}

/** Chest zone for this type, plus the print area in inches so the mockup uses the same box as the print file. */
export async function chestFitForProductType(productTypeId: number): Promise<
  (ChestPrintZone & { printWidthIn: number; printHeightIn: number }) | null
> {
  if (!Number.isInteger(productTypeId) || productTypeId <= 0) return null;
  const [row] = await db
    .select({
      name: productTypes.name,
      positions: productTypes.placeholderPositions,
      width: productTypes.printChestWidthIn,
      height: productTypes.printChestHeightIn,
    })
    .from(productTypes)
    .where(eq(productTypes.id, productTypeId))
    .limit(1);
  const zone = chestZoneForProductType(productTypeId, row?.width, row?.height);
  if (!zone) return null;
  const canvas = printCanvasFromStoredPlaceholders(row?.positions, row?.name || `type ${productTypeId}`);
  return {
    ...zone,
    printWidthIn: canvas.width / 300,
    printHeightIn: canvas.height / 300,
  };
}

async function seedGarmentDyedColours(productTypeId: number): Promise<void> {
  const [typeRow] = await db
    .select({
      id: productTypes.id,
      name: productTypes.name,
      blueprint: productTypes.printifyBlueprintId,
      provider: productTypes.printifyProviderId,
    })
    .from(productTypes)
    .where(eq(productTypes.id, productTypeId))
    .limit(1);
  if (!typeRow) return;
  const garmentDyed = typeRow.blueprint === COMFORT_BLUEPRINT || /1717|garment-dyed/i.test(typeRow.name);
  if (!garmentDyed) return;
  const [count] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(mockupLibraryColours)
    .where(eq(mockupLibraryColours.productTypeId, productTypeId));
  if (Number(count?.n || 0) > 0) return;
  const provider = typeRow.provider || COMFORT_PROVIDER;
  const [blueprint, variants] = await Promise.all([
    printifyGet(`/catalog/blueprints/${typeRow.blueprint || COMFORT_BLUEPRINT}.json`),
    printifyGet(`/catalog/blueprints/${typeRow.blueprint || COMFORT_BLUEPRINT}/print_providers/${provider}/variants.json?show-out-of-stock=1`),
  ]);
  const colours = coloursFromCatalog(blueprint, variants);
  if (!colours.length) return;
  await db.insert(mockupLibraryColours).values(colours.map((colour, index) => {
    const resolved = colour.hex || resolvePrintifyColorHex(colour.name).hex;
    return {
      productTypeId,
      name: colour.name,
      printifyOptionId: colour.optionId,
      printifyTitle: colour.name,
      hex: normaliseBlankHex(String(resolved).replace(/^#/, "")),
      finish: "produced" as const,
      linkStoredName: null,
      sortOrder: index,
      shopifyBaseColor: swatchBaseColorName(colour.name),
      active: blankNameKey(colour.name) === "white",
    };
  })).onConflictDoNothing();
}

function asFinish(value: string): BlankFinish {
  if (value === "heather" || value === "produced") return value;
  return "solid";
}

type ColourUse = { products: string[]; orders: Array<{ id: number; status: string }> };

function orderIsOpen(status: string): boolean {
  const value = status.trim().toLowerCase();
  if (!value) return true;
  if (value.includes("cancel")) return false;
  return !["fulfilled", "shipped", "delivered", "refunded", "completed", "complete", "refund"].includes(value);
}

function collectColourTokens(value: unknown, into: Set<string>, keyName = ""): void {
  if (value == null) return;
  if (typeof value === "string") {
    const text = value.trim();
    if (!text || text.toLowerCase() === "default") return;
    if (text.startsWith("{") || text.startsWith("[")) {
      try { collectColourTokens(JSON.parse(text), into, keyName); } catch { /* not json */ }
      return;
    }
    if (text.includes(":")) {
      const colour = text.slice(text.lastIndexOf(":") + 1).trim();
      if (colour && colour.toLowerCase() !== "default") into.add(colour);
      return;
    }
    if (/^(name|id|colorid|framecolor)$/i.test(keyName)) into.add(text);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectColourTokens(item, into, keyName);
    return;
  }
  if (typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (key.includes(":")) {
        const colour = key.slice(key.lastIndexOf(":") + 1).trim();
        if (colour && colour.toLowerCase() !== "default") into.add(colour);
      }
      collectColourTokens(child, into, key);
    }
  }
}

function noteColourUse(index: Map<string, ColourUse>, token: string, hit: { product?: string; order?: { id: number; status: string } }) {
  for (const key of colourMatchKeys(token)) {
    let bucket = index.get(key);
    if (!bucket) {
      bucket = { products: [], orders: [] };
      index.set(key, bucket);
    }
    if (hit.product && !bucket.products.includes(hit.product)) bucket.products.push(hit.product);
    if (hit.order && !bucket.orders.some((order) => order.id === hit.order!.id)) bucket.orders.push(hit.order);
  }
}

function mergedColourUse(index: Map<string, ColourUse>, name: string): ColourUse {
  const products: string[] = [];
  const orders: ColourUse["orders"] = [];
  for (const key of colourMatchKeys(name)) {
    const bucket = index.get(key);
    if (!bucket) continue;
    for (const title of bucket.products) if (!products.includes(title)) products.push(title);
    for (const order of bucket.orders) if (!orders.some((row) => row.id === order.id)) orders.push(order);
  }
  return { products, orders };
}

async function colourUseIndex(productTypeId: number): Promise<Map<string, ColourUse>> {
  const index = new Map<string, ColourUse>();
  const [typeRow] = await db
    .select({
      name: productTypes.name,
      shopifyProductId: productTypes.shopifyProductId,
      frameColors: productTypes.frameColors,
      selectedColorIds: productTypes.selectedColorIds,
      variantMap: productTypes.variantMap,
      shopifyVariantIds: productTypes.shopifyVariantIds,
    })
    .from(productTypes)
    .where(eq(productTypes.id, productTypeId))
    .limit(1);
  if (typeRow?.shopifyProductId) {
    const tokens = new Set<string>();
    collectColourTokens(typeRow.frameColors, tokens);
    collectColourTokens(typeRow.selectedColorIds, tokens);
    collectColourTokens(typeRow.variantMap, tokens);
    collectColourTokens(typeRow.shopifyVariantIds, tokens);
    for (const token of tokens) noteColourUse(index, token, { product: typeRow.name });
  }

  const published = await db
    .select({ title: designProducts.title, variantMap: designProducts.variantMap })
    .from(designProducts)
    .where(and(
      eq(designProducts.productTypeId, productTypeId),
      eq(designProducts.status, "active"),
      sql`${designProducts.shopifyProductId} is not null`,
    ));
  for (const row of published) {
    const tokens = new Set<string>();
    collectColourTokens(row.variantMap, tokens);
    for (const token of tokens) noteColourUse(index, token, { product: row.title });
  }

  const candidates = await db
    .select({ title: designProducts.title, colors: designCandidates.selectedColors })
    .from(designCandidates)
    .innerJoin(designProducts, eq(designProducts.id, designCandidates.designProductId))
    .where(and(
      eq(designProducts.productTypeId, productTypeId),
      eq(designProducts.status, "active"),
      sql`${designCandidates.shopifyProductId} is not null`,
    ));
  for (const row of candidates) {
    const tokens = new Set<string>();
    collectColourTokens(row.colors, tokens);
    for (const token of tokens) noteColourUse(index, token, { product: row.title });
  }

  const orderRows = await db
    .select({
      id: orders.id,
      status: orders.status,
      frameColor: orders.frameColor,
      designColor: designs.frameColor,
    })
    .from(orders)
    .innerJoin(designs, eq(designs.id, orders.designId))
    .where(eq(designs.productTypeId, productTypeId));
  for (const row of orderRows) {
    if (!orderIsOpen(row.status)) continue;
    const hit = { order: { id: row.id, status: row.status } };
    if (row.frameColor) noteColourUse(index, row.frameColor, hit);
    if (row.designColor && blankNameKey(row.designColor) !== blankNameKey(row.frameColor || "")) {
      noteColourUse(index, row.designColor, hit);
    }
  }
  return index;
}

export async function inactiveColourKeys(productTypeId: number): Promise<Set<string>> {
  productTypeId = await blankLibraryTypeId(productTypeId);
  await ensureColourBlankTable();
  const rows = await db
    .select({ name: mockupLibraryColours.name })
    .from(mockupLibraryColours)
    .where(and(eq(mockupLibraryColours.productTypeId, productTypeId), eq(mockupLibraryColours.active, false)));
  const hidden = new Set<string>();
  for (const row of rows) for (const key of colourMatchKeys(row.name)) hidden.add(key);
  return hidden;
}

export async function setColourActive(id: string, active: boolean) {
  const row = await requireColour(id);
  if (Boolean(row.active) === active) return { id, active };
  if (!active) {
    const use = mergedColourUse(await colourUseIndex(row.productTypeId), row.name);
    const reason = describeColourUse(row.name, use.products, use.orders);
    if (reason) throw new Error(reason);
  }
  await db.update(mockupLibraryColours).set({ active }).where(eq(mockupLibraryColours.id, id));
  return { id, active };
}

function blankAccessError(status: number, message: string): Error {
  const err = new Error(message);
  (err as Error & { status: number }).status = status;
  return err;
}

/** An operator shop opens only types whose shell lives on that shop. */
export async function assertColourBlankAccess(productTypeId: number, requestShop: string | null | undefined, write: boolean): Promise<void> {
  const session = catalogueShopDomain(requestShop);
  if (!catalogueShopAllowed(session)) return;
  const [row] = await db
    .select({ shop: productTypes.shopifyShopDomain, platformRef: productTypes.isPlatformCatalogRef })
    .from(productTypes)
    .where(eq(productTypes.id, productTypeId))
    .limit(1);
  if (row && !row.platformRef && catalogueShopDomain(row.shop) === session) return;
  throw blankAccessError(write ? 403 : 404, "That product type is not on this shop.");
}

/** Active Colour blanks rows: hex, sort order, and the active flag the Studio list uses. */
export async function activeColourBlankSwatches(productTypeId: number): Promise<Array<{ name: string; hex: string; sortOrder: number }>> {
  if (!Number.isInteger(productTypeId) || productTypeId <= 0) return [];
  const libraryId = await blankLibraryTypeId(productTypeId);
  await ensureColourBlankTable();
  const rows = await db
    .select({
      name: mockupLibraryColours.name,
      hex: mockupLibraryColours.hex,
      sortOrder: mockupLibraryColours.sortOrder,
    })
    .from(mockupLibraryColours)
    .where(and(
      eq(mockupLibraryColours.productTypeId, libraryId),
      eq(mockupLibraryColours.active, true),
    ))
    .orderBy(asc(mockupLibraryColours.sortOrder), asc(mockupLibraryColours.name));
  return rows.map((row) => ({
    name: row.name,
    hex: String(row.hex || "").replace(/^#/, "").trim().toUpperCase(),
    sortOrder: row.sortOrder,
  }));
}

/** Photographs and the colour list live on this id. A linked type reads the source and does not own a copy. */
export async function blankLibraryTypeId(productTypeId: number): Promise<number> {
  const [row] = await db
    .select({ source: productTypes.blankSourceProductTypeId })
    .from(productTypes)
    .where(eq(productTypes.id, productTypeId))
    .limit(1);
  const source = Number(row?.source);
  if (!Number.isInteger(source) || source <= 0 || source === productTypeId) return productTypeId;
  const [owner] = await db
    .select({ id: productTypes.id })
    .from(productTypes)
    .where(eq(productTypes.id, source))
    .limit(1);
  return owner ? source : productTypeId;
}

export async function assertBlankLibraryWritable(productTypeId: number): Promise<void> {
  const libraryId = await blankLibraryTypeId(productTypeId);
  if (libraryId === productTypeId) return;
  throw new Error(`These blanks belong to product type ${libraryId}. Paint and approve them there. This page shows that set as soon as it changes.`);
}

export async function prepareColourBlanks(productTypeId: number): Promise<void> {
  await ensureColourBlankTable();
  if (productTypeId === 54) await seedSoftstyleColours();
  else {
    await seedGarmentDyedColours(productTypeId).catch((err) => {
      console.warn("[colour-blanks] garment colour seed skipped:", (err as Error).message);
    });
  }
}

export async function colourBlankGrid(productTypeId: number, options?: { restrictToShop?: string | null }) {
  const libraryId = await blankLibraryTypeId(productTypeId);
  await prepareColourBlanks(libraryId);
  const [typeRow] = await db
    .select({
      id: productTypes.id,
      name: productTypes.name,
      blueprint: productTypes.printifyBlueprintId,
      positions: productTypes.placeholderPositions,
    })
    .from(productTypes)
    .where(eq(productTypes.id, productTypeId))
    .limit(1);
  const [libraryRow] = libraryId === productTypeId
    ? [typeRow]
    : await db
      .select({ id: productTypes.id, name: productTypes.name })
      .from(productTypes)
      .where(eq(productTypes.id, libraryId))
      .limit(1);
  const front = frontPrintPx(typeRow?.positions ?? null);
  const calibrated = front
    ? calibratedPrintFractions({ blueprintId: typeRow?.blueprint ?? null, printWidthPx: front.width, printHeightPx: front.height })
    : null;
  const known = await db
    .select({
      id: productTypes.id,
      name: productTypes.name,
      shop: productTypes.shopifyShopDomain,
      platformRef: productTypes.isPlatformCatalogRef,
    })
    .from(productTypes)
    .orderBy(asc(productTypes.id));
  const restrictShop = options?.restrictToShop ? catalogueShopDomain(options.restrictToShop) : "";
  const visible = restrictShop
    ? known.filter((row) => !row.platformRef && catalogueShopDomain(row.shop) === restrictShop)
    : known;
  const colourRows = await db
    .select()
    .from(mockupLibraryColours)
    .where(eq(mockupLibraryColours.productTypeId, libraryId))
    .orderBy(asc(mockupLibraryColours.sortOrder), asc(mockupLibraryColours.name));
  const useIndex = await colourUseIndex(libraryId);
  const panels = await panelsForType(libraryId);
  const storedNames = [...new Set(panels.map((row) => row.garmentColor))];
  const colours = colourRows.map((row) => {
    const match = blankNameMatch(row.name, row.linkStoredName, storedNames);
    const linked = match.state === "name-mismatch"
      ? panels.filter((panel) => blankNameKey(panel.garmentColor) === blankNameKey(match.storedName))
      : [];
    const active = row.active !== false;
    const use = active ? mergedColourUse(useIndex, row.name) : { products: [], orders: [] };
    return {
      id: row.id,
      name: row.name,
      printifyOptionId: row.printifyOptionId,
      printifyTitle: row.printifyTitle,
      hex: row.hex,
      finish: asFinish(row.finish),
      linkStoredName: row.linkStoredName,
      sortOrder: row.sortOrder,
      shopifyBaseColor: normaliseShopifyBaseColor(row.shopifyBaseColor),
      active,
      lockReason: active ? describeColourUse(row.name, use.products, use.orders) : null,
      match: match.state,
      storedName: match.state === "name-mismatch" ? match.storedName : null,
      storedRows: linked.length,
      storedScenes: new Set(linked.map((panel) => panel.panelId)).size,
    };
  });

  const groups = new Map<string, { label: string; isDefault: boolean; rows: typeof panels }>();
  for (const row of panels) {
    let group = groups.get(row.panelId);
    if (!group) {
      group = { label: row.label, isDefault: false, rows: [] };
      groups.set(row.panelId, group);
    }
    if (row.isDefault) group.isDefault = true;
    group.rows.push(row);
  }

  const scenes = [...groups.entries()]
    .sort((a, b) => Number(b[1].isDefault) - Number(a[1].isDefault) || a[0].localeCompare(b[0]))
    .map(([panelId, group]) => {
      const composeRows = group.rows.map((row) => ({
        id: row.id,
        name: row.garmentColor,
        hex: row.garmentHex,
        kind: row.kind === "white-master" ? "white-master" as const : "produced" as const,
      }));
      const cells = colourRows.filter((colour) => colour.active !== false).map((colour) => {
        const exact = group.rows.filter((row) => blankNameKey(row.garmentColor) === blankNameKey(colour.name));
        const current = exact[0] ?? null;
        const choice = composeBlankChoice(composeRows, colour.name);
        const revision = (row: typeof exact[number]) => ({
          id: row.id,
          name: row.garmentColor,
          hex: row.garmentHex,
          kind: row.kind,
          createdAt: row.createdAt.toISOString(),
        });
        return {
          colourId: colour.id,
          state: current ? "present" as const : "missing" as const,
          photoUrl: null as string | null,
          storagePath: current?.storagePath ?? null,
          compose: {
            mode: choice.mode,
            sourceName: choice.sourceName,
            usesThisBlank: Boolean(current && choice.rowId === current.id && choice.mode === "produced"),
          },
          current: current ? revision(current) : null,
          history: exact.slice(1).map(revision),
        };
      });
      const master = group.rows.find((row) => row.kind === "white-master");
      return {
        panelId,
        label: group.label,
        isDefault: group.isDefault,
        placement: master ? {
          widthOfH: Number(master.printWidthOfH),
          heightOfH: Number(master.printHeightOfH),
          topOfH: Number(master.printTopOfH),
        } : null,
        maskPath: master?.maskPath ?? null,
        photoWidth: master?.width ?? null,
        photoHeight: master?.height ?? null,
        cells,
      };
    });

  const scenesWithOffset = await Promise.all(scenes.map(async (scene) => {
    let placementOffsetPx: { left: number; top: number; width: number; height: number } | null = null;
    const moved = calibrated && scene.placement && (
      scene.placement.widthOfH !== calibrated.widthOfH
      || scene.placement.heightOfH !== calibrated.heightOfH
      || scene.placement.topOfH !== calibrated.topOfH
    );
    if (moved && scene.maskPath && scene.photoWidth && scene.photoHeight) {
      try {
        const mask = await maskFromPng(await readLibraryObject(scene.maskPath), scene.photoWidth, scene.photoHeight);
        placementOffsetPx = printRectOffset(mask, scene.photoWidth, scene.photoHeight, {
          widthOfH: scene.placement.widthOfH,
          heightOfH: scene.placement.heightOfH,
          topOfH: scene.placement.topOfH,
          rotationDeg: 0,
        }, calibrated);
      } catch {
        placementOffsetPx = null;
      }
    }
    const { maskPath: _mask, photoWidth: _w, photoHeight: _h, ...rest } = scene;
    return { ...rest, placementOffsetPx };
  }));

  await Promise.all(scenes.flatMap((scene) => scene.cells.filter((cell) => cell.storagePath).map(async (cell) => {
    try {
      cell.photoUrl = await signedLibraryUrl(cell.storagePath!, 60 * 30);
    } catch {
      cell.photoUrl = null;
    }
  })));
  for (const scene of scenes) for (const cell of scene.cells) delete (cell as { storagePath?: string }).storagePath;

  return {
    productType: { id: productTypeId, name: typeRow?.name || (productTypeId === 54 ? "Unisex Softstyle T-Shirt" : `Type ${productTypeId}`) },
    sharedFrom: libraryId === productTypeId ? null : { id: libraryId, name: libraryRow?.name || `Type ${libraryId}` },
    types: visible.map((row) => ({ id: row.id, name: row.name })),
    calibration: calibrated && front ? {
      placement: { widthOfH: calibrated.widthOfH, heightOfH: calibrated.heightOfH, topOfH: calibrated.topOfH },
      printWidthPx: front.width,
      printHeightPx: front.height,
      bodyLengthIn: calibrated.bodyLengthIn,
    } : null,
    colours,
    scenes: scenesWithOffset,
  };
}

async function requireColour(id: string) {
  await ensureColourBlankTable();
  const [row] = await db.select().from(mockupLibraryColours).where(eq(mockupLibraryColours.id, id)).limit(1);
  if (!row) throw new Error("That colour is not in the list");
  return row;
}

function storedBaseColor(value: string | null | undefined): string | null {
  const trimmed = String(value || "").trim();
  if (!trimmed) return null;
  const base = normaliseShopifyBaseColor(trimmed);
  if (!base) throw new Error(`${trimmed} is not a Shopify base colour.`);
  return base;
}

export async function saveColourBlank(id: string, patch: {
  name: string;
  printifyTitle: string;
  printifyOptionId: number | null;
  hex: string;
  finish: string;
  linkStoredName: string | null;
  shopifyBaseColor?: string | null;
}) {
  const current = await requireColour(id);
  const name = patch.name.trim();
  if (!name) throw new Error("Name is required");
  const hex = normaliseBlankHex(patch.hex);
  const finish = asFinish(patch.finish);
  const [dup] = await db
    .select({ id: mockupLibraryColours.id })
    .from(mockupLibraryColours)
    .where(and(
      eq(mockupLibraryColours.productTypeId, current.productTypeId),
      ne(mockupLibraryColours.id, id),
      sql`lower(trim(${mockupLibraryColours.name})) = ${name.toLowerCase()}`,
    ))
    .limit(1);
  if (dup) throw new Error("That name is already in this list");
  await db.update(mockupLibraryColours).set({
    name,
    printifyTitle: patch.printifyTitle.trim() || name,
    printifyOptionId: patch.printifyOptionId,
    hex,
    finish,
    linkStoredName: patch.linkStoredName?.trim() || null,
    shopifyBaseColor: patch.shopifyBaseColor === undefined
      ? current.shopifyBaseColor
      : storedBaseColor(patch.shopifyBaseColor),
  }).where(eq(mockupLibraryColours.id, id));
  return { id };
}

export async function createColourBlank(productTypeId: number, patch: {
  name: string;
  printifyTitle: string;
  printifyOptionId: number | null;
  hex: string;
  finish: string;
  linkStoredName: string | null;
  shopifyBaseColor?: string | null;
}) {
  await ensureColourBlankTable();
  const name = patch.name.trim();
  if (!name) throw new Error("Name is required");
  const [last] = await db
    .select({ sortOrder: mockupLibraryColours.sortOrder })
    .from(mockupLibraryColours)
    .where(eq(mockupLibraryColours.productTypeId, productTypeId))
    .orderBy(sql`${mockupLibraryColours.sortOrder} desc`)
    .limit(1);
  const [inserted] = await db.insert(mockupLibraryColours).values({
    productTypeId,
    name,
    printifyTitle: patch.printifyTitle.trim() || name,
    printifyOptionId: patch.printifyOptionId,
    hex: normaliseBlankHex(patch.hex),
    finish: asFinish(patch.finish),
    linkStoredName: patch.linkStoredName?.trim() || null,
    shopifyBaseColor: storedBaseColor(patch.shopifyBaseColor) || swatchBaseColorName(name),
    sortOrder: (last?.sortOrder ?? -1) + 1,
  }).returning({ id: mockupLibraryColours.id });
  if (!inserted) throw new Error("The colour was not added");
  return { id: inserted.id };
}

export async function paintColourBlank(colourId: string, panelId: string) {
  const colour = await requireColour(colourId);
  if (colour.finish === "heather") throw new Error("Heather colours are photographs. They are not painted from the white master.");
  if (colour.finish === "produced") throw new Error("This colour is garment-dyed. Upload a photograph, or switch it to solid to test a paint.");
  return previewPaintedBlank(colour.productTypeId, panelId, colour.hex);
}

export async function approveColourBlank(colourId: string, panelId: string, uploadedBy: string | null) {
  const colour = await requireColour(colourId);
  if (colour.finish === "heather") throw new Error("Heather colours are photographs. They are not painted from the white master.");
  if (colour.finish === "produced") throw new Error("This colour is garment-dyed. Upload a photograph, or switch it to solid to test a paint.");
  return approvePaintedBlank({
    productTypeId: colour.productTypeId,
    panelId,
    garmentColor: colour.name,
    garmentHex: colour.hex,
    uploadedBy,
  });
}

export async function previewColourUpload(colourId: string, panelId: string, imageBase64: string) {
  const colour = await requireColour(colourId);
  return previewUploadedBlank({ productTypeId: colour.productTypeId, panelId, imageBase64 });
}

export async function uploadColourBlank(args: {
  colourId: string;
  panelId: string;
  imageBase64: string;
  uploadedBy: string | null;
  confirmMask?: boolean;
}) {
  const colour = await requireColour(args.colourId);
  return approveUploadedBlank({
    productTypeId: colour.productTypeId,
    panelId: args.panelId,
    garmentColor: colour.name,
    garmentHex: colour.hex,
    imageBase64: args.imageBase64,
    uploadedBy: args.uploadedBy,
    confirmMask: args.confirmMask,
  });
}

export async function linkColourBlank(colourId: string) {
  const colour = await requireColour(colourId);
  const from = (colour.linkStoredName || "").trim();
  if (!from) throw new Error("This colour has no stored name to link");
  return renameStoredBlankColour(colour.productTypeId, from, colour.name);
}

export { restoreBlankRevision, signedBlankPhoto };
