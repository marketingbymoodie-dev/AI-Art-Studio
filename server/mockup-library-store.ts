/**
 * Photographs for the catalogue compositor. One row is one scene colour.
 * Panels are keyed by product type. A second tee blueprint re-uploads its own set.
 */
import { randomUUID } from "crypto";
import sharp from "sharp";
import { and, desc, eq, isNotNull, ne, sql } from "drizzle-orm";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { placementForProductType } from "@shared/printPlacement";
import { catalogueCandidateChoices, designCandidates, designProducts, mockupLibraryColours, mockupPanels, productTypes } from "@shared/schema";
import { db, pool } from "./db";
import { measureGarmentAlignment } from "./blank-alignment";
import { medianShadingLuminance } from "./mockup-compositor";
import "./load-env";
import {
  backgroundAgrees,
  chooseSceneReference,
  decodeRgba,
  DEFAULT_PRINT_FRACTIONS,
  bodyCentreline,
  describeWhiteSegment,
  maskBounds,
  artworkForPrintifyPreview,
  garmentOutlineJpeg,
  maskFromPng,
  measurePlacedInk,
  maskToPng,
  printRectForMask,
  recolorGarment,
  renderArtworkOnPanel,
  resolvePanelColour,
  scaleMask,
  segmentGarmentNearHex,
  segmentWhiteGarment,
  storedMaskReport,
  type PanelColour,
} from "./mockup-library";

const BUCKET = "mockup-library";
const VIEW = "front";

export type StoredColour = PanelColour & { id: string };

export type SceneGroup = {
  panelId: string;
  label: string;
  isDefault: boolean;
  /** A white master is stored even when a newer produced row of the same name is the one listed. */
  hasWhiteMaster: boolean;
  colours: StoredColour[];
};

let clientMemo: SupabaseClient | null | undefined;

function supabase(): SupabaseClient {
  if (clientMemo !== undefined && clientMemo) return clientMemo;
  const url = process.env.SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !key) throw new Error("Supabase is not configured");
  clientMemo = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return clientMemo;
}

async function ensureBucket(): Promise<void> {
  const c = supabase();
  const { data } = await c.storage.getBucket(BUCKET);
  if (data) return;
  const { error } = await c.storage.createBucket(BUCKET, { public: false, fileSizeLimit: "50MB" });
  if (error && !/already exists/i.test(error.message)) throw new Error(error.message);
}

async function putObject(path: string, body: Buffer, contentType: string): Promise<void> {
  await ensureBucket();
  const { error } = await supabase().storage.from(BUCKET).upload(path, body, { contentType, upsert: false });
  if (error) throw new Error(error.message);
}

export async function removeLibraryObject(path: string): Promise<void> {
  await ensureBucket();
  const { error } = await supabase().storage.from(BUCKET).remove([path]);
  if (error && !/not found/i.test(error.message)) throw new Error(error.message);
}

async function getObject(path: string): Promise<Buffer> {
  const { data, error } = await supabase().storage.from(BUCKET).download(path);
  if (error || !data) throw new Error(error?.message || `Missing ${path}`);
  return Buffer.from(await data.arrayBuffer());
}

function slug(value: string): string {
  const out = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return out || "panel";
}

function decodeImage(imageBase64: string): Buffer {
  const raw = imageBase64.replace(/^data:image\/[a-z0-9.+-]+;base64,/i, "");
  const buf = Buffer.from(raw, "base64");
  if (buf.length < 32) throw new Error("The photograph is empty");
  return buf;
}

export async function softstyleType(): Promise<{ id: number; name: string }> {
  const [row] = await db
    .select({ id: productTypes.id, name: productTypes.name })
    .from(productTypes)
    .where(eq(productTypes.id, 54))
    .limit(1);
  if (!row) return { id: 54, name: "Unisex Softstyle T-Shirt" };
  return { id: row.id, name: row.name || "Unisex Softstyle T-Shirt" };
}

export async function listScenes(productTypeId: number): Promise<SceneGroup[]> {
  const rows = await db
    .select()
    .from(mockupPanels)
    .where(and(eq(mockupPanels.productTypeId, productTypeId), eq(mockupPanels.view, VIEW)))
    .orderBy(desc(mockupPanels.createdAt));
  const groups = new Map<string, SceneGroup>();
  for (const row of rows) {
    let group = groups.get(row.panelId);
    if (!group) {
      group = { panelId: row.panelId, label: row.label, isDefault: false, hasWhiteMaster: false, colours: [] };
      groups.set(row.panelId, group);
    }
    if (row.kind === "white-master") group.hasWhiteMaster = true;
    if (row.isDefault) group.isDefault = true;
    if (group.colours.some((colour) => colour.name.toLowerCase() === row.garmentColor.toLowerCase())) continue;
    group.colours.push({
      id: row.id,
      name: row.garmentColor,
      hex: row.garmentHex,
      kind: row.kind === "white-master" ? "white-master" : "produced",
    });
  }
  return [...groups.values()];
}

export async function recentSceneLabels(limit = 5): Promise<string[]> {
  const rows = await db
    .select({ panelId: catalogueCandidateChoices.panelId, approvedAt: catalogueCandidateChoices.approvedAt })
    .from(catalogueCandidateChoices)
    .where(isNotNull(catalogueCandidateChoices.approvedAt))
    .orderBy(desc(catalogueCandidateChoices.approvedAt))
    .limit(20);
  const labels: string[] = [];
  for (const row of rows) {
    if (!row.approvedAt || !row.panelId) continue;
    const [panel] = await db.select({ label: mockupPanels.label }).from(mockupPanels).where(eq(mockupPanels.panelId, row.panelId)).limit(1);
    labels.push(panel?.label || row.panelId);
    if (labels.length >= limit) break;
  }
  return labels;
}

type ChoiceColor = { name: string; hex: string };

export type StoredMockupImage = { name: string; hex: string; path: string };

export async function readChoice(candidateId: string): Promise<{
  panelId: string | null;
  selectedColors: ChoiceColor[];
  artworkPath: string | null;
  mockupImages: StoredMockupImage[];
  approvedAt: Date | null;
}> {
  await ensureCatalogueChoiceColumns();
  const [row] = await db.select().from(catalogueCandidateChoices).where(eq(catalogueCandidateChoices.candidateId, candidateId)).limit(1);
  return {
    panelId: row?.panelId ?? null,
    selectedColors: Array.isArray(row?.selectedColors) ? row.selectedColors : [],
    artworkPath: row?.artworkPath ?? null,
    mockupImages: Array.isArray(row?.mockupImages) ? row.mockupImages : [],
    approvedAt: row?.approvedAt ?? null,
  };
}

export async function readLibraryObject(path: string): Promise<Buffer> {
  return getObject(path);
}

export async function writeLibraryObject(path: string, body: Buffer, contentType: string): Promise<void> {
  await putObject(path, body, contentType);
}

export async function libraryObjectExists(path: string): Promise<boolean> {
  const idx = path.lastIndexOf("/");
  const dir = idx >= 0 ? path.slice(0, idx) : "";
  const name = idx >= 0 ? path.slice(idx + 1) : path;
  try {
    const { data, error } = await supabase().storage.from(BUCKET).list(dir, { limit: 1, search: name });
    if (error || !data) return false;
    return data.some((file) => file.name === name);
  } catch {
    return false;
  }
}

export async function signedLibraryUrl(path: string, expiresSeconds = 60 * 60): Promise<string> {
  const { data, error } = await supabase().storage.from(BUCKET).createSignedUrl(path, expiresSeconds);
  if (error || !data?.signedUrl) throw new Error(error?.message || "Could not sign the stored mockup");
  return data.signedUrl;
}

let catalogueColumnsReady: Promise<void> | null = null;

async function ensureCatalogueChoiceColumns(): Promise<void> {
  if (!catalogueColumnsReady) {
    catalogueColumnsReady = (async () => {
      await pool.query(`ALTER TABLE catalogue_candidate_choices ADD COLUMN IF NOT EXISTS mockup_images jsonb`);
      await pool.query(`ALTER TABLE catalogue_candidate_choices ADD COLUMN IF NOT EXISTS shopify_product_id text`);
      await pool.query(`ALTER TABLE catalogue_candidate_choices ADD COLUMN IF NOT EXISTS printify_product_id text`);
      await pool.query(`ALTER TABLE design_candidates ADD COLUMN IF NOT EXISTS printify_product_id text`);
    })().catch((err) => {
      catalogueColumnsReady = null;
      throw err;
    });
  }
  await catalogueColumnsReady;
}

export async function saveChoice(candidateId: string, panelId: string | null, selectedColors: ChoiceColor[]): Promise<void> {
  const now = new Date();
  await db
    .insert(catalogueCandidateChoices)
    .values({ candidateId, panelId, selectedColors, updatedAt: now })
    .onConflictDoUpdate({
      target: catalogueCandidateChoices.candidateId,
      set: { panelId, selectedColors, updatedAt: now },
    });
  await db
    .update(designCandidates)
    .set({ panelId, selectedColors, updatedAt: now })
    .where(eq(designCandidates.id, candidateId));
}

export async function saveArtwork(candidateId: string, imageBase64: string): Promise<void> {
  const buf = decodeImage(imageBase64);
  const path = `candidates/${slug(candidateId)}/${Date.now()}-artwork.png`;
  await putObject(path, buf, "image/png");
  const now = new Date();
  await db
    .insert(catalogueCandidateChoices)
    .values({ candidateId, artworkPath: path, selectedColors: [], updatedAt: now })
    .onConflictDoUpdate({
      target: catalogueCandidateChoices.candidateId,
      set: { artworkPath: path, updatedAt: now },
    });
  await db
    .update(designCandidates)
    .set({ artworkPath: path, updatedAt: now })
    .where(eq(designCandidates.id, candidateId));
}

async function sceneRows(productTypeId: number, panelId: string) {
  return db
    .select()
    .from(mockupPanels)
    .where(and(eq(mockupPanels.productTypeId, productTypeId), eq(mockupPanels.view, VIEW), eq(mockupPanels.panelId, panelId)))
    .orderBy(desc(mockupPanels.createdAt));
}

async function insertPanel(args: {
  productTypeId: number;
  panelId: string;
  label: string;
  garmentColor: string;
  garmentHex: string;
  kind: "produced" | "white-master";
  photo: Buffer;
  mask: Uint8Array;
  width: number;
  height: number;
  maskSource: "white-rule" | "copied-from-white" | "operator-confirmed" | "hex-segment" | "scene-reference";
  isDefault: boolean;
  uploadedBy: string | null;
  printWidthOfH?: number;
  printHeightOfH?: number;
  printTopOfH?: number;
}): Promise<string> {
  const colorSlug = slug(args.garmentColor);
  const stamp = Date.now();
  const base = `product-types/${args.productTypeId}/views/${VIEW}/panels/${args.panelId}/${colorSlug}`;
  const storagePath = `${base}/${stamp}-photo.png`;
  const maskPath = `${base}/${stamp}-mask.png`;
  await putObject(storagePath, args.photo, "image/png");
  await putObject(maskPath, await maskToPng(args.mask, args.width, args.height), "image/png");
  const [existingDefault] = await db
    .select({ panelId: mockupPanels.panelId })
    .from(mockupPanels)
    .where(and(eq(mockupPanels.productTypeId, args.productTypeId), eq(mockupPanels.view, VIEW), eq(mockupPanels.isDefault, true)))
    .limit(1);
  const sameSceneIsDefault = existingDefault?.panelId === args.panelId;
  const makeDefault = args.isDefault || !existingDefault || sameSceneIsDefault;
  if (makeDefault && existingDefault && existingDefault.panelId !== args.panelId) {
    await db
      .update(mockupPanels)
      .set({ isDefault: false })
      .where(and(eq(mockupPanels.productTypeId, args.productTypeId), eq(mockupPanels.view, VIEW)));
  }
  const [inserted] = await db.insert(mockupPanels).values({
    panelId: args.panelId,
    productTypeId: args.productTypeId,
    view: VIEW,
    label: args.label,
    garmentColor: args.garmentColor,
    garmentHex: args.garmentHex.replace(/^#/, "").toUpperCase(),
    kind: args.kind,
    storagePath,
    maskPath,
    maskSource: args.maskSource,
    width: args.width,
    height: args.height,
    printWidthOfH: String(args.printWidthOfH ?? DEFAULT_PRINT_FRACTIONS.widthOfH),
    printHeightOfH: String(args.printHeightOfH ?? DEFAULT_PRINT_FRACTIONS.heightOfH),
    printTopOfH: String(args.printTopOfH ?? DEFAULT_PRINT_FRACTIONS.topOfH),
    printRotationDeg: String(DEFAULT_PRINT_FRACTIONS.rotationDeg),
    isDefault: makeDefault,
    uploadedBy: args.uploadedBy,
  }).returning({ id: mockupPanels.id });
  if (makeDefault) {
    await db
      .update(mockupPanels)
      .set({ isDefault: true })
      .where(and(eq(mockupPanels.productTypeId, args.productTypeId), eq(mockupPanels.view, VIEW), eq(mockupPanels.panelId, args.panelId)));
  }
  if (!inserted) throw new Error("The blank was not stored");
  return inserted.id;
}

export async function storeSegmentedPanel(args: {
  productTypeId: number;
  label: string;
  panelId?: string | null;
  garmentColor: string;
  garmentHex: string;
  kind: "produced" | "white-master";
  isDefault: boolean;
  imageBase64: string;
  uploadedBy: string | null;
  printWidthOfH?: number;
  printHeightOfH?: number;
  printTopOfH?: number;
}): Promise<{
  stored: true;
  panelId: string;
  areaFraction: number;
  touchesEdge: boolean;
  disconnected: boolean;
  outlineJpegBase64: string;
}> {
  const photo = decodeImage(args.imageBase64);
  const decoded = await decodeRgba(photo);
  const panelId = (args.panelId || slug(args.label)).slice(0, 80);
  const hex = args.garmentHex.replace(/^#/, "").toUpperCase();
  const white = args.kind === "white-master" || hex === "FFFFFF";
  const segment = white
    ? describeWhiteSegment(decoded.rgba, decoded.width, decoded.height)
    : segmentGarmentNearHex(decoded.rgba, decoded.width, decoded.height, hex);
  const outline = await garmentOutlineJpeg(decoded.rgba, decoded.width, decoded.height, segment.mask);
  const fractions = {
    widthOfH: args.printWidthOfH ?? DEFAULT_PRINT_FRACTIONS.widthOfH,
    heightOfH: args.printHeightOfH ?? DEFAULT_PRINT_FRACTIONS.heightOfH,
    topOfH: args.printTopOfH ?? DEFAULT_PRINT_FRACTIONS.topOfH,
    rotationDeg: 0,
  };
  try {
    printRectForMask(segment.mask, decoded.width, decoded.height, fractions);
  } catch (e: any) {
    throw Object.assign(new Error(String(e?.message || e)), {
      areaFraction: segment.areaFraction,
      touchesEdge: segment.touchesEdge,
      disconnected: segment.disconnected,
      outlineJpegBase64: outline.toString("base64"),
    });
  }
  await insertPanel({
    productTypeId: args.productTypeId,
    panelId,
    label: args.label || panelId,
    garmentColor: args.garmentColor,
    garmentHex: hex,
    kind: white ? "white-master" : "produced",
    photo,
    mask: segment.mask,
    width: decoded.width,
    height: decoded.height,
    maskSource: white ? "white-rule" : "hex-segment",
    isDefault: args.isDefault,
    uploadedBy: args.uploadedBy,
    printWidthOfH: fractions.widthOfH,
    printHeightOfH: fractions.heightOfH,
    printTopOfH: fractions.topOfH,
  });
  return {
    stored: true,
    panelId,
    areaFraction: segment.areaFraction,
    touchesEdge: segment.touchesEdge,
    disconnected: segment.disconnected,
    outlineJpegBase64: outline.toString("base64"),
  };
}

export type ImportSegment = {
  panelId: string;
  label: string;
  garmentColor: string;
  garmentHex: string;
  kind: "produced" | "white-master";
  isDefault: boolean;
  photo: Buffer;
  width: number;
  height: number;
};

export async function segmentImportPhoto(photo: Buffer, hex: string, kind: "produced" | "white-master"): Promise<{
  mask: Uint8Array;
  width: number;
  height: number;
  areaFraction: number;
}> {
  const decoded = await decodeRgba(photo);
  const white = kind === "white-master" || hex.toUpperCase() === "FFFFFF";
  const segment = white
    ? describeWhiteSegment(decoded.rgba, decoded.width, decoded.height)
    : segmentGarmentNearHex(decoded.rgba, decoded.width, decoded.height, hex);
  return { mask: segment.mask, width: decoded.width, height: decoded.height, areaFraction: segment.areaFraction };
}

export async function stageImportFile(args: {
  label: string;
  panelId?: string | null;
  garmentColor: string;
  garmentHex: string;
  kind: "produced" | "white-master";
  isDefault: boolean;
  imageBase64: string;
}): Promise<{ stageId: string; panelId: string; areaFraction: number; garmentHex: string; garmentColor: string }> {
  const photo = decodeImage(args.imageBase64);
  const decoded = await decodeRgba(photo);
  const hex = args.garmentHex.replace(/^#/, "").toUpperCase();
  const stageId = randomUUID();
  const base = `pending-import/${stageId}`;
  await putObject(`${base}/photo.png`, photo, "image/png");
  await putObject(`${base}/meta.json`, Buffer.from(JSON.stringify({
    panelId: (args.panelId || slug(args.label)).slice(0, 80),
    label: args.label,
    garmentColor: args.garmentColor,
    garmentHex: hex,
    kind: args.kind === "white-master" || hex === "FFFFFF" ? "white-master" : "produced",
    isDefault: args.isDefault,
    width: decoded.width,
    height: decoded.height,
  })), "application/json");
  return {
    stageId,
    panelId: (args.panelId || slug(args.label)).slice(0, 80),
    areaFraction: 0,
    garmentHex: hex,
    garmentColor: args.garmentColor,
  };
}

async function loadStaged(stageId: string): Promise<ImportSegment> {
  if (!/^[0-9a-f-]{36}$/i.test(stageId)) throw new Error("Unknown staged file");
  const base = `pending-import/${stageId}`;
  const meta = JSON.parse((await getObject(`${base}/meta.json`)).toString("utf8")) as Omit<ImportSegment, "photo">;
  const photo = await getObject(`${base}/photo.png`);
  return { ...meta, photo };
}

export async function finalizeSceneImport(
  productTypeId: number,
  batch: ImportSegment[],
  uploadedBy: string | null,
): Promise<{
  scenes: Array<{
    panelId: string;
    error: string;
    referenceHex: string;
    referenceColor: string;
    areaFraction: number;
    printWidthOfH: number;
    printHeightOfH: number;
    printTopOfH: number;
    heightOfImage: number;
    topOfImage: number;
    centreOfImage: number;
    rows: Array<{ garmentColor: string; hex: string; areaFraction: number; disconnected: boolean; outlineJpegBase64: string; error: string }>;
  }>;
}> {
  const groups = new Map<string, ImportSegment[]>();
  for (const row of batch) {
    const list = groups.get(row.panelId) || [];
    list.push(row);
    groups.set(row.panelId, list);
  }
  const scenes = [];
  for (const [panelId, files] of groups) {
    const empty = {
      referenceHex: "",
      referenceColor: "",
      areaFraction: 0,
      printWidthOfH: 0,
      printHeightOfH: 0,
      printTopOfH: 0,
      heightOfImage: 0,
      topOfImage: 0,
      centreOfImage: 0,
    };
    const fail = (message: string) => scenes.push({
      panelId,
      error: message,
      ...empty,
      rows: files.map((file) => ({
        garmentColor: file.garmentColor,
        hex: file.garmentHex,
        areaFraction: 0,
        disconnected: false,
        outlineJpegBase64: "",
        error: message,
      })),
    });
    const width = files[0].width;
    const height = files[0].height;
    if (files.some((file) => file.width !== width || file.height !== height)) {
      fail(`${panelId} has files of different pixel sizes, so nothing in that scene was stored.`);
      continue;
    }
    const decoded = new Map<string, { rgba: Uint8Array; width: number; height: number }>();
    for (const file of files) {
      const photo = await decodeRgba(file.photo);
      decoded.set(file.garmentHex.toUpperCase(), photo);
    }
    const reference = chooseSceneReference(
      files.map((file) => {
        const photo = decoded.get(file.garmentHex.toUpperCase())!;
        return { hex: file.garmentHex, rgba: photo.rgba, width: photo.width, height: photo.height };
      }),
    );
    if (!reference) {
      fail(`${panelId} has no usable mask from sage, pink or blue, so nothing in that scene was stored.`);
      continue;
    }
    const rows = [];
    for (const file of files) {
      const photo = decoded.get(file.garmentHex.toUpperCase())!;
      const outline = await garmentOutlineJpeg(photo.rgba, width, height, reference.mask);
      const white = file.kind === "white-master" || file.garmentHex.toUpperCase() === "FFFFFF";
      await insertPanel({
        productTypeId,
        panelId,
        label: file.label || panelId,
        garmentColor: file.garmentColor,
        garmentHex: file.garmentHex,
        kind: white ? "white-master" : "produced",
        photo: file.photo,
        mask: reference.mask,
        width,
        height,
        maskSource: "scene-reference",
        isDefault: file.isDefault,
        uploadedBy,
      });
      rows.push({
        garmentColor: file.garmentColor,
        hex: file.garmentHex,
        areaFraction: reference.areaFraction,
        disconnected: false,
        outlineJpegBase64: outline.toString("base64"),
        error: "",
      });
    }
    const referenceFile = files.find((file) => file.garmentHex.toUpperCase() === reference.hex);
    scenes.push({
      panelId,
      error: "",
      referenceHex: reference.hex,
      referenceColor: referenceFile?.garmentColor || reference.hex,
      areaFraction: reference.areaFraction,
      printWidthOfH: reference.printWidthOfH,
      printHeightOfH: reference.printHeightOfH,
      printTopOfH: reference.printTopOfH,
      heightOfImage: reference.heightOfImage,
      topOfImage: reference.topOfImage,
      centreOfImage: reference.centreOfImage,
      rows,
    });
  }
  return { scenes };
}

export async function commitStagedImport(productTypeId: number, stageIds: string[], uploadedBy: string | null) {
  const batch: ImportSegment[] = [];
  for (const stageId of stageIds) batch.push(await loadStaged(stageId));
  return finalizeSceneImport(productTypeId, batch, uploadedBy);
}

export type PrepareResult =
  | { stored: true; maskSource: "copied-from-white"; panelId: string }
  | { needsConfirm: true; uploadId: string; panelId: string; maskPngBase64: string };

export async function preparePanelUpload(args: {
  productTypeId: number;
  label: string;
  panelId?: string | null;
  garmentColor: string;
  garmentHex: string;
  kind: "produced" | "white-master";
  isDefault: boolean;
  imageBase64: string;
  uploadedBy: string | null;
  forceConfirm?: boolean;
}): Promise<PrepareResult> {
  const photo = decodeImage(args.imageBase64);
  const decoded = await decodeRgba(photo);
  const panelId = (args.panelId || slug(args.label)).slice(0, 80);
  const whiteRow = (await sceneRows(args.productTypeId, panelId)).find((row) => row.kind === "white-master");
  const isWhite = args.kind === "white-master" || args.garmentColor.trim().toLowerCase() === "white";
  let proposed: Uint8Array | null = null;
  let copied = false;
  if (isWhite) {
    proposed = segmentWhiteGarment(decoded.rgba, decoded.width, decoded.height);
  } else if (whiteRow) {
    const whitePhoto = await getObject(whiteRow.storagePath);
    const whiteMaskPng = await getObject(whiteRow.maskPath);
    const white = await decodeRgba(whitePhoto);
    const whiteMask = await maskFromPng(whiteMaskPng, white.width, white.height);
    const check = backgroundAgrees(white.rgba, decoded.rgba, whiteMask, white.width, white.height, decoded.width, decoded.height);
    if (check.agree && !args.forceConfirm) {
      await insertPanel({
        productTypeId: args.productTypeId,
        panelId,
        label: args.label || whiteRow.label,
        garmentColor: args.garmentColor,
        garmentHex: args.garmentHex,
        kind: "produced",
        photo,
        mask: whiteMask,
        width: decoded.width,
        height: decoded.height,
        maskSource: "copied-from-white",
        isDefault: args.isDefault,
        uploadedBy: args.uploadedBy,
      });
      copied = true;
    } else {
      proposed = white.width === decoded.width && white.height === decoded.height
        ? whiteMask
        : scaleMask(whiteMask, white.width, white.height, decoded.width, decoded.height);
    }
  }
  if (copied) return { stored: true, maskSource: "copied-from-white", panelId };
  const uploadId = randomUUID();
  const mask = proposed ?? new Uint8Array(decoded.width * decoded.height);
  const base = `pending/${uploadId}`;
  await putObject(`${base}/photo.png`, photo, "image/png");
  await putObject(`${base}/mask.png`, await maskToPng(mask, decoded.width, decoded.height), "image/png");
  await putObject(`${base}/meta.json`, Buffer.from(JSON.stringify({
    productTypeId: args.productTypeId,
    panelId,
    label: args.label,
    garmentColor: args.garmentColor,
    garmentHex: args.garmentHex.replace(/^#/, "").toUpperCase(),
    kind: isWhite ? "white-master" : "produced",
    isDefault: args.isDefault,
    uploadedBy: args.uploadedBy,
    maskSource: isWhite ? "white-rule" : "operator-confirmed",
    width: decoded.width,
    height: decoded.height,
  })), "application/json");
  return { needsConfirm: true, uploadId, panelId, maskPngBase64: (await maskToPng(mask, decoded.width, decoded.height)).toString("base64") };
}

export async function confirmPanelUpload(uploadId: string, maskPngBase64: string): Promise<{ panelId: string }> {
  if (!/^[0-9a-f-]{36}$/i.test(uploadId)) throw new Error("Unknown upload");
  const base = `pending/${uploadId}`;
  const meta = JSON.parse((await getObject(`${base}/meta.json`)).toString("utf8")) as {
    productTypeId: number;
    panelId: string;
    label: string;
    garmentColor: string;
    garmentHex: string;
    kind: "produced" | "white-master";
    isDefault: boolean;
    uploadedBy: string | null;
    maskSource: "white-rule" | "operator-confirmed";
    width: number;
    height: number;
  };
  const photo = await getObject(`${base}/photo.png`);
  const proposed = await maskFromPng(await getObject(`${base}/mask.png`), meta.width, meta.height);
  const confirmed = await maskFromPng(decodeImage(maskPngBase64), meta.width, meta.height);
  let changed = false;
  for (let i = 0; i < proposed.length; i++) if (proposed[i] !== confirmed[i]) changed = true;
  await insertPanel({
    productTypeId: meta.productTypeId,
    panelId: meta.panelId,
    label: meta.label,
    garmentColor: meta.garmentColor,
    garmentHex: meta.garmentHex,
    kind: meta.kind,
    photo,
    mask: confirmed,
    width: meta.width,
    height: meta.height,
    maskSource: changed ? "operator-confirmed" : meta.maskSource,
    isDefault: meta.isDefault,
    uploadedBy: meta.uploadedBy,
  });
  return { panelId: meta.panelId };
}

/** Outlines from the masks already stored. Does not segment again. */
export async function reviewStoredScene(productTypeId: number, panelId: string): Promise<Array<{
  panelId: string;
  garmentColor: string;
  hex: string;
  areaFraction: number;
  disconnected: boolean;
  outlineJpegBase64: string;
  error: string;
}>> {
  const rows = await sceneRows(productTypeId, panelId);
  const seen = new Set<string>();
  const cells = [];
  for (const row of rows) {
    const key = row.garmentColor.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const [photo, maskPng] = await Promise.all([getObject(row.storagePath), getObject(row.maskPath)]);
    const decoded = await decodeRgba(photo);
    const mask = await maskFromPng(maskPng, decoded.width, decoded.height);
    const report = storedMaskReport(mask, decoded.width, decoded.height);
    const outline = await garmentOutlineJpeg(decoded.rgba, decoded.width, decoded.height, mask);
    cells.push({
      panelId: row.panelId,
      garmentColor: row.garmentColor,
      hex: row.garmentHex,
      areaFraction: report.areaFraction,
      disconnected: report.disconnected,
      outlineJpegBase64: outline.toString("base64"),
      error: "",
    });
  }
  return cells;
}

export async function renderCandidateOnPanel(args: {
  productTypeId: number;
  typeName: string;
  panelId: string;
  colorName: string;
  colorHex: string;
  artworkPath: string | null;
  /**
   * STAGING-103 added, STAGING-104 defused. Opt-in escape hatch: skip
   * resolvePanelColour's "exact match → produced" branch and ALWAYS recolour
   * from the white master, regardless of whether the requested colour has a
   * dedicated produced row. Originally shipped as a stopgap for a reported
   * "My Pet pre-composite shows the original design" symptom; offline tracing
   * against staging data (render 25a79e80, panel Mockup_01, product type 54)
   * proved the produced path composites correctly in both modes — the
   * original-design visual was the catalogue-side mockupImages (written by
   * approveCandidateChoice from the ORIGINAL artwork, uploaded to Shopify
   * by flywheel-promote as variant images) leaking through a client-side
   * hero-swap race against the Shopify theme's variant-image change, not a
   * compose bug. Parameter retained so a future "the per-colour produced row
   * for this product really is bad, force white+recolour" need has a tested
   * knob to turn without re-plumbing. No current callers pass it.
   */
  forceRecolour?: boolean;
  /** Omit to use this type's placement. Types 56 and 58 are full-size and top-anchored. */
  scale?: number;
  anchor?: "top" | "center";
}): Promise<{ png: Buffer; source: "produced" | "recolour" }> {
  const loaded = await loadCandidatePanel(args);
  const placement = placementForProductType(args.productTypeId);
  const { chestFitForProductType } = await import("./colour-blanks");
  const chest = await chestFitForProductType(args.productTypeId);
  const png = await renderArtworkOnPanel({
    photo: loaded.photo,
    maskPng: loaded.maskPng,
    artwork: loaded.artwork,
    mode: loaded.resolved.kind,
    hex: loaded.resolved.hex,
    fractions: loaded.fractions,
    scale: args.scale ?? placement.mockupScale,
    anchor: args.anchor ?? placement.anchor,
    chest: chest ?? undefined,
  });
  return { png, source: loaded.resolved.kind };
}

async function loadCandidatePanel(args: {
  productTypeId: number;
  typeName: string;
  panelId: string;
  colorName: string;
  colorHex: string;
  artworkPath: string | null;
  forceRecolour?: boolean;
}) {
  const { blankLibraryTypeId, printFractionsForType } = await import("./colour-blanks");
  const libraryId = await blankLibraryTypeId(args.productTypeId);
  const rows = await sceneRows(libraryId, args.panelId);
  if (!rows.length) {
    resolvePanelColour([], { name: args.colorName, hex: args.colorHex }, args.typeName, args.productTypeId, args.panelId);
  }
  const colours: PanelColour[] = rows.map((row) => ({
    name: row.garmentColor,
    hex: row.garmentHex,
    kind: row.kind === "white-master" ? "white-master" : "produced",
  }));
  const libraryColours = await db
    .select({ name: mockupLibraryColours.name, linkStoredName: mockupLibraryColours.linkStoredName })
    .from(mockupLibraryColours)
    .where(eq(mockupLibraryColours.productTypeId, libraryId));
  const { blankNameKey } = await import("@shared/colourBlanks");
  const requestedKey = blankNameKey(args.colorName);
  const linkedName = libraryColours.find((row) => blankNameKey(row.name) === requestedKey)?.linkStoredName?.trim() || "";
  const label = rows[0].label;
  // STAGING-103 — when forceRecolour is set, bypass exact-match resolution
  // and always route through the white-master recolour path. Throws with
  // the same shape of error resolvePanelColour would if no white master
  // row exists for the panel.
  const resolved = args.forceRecolour
    ? (() => {
        const white = colours.find((c) => c.kind === "white-master");
        if (!white) {
          throw new Error(
            `${args.colorName} on ${args.typeName} (${args.productTypeId}), panel ${label}, has no white master (forceRecolour requested)`,
          );
        }
        return { kind: "recolour" as const, hex: args.colorHex, sourceName: white.name };
      })()
    : resolvePanelColour(colours, { name: args.colorName, hex: args.colorHex }, args.typeName, args.productTypeId, label);
  if (!args.forceRecolour && resolved.kind === "recolour" && linkedName) {
    const linked = colours.find((colour) => blankNameKey(colour.name) === blankNameKey(linkedName) && colour.kind === "produced");
    if (linked) {
      resolved.kind = "produced";
      resolved.hex = linked.hex;
      resolved.sourceName = linked.name;
    }
  }
  const sourceRow = rows.find((row) => blankNameKey(row.garmentColor) === blankNameKey(resolved.sourceName));
  if (!sourceRow) throw new Error(`${args.colorName} on ${args.typeName} (${args.productTypeId}), panel ${label}, has no produced colourway and no white master`);
  if (!args.artworkPath) throw new Error("Candidate artwork is not stored. Upload it once on this page.");
  const [photo, maskPng, artwork] = await Promise.all([
    getObject(sourceRow.storagePath),
    getObject(sourceRow.maskPath),
    getObject(args.artworkPath),
  ]);
  const stored = {
    widthOfH: Number(sourceRow.printWidthOfH),
    heightOfH: Number(sourceRow.printHeightOfH),
    topOfH: Number(sourceRow.printTopOfH),
    rotationDeg: Number(sourceRow.printRotationDeg),
  };
  const own = await printFractionsForType(args.productTypeId);
  const fractions = own ?? stored;
  return { photo, maskPng, artwork, resolved, fractions, sourceRow };
}

export async function measureCandidateInk(args: {
  productTypeId: number;
  typeName: string;
  panelId: string;
  colorName: string;
  colorHex: string;
  artworkPath: string | null;
}) {
  const loaded = await loadCandidatePanel(args);
  const placement = placementForProductType(args.productTypeId);
  const { chestFitForProductType } = await import("./colour-blanks");
  const chest = await chestFitForProductType(args.productTypeId);
  return measurePlacedInk({
    photo: loaded.photo,
    maskPng: loaded.maskPng,
    artwork: loaded.artwork,
    mode: loaded.resolved.kind,
    hex: loaded.resolved.hex,
    fractions: loaded.fractions,
    scale: placement.mockupScale,
    anchor: placement.anchor,
    chest: chest ?? undefined,
  });
}

export async function candidatePrintifyArtwork(args: {
  productTypeId: number;
  typeName: string;
  panelId: string;
  colorName: string;
  colorHex: string;
  artworkPath: string | null;
}) {
  const loaded = await loadCandidatePanel(args);
  const placement = placementForProductType(args.productTypeId);
  const { chestFitForProductType } = await import("./colour-blanks");
  const chest = await chestFitForProductType(args.productTypeId);
  const preview = await artworkForPrintifyPreview({
    photo: loaded.photo,
    maskPng: loaded.maskPng,
    artwork: loaded.artwork,
    mode: loaded.resolved.kind,
    hex: loaded.resolved.hex,
    fractions: loaded.fractions,
    scale: placement.mockupScale,
    anchor: placement.anchor,
    chest: chest ?? undefined,
  });
  return preview;
}

export async function approveCandidateChoice(args: {
  candidateId: string;
  productTypeId: number;
  typeName: string;
  panelId: string;
  selectedColors: ChoiceColor[];
  /** Render mockups without replacing the candidate's saved colour list. */
  preserveStoredColours?: boolean;
}): Promise<StoredMockupImage[]> {
  if (!args.selectedColors.length) throw new Error("No colours selected");
  const { blankLibraryTypeId } = await import("./colour-blanks");
  const libraryId = await blankLibraryTypeId(args.productTypeId);
  const rows = await sceneRows(libraryId, args.panelId);
  const label = rows[0]?.label || args.panelId;
  const colours: PanelColour[] = rows.map((row) => ({
    name: row.garmentColor,
    hex: row.garmentHex,
    kind: row.kind === "white-master" ? "white-master" : "produced",
  }));
  for (const color of args.selectedColors) {
    resolvePanelColour(colours, color, args.typeName, args.productTypeId, label);
  }
  const now = new Date();
  if (!args.preserveStoredColours) {
    await saveChoice(args.candidateId, args.panelId, args.selectedColors);
  }
  const choice = await readChoice(args.candidateId);
  if (!choice.artworkPath) throw new Error("Candidate artwork is not stored. Upload it once on this page.");
  const mockupImages: StoredMockupImage[] = [];
  for (const color of args.selectedColors) {
    const rendered = await renderCandidateOnPanel({
      productTypeId: args.productTypeId,
      typeName: args.typeName,
      panelId: args.panelId,
      colorName: color.name,
      colorHex: color.hex,
      artworkPath: choice.artworkPath,
    });
    const jpeg = await sharp(rendered.png).jpeg({ quality: 90 }).toBuffer();
    const path = `candidates/${slug(args.candidateId)}/${Date.now()}-${slug(color.name)}-front.jpg`;
    await putObject(path, jpeg, "image/jpeg");
    mockupImages.push({ name: color.name, hex: color.hex.replace(/^#/, ""), path });
  }
  if (!args.preserveStoredColours) {
    await db
      .update(catalogueCandidateChoices)
      .set({ approvedAt: now, updatedAt: now, mockupImages })
      .where(eq(catalogueCandidateChoices.candidateId, args.candidateId));
  }
  return mockupImages;
}

/** One colour mockup for an existing design. Does not change the saved colour list. */
export async function storeCandidateColourMockup(args: {
  candidateId: string;
  productTypeId: number;
  typeName: string;
  panelId: string;
  colorName: string;
  colorHex: string;
  artworkPath: string;
}): Promise<StoredMockupImage> {
  const rendered = await renderCandidateOnPanel({
    productTypeId: args.productTypeId,
    typeName: args.typeName,
    panelId: args.panelId,
    colorName: args.colorName,
    colorHex: args.colorHex,
    artworkPath: args.artworkPath,
  });
  const jpeg = await sharp(rendered.png).jpeg({ quality: 90 }).toBuffer();
  const path = `candidates/${slug(args.candidateId)}/${Date.now()}-${slug(args.colorName)}-front.jpg`;
  await putObject(path, jpeg, "image/jpeg");
  return { name: args.colorName, hex: args.colorHex.replace(/^#/, ""), path };
}

export async function panelsForType(productTypeId: number) {
  return db
    .select()
    .from(mockupPanels)
    .where(and(eq(mockupPanels.productTypeId, productTypeId), eq(mockupPanels.view, VIEW)))
    .orderBy(desc(mockupPanels.createdAt));
}

async function loadWhiteMaster(productTypeId: number, panelId: string) {
  const white = (await sceneRows(productTypeId, panelId)).find((row) => row.kind === "white-master");
  if (!white) throw new Error(`${panelId} has no white master to paint from`);
  return white;
}

async function paintWhiteMaster(productTypeId: number, panelId: string, hex: string) {
  const white = await loadWhiteMaster(productTypeId, panelId);
  const decoded = await decodeRgba(await getObject(white.storagePath));
  const mask = await maskFromPng(await getObject(white.maskPath), decoded.width, decoded.height);
  const median = medianShadingLuminance(Buffer.from(decoded.rgba), decoded.width, decoded.height, mask);
  const rgba = recolorGarment(decoded.rgba, decoded.width, decoded.height, mask, hex.replace(/^#/, "").toUpperCase(), median);
  const png = await sharp(Buffer.from(rgba), { raw: { width: decoded.width, height: decoded.height, channels: 4 } }).png().toBuffer();
  const jpeg = await sharp(png).jpeg({ quality: 82 }).toBuffer();
  return { png, jpeg, mask, width: decoded.width, height: decoded.height, label: white.label };
}

/** Preview only. The caller saves a produced row with approvePaintedBlank. */
export async function previewPaintedBlank(productTypeId: number, panelId: string, hex: string) {
  const painted = await paintWhiteMaster(productTypeId, panelId, hex);
  return { jpegBase64: painted.jpeg.toString("base64"), width: painted.width, height: painted.height };
}

/** Re-renders on the server and stores a produced blank under the exact colour name. */
export async function approvePaintedBlank(args: {
  productTypeId: number;
  panelId: string;
  garmentColor: string;
  garmentHex: string;
  uploadedBy: string | null;
}) {
  const painted = await paintWhiteMaster(args.productTypeId, args.panelId, args.garmentHex);
  const id = await insertPanel({
    productTypeId: args.productTypeId,
    panelId: args.panelId,
    label: painted.label,
    garmentColor: args.garmentColor,
    garmentHex: args.garmentHex,
    kind: "produced",
    photo: painted.png,
    mask: painted.mask,
    width: painted.width,
    height: painted.height,
    maskSource: "copied-from-white",
    isDefault: false,
    uploadedBy: args.uploadedBy,
  });
  return { id, panelId: args.panelId };
}

async function resampleToMaster(photo: Buffer, width: number, height: number): Promise<{ buffer: Buffer; resized: boolean; fromWidth: number; fromHeight: number }> {
  const meta = await sharp(photo).metadata();
  const fromWidth = meta.width || 0;
  const fromHeight = meta.height || 0;
  if (fromWidth === width && fromHeight === height) return { buffer: photo, resized: false, fromWidth, fromHeight };
  const buffer = await sharp(photo).resize(width, height, { fit: "fill", kernel: sharp.kernel.lanczos3 }).png().toBuffer();
  return { buffer, resized: true, fromWidth, fromHeight };
}

async function loadWhiteMasterPhoto(productTypeId: number, panelId: string) {
  const white = await loadWhiteMaster(productTypeId, panelId);
  const whitePhoto = await getObject(white.storagePath);
  const whiteDecoded = await decodeRgba(whitePhoto);
  const whiteMask = await maskFromPng(await getObject(white.maskPath), whiteDecoded.width, whiteDecoded.height);
  return { white, whitePhoto, whiteDecoded, whiteMask };
}

/** Long edge of the images the colour-blanks cell actually shows (the cell is 112px CSS). */
const PREVIEW_DISPLAY_EDGE = 480;

async function displayJpeg(source: Buffer | { data: Buffer; width: number; height: number }): Promise<{ jpeg: Buffer; width: number; height: number }> {
  const image = Buffer.isBuffer(source)
    ? sharp(source)
    : sharp(source.data, { raw: { width: source.width, height: source.height, channels: 4 } });
  const rendered = await image.resize({
    width: PREVIEW_DISPLAY_EDGE,
    height: PREVIEW_DISPLAY_EDGE,
    fit: "inside",
    withoutEnlargement: true,
  }).jpeg({ quality: 80 }).toBuffer({ resolveWithObject: true });
  return { jpeg: rendered.data, width: rendered.info.width, height: rendered.info.height };
}

async function signedPreviewJpeg(productTypeId: number, jpeg: Buffer): Promise<string> {
  const path = `product-types/${productTypeId}/upload-previews/${randomUUID()}.jpg`;
  await putObject(path, jpeg, "image/jpeg");
  return signedLibraryUrl(path, 60 * 30);
}

/** Scales to the white master and scores the shirt. Does not store a blank row. */
export async function previewUploadedBlank(args: { productTypeId: number; panelId: string; imageBase64: string }) {
  const loaded = await loadWhiteMasterPhoto(args.productTypeId, args.panelId);
  const fitted = await resampleToMaster(decodeImage(args.imageBase64), loaded.whiteDecoded.width, loaded.whiteDecoded.height);
  const decoded = await decodeRgba(fitted.buffer);
  const alignment = measureGarmentAlignment(
    loaded.whiteDecoded.rgba,
    decoded.rgba,
    loaded.whiteMask,
    decoded.width,
    decoded.height,
  );
  const mixed = Buffer.alloc(decoded.rgba.length);
  const base = loaded.whiteDecoded.rgba;
  for (let i = 0; i < mixed.length; i += 4) {
    mixed[i] = Math.round(base[i] * 0.5 + decoded.rgba[i] * 0.5);
    mixed[i + 1] = Math.round(base[i + 1] * 0.5 + decoded.rgba[i + 1] * 0.5);
    mixed[i + 2] = Math.round(base[i + 2] * 0.5 + decoded.rgba[i + 2] * 0.5);
    mixed[i + 3] = 255;
  }
  const [jpeg, overlay, master] = await Promise.all([
    displayJpeg(fitted.buffer),
    displayJpeg({ data: mixed, width: decoded.width, height: decoded.height }),
    displayJpeg(loaded.whitePhoto),
  ]);
  const [jpegUrl, overlayUrl, masterUrl] = await Promise.all([
    signedPreviewJpeg(args.productTypeId, jpeg.jpeg),
    signedPreviewJpeg(args.productTypeId, overlay.jpeg),
    signedPreviewJpeg(args.productTypeId, master.jpeg),
  ]);
  return {
    jpegUrl,
    overlayUrl,
    masterUrl,
    width: decoded.width,
    height: decoded.height,
    displayWidth: overlay.width,
    displayHeight: overlay.height,
    resized: fitted.resized,
    fromWidth: fitted.fromWidth,
    fromHeight: fitted.fromHeight,
    alignment,
  };
}

export async function approveUploadedBlank(args: {
  productTypeId: number;
  panelId: string;
  garmentColor: string;
  garmentHex: string;
  imageBase64: string;
  uploadedBy: string | null;
  confirmMask?: boolean;
}): Promise<
  | { stored: true; id: string; maskSource: "copied-from-white" | "operator-confirmed" }
  | { needsConfirm: true; message: string }
> {
  const loaded = await loadWhiteMasterPhoto(args.productTypeId, args.panelId);
  const fitted = await resampleToMaster(decodeImage(args.imageBase64), loaded.whiteDecoded.width, loaded.whiteDecoded.height);
  const photo = fitted.buffer;
  const decoded = await decodeRgba(photo);
  const white = loaded.white;
  const whiteDecoded = loaded.whiteDecoded;
  const whiteMask = loaded.whiteMask;
  const check = backgroundAgrees(
    whiteDecoded.rgba,
    decoded.rgba,
    whiteMask,
    whiteDecoded.width,
    whiteDecoded.height,
    decoded.width,
    decoded.height,
  );
  let mask: Uint8Array;
  let maskSource: "copied-from-white" | "operator-confirmed";
  if (check.agree) {
    mask = whiteMask;
    maskSource = "copied-from-white";
  } else if (args.confirmMask) {
    mask = whiteDecoded.width === decoded.width && whiteDecoded.height === decoded.height
      ? whiteMask
      : scaleMask(whiteMask, whiteDecoded.width, whiteDecoded.height, decoded.width, decoded.height);
    maskSource = "operator-confirmed";
  } else {
    const detail = check.mean == null
      ? `The file is ${decoded.width}×${decoded.height} and the white master is ${whiteDecoded.width}×${whiteDecoded.height}.`
      : `The background differs from the white master (mean ${check.mean.toFixed(1)}).`;
    return { needsConfirm: true, message: `${detail} Save anyway to use the white master's mask.` };
  }
  const id = await insertPanel({
    productTypeId: args.productTypeId,
    panelId: args.panelId,
    label: white.label,
    garmentColor: args.garmentColor,
    garmentHex: args.garmentHex,
    kind: "produced",
    photo,
    mask,
    width: decoded.width,
    height: decoded.height,
    maskSource,
    isDefault: false,
    uploadedBy: args.uploadedBy,
  });
  return { stored: true, id, maskSource };
}

/** Renames stored blank rows only. Products, variants, and hex tags stay put. */
export async function renameStoredBlankColour(productTypeId: number, fromName: string, toName: string) {
  const from = fromName.trim();
  const to = toName.trim();
  if (!from || !to) throw new Error("Both names are required");
  if (from.toLowerCase() === to.toLowerCase()) throw new Error("Those names already match");
  const rows = await db
    .select({ id: mockupPanels.id, panelId: mockupPanels.panelId })
    .from(mockupPanels)
    .where(and(
      eq(mockupPanels.productTypeId, productTypeId),
      eq(mockupPanels.view, VIEW),
      sql`lower(trim(${mockupPanels.garmentColor})) = ${from.toLowerCase()}`,
    ));
  if (!rows.length) throw new Error(`No stored blanks are named ${from}`);
  await db
    .update(mockupPanels)
    .set({ garmentColor: to })
    .where(and(
      eq(mockupPanels.productTypeId, productTypeId),
      eq(mockupPanels.view, VIEW),
      sql`lower(trim(${mockupPanels.garmentColor})) = ${from.toLowerCase()}`,
    ));
  return { rows: rows.length, scenes: new Set(rows.map((row) => row.panelId)).size, from, to };
}

/** A new row pointing at the same files, so this copy becomes the one compose uses. */
export async function restoreBlankRevision(rowId: string) {
  const [row] = await db.select().from(mockupPanels).where(eq(mockupPanels.id, rowId)).limit(1);
  if (!row) throw new Error("That blank is not stored");
  const [inserted] = await db.insert(mockupPanels).values({
    panelId: row.panelId,
    productTypeId: row.productTypeId,
    view: row.view,
    label: row.label,
    garmentColor: row.garmentColor,
    garmentHex: row.garmentHex,
    kind: row.kind,
    storagePath: row.storagePath,
    maskPath: row.maskPath,
    maskSource: row.maskSource,
    width: row.width,
    height: row.height,
    printWidthOfH: row.printWidthOfH,
    printHeightOfH: row.printHeightOfH,
    printTopOfH: row.printTopOfH,
    printRotationDeg: row.printRotationDeg,
    isDefault: row.isDefault,
    uploadedBy: row.uploadedBy,
  }).returning({ id: mockupPanels.id });
  if (!inserted) throw new Error("The older blank was not restored");
  return { id: inserted.id, panelId: row.panelId, garmentColor: row.garmentColor };
}

const SCENE_MASTER_PX = 1254;

function sceneFraction(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(0.95, Math.max(0.02, value));
}

/** Scale a white master and locate the garment. Nothing is stored. */
export async function previewNewScene(imageBase64: string): Promise<{
  width: number;
  height: number;
  areaFraction: number;
  touchesEdge: boolean;
  disconnected: boolean;
  previewJpegBase64: string;
  bounds: { minX: number; minY: number; maxX: number; maxY: number; centre: number; H: number };
  placement: { widthOfH: number; heightOfH: number; topOfH: number };
}> {
  const photo = decodeImage(imageBase64);
  const scaled = await sharp(photo).resize(SCENE_MASTER_PX, SCENE_MASTER_PX, { fit: "fill", kernel: "lanczos3" }).png().toBuffer();
  const decoded = await decodeRgba(scaled);
  const segment = describeWhiteSegment(decoded.rgba, decoded.width, decoded.height);
  const bounds = maskBounds(segment.mask, decoded.width, decoded.height);
  const centre = bodyCentreline(segment.mask, decoded.width, bounds);
  const preview = await sharp(scaled).jpeg({ quality: 72 }).toBuffer();
  return {
    width: decoded.width,
    height: decoded.height,
    areaFraction: segment.areaFraction,
    touchesEdge: segment.touchesEdge,
    disconnected: segment.disconnected,
    previewJpegBase64: preview.toString("base64"),
    bounds: { minX: bounds.minX, minY: bounds.minY, maxX: bounds.maxX, maxY: bounds.maxY, centre, H: bounds.H },
    placement: {
      widthOfH: DEFAULT_PRINT_FRACTIONS.widthOfH,
      heightOfH: DEFAULT_PRINT_FRACTIONS.heightOfH,
      topOfH: DEFAULT_PRINT_FRACTIONS.topOfH,
    },
  };
}

/** Store the white master only after the operator approves the print box. */
export async function approveNewScene(args: {
  productTypeId: number;
  label: string;
  imageBase64: string;
  widthOfH: number;
  heightOfH: number;
  topOfH: number;
  uploadedBy: string | null;
}): Promise<{ panelId: string; areaFraction: number }> {
  const label = args.label.trim().slice(0, 80);
  if (!label) throw new Error("Name the scene first.");
  const photo = decodeImage(args.imageBase64);
  const scaled = await sharp(photo).resize(SCENE_MASTER_PX, SCENE_MASTER_PX, { fit: "fill", kernel: "lanczos3" }).png().toBuffer();
  const stored = await storeSegmentedPanel({
    productTypeId: args.productTypeId,
    label,
    garmentColor: "White",
    garmentHex: "FFFFFF",
    kind: "white-master",
    isDefault: false,
    imageBase64: scaled.toString("base64"),
    uploadedBy: args.uploadedBy,
    printWidthOfH: sceneFraction(args.widthOfH, DEFAULT_PRINT_FRACTIONS.widthOfH),
    printHeightOfH: sceneFraction(args.heightOfH, DEFAULT_PRINT_FRACTIONS.heightOfH),
    printTopOfH: sceneFraction(args.topOfH, DEFAULT_PRINT_FRACTIONS.topOfH),
  });
  return { panelId: stored.panelId, areaFraction: stored.areaFraction };
}

export async function signedBlankPhoto(rowId: string) {
  const [row] = await db.select().from(mockupPanels).where(eq(mockupPanels.id, rowId)).limit(1);
  if (!row) throw new Error("That blank is not stored");
  return {
    url: await signedLibraryUrl(row.storagePath),
    createdAt: row.createdAt.toISOString(),
    garmentColor: row.garmentColor,
    garmentHex: row.garmentHex,
    kind: row.kind,
    panelId: row.panelId,
  };
}

/** Removes every blank on one scene. Refuses when a published product still uses it. */
export async function deleteUnusedScene(productTypeId: number, panelId: string): Promise<{ panelId: string; rows: number }> {
  const id = panelId.trim();
  if (!id) throw new Error("Name the scene first.");
  const rows = await db
    .select({
      id: mockupPanels.id,
      storagePath: mockupPanels.storagePath,
      maskPath: mockupPanels.maskPath,
      isDefault: mockupPanels.isDefault,
      label: mockupPanels.label,
    })
    .from(mockupPanels)
    .where(and(eq(mockupPanels.productTypeId, productTypeId), eq(mockupPanels.panelId, id)));
  if (!rows.length) throw new Error("That scene is not on this product type.");

  const used = await db
    .select({ title: designProducts.title })
    .from(designCandidates)
    .innerJoin(designProducts, eq(designProducts.id, designCandidates.designProductId))
    .where(and(
      eq(designCandidates.panelId, id),
      eq(designProducts.productTypeId, productTypeId),
      eq(designProducts.status, "active"),
      sql`${designProducts.shopifyProductId} is not null`,
    ));
  const usedChoice = await db
    .select({ title: designProducts.title })
    .from(catalogueCandidateChoices)
    .innerJoin(designCandidates, eq(designCandidates.id, catalogueCandidateChoices.candidateId))
    .innerJoin(designProducts, eq(designProducts.id, designCandidates.designProductId))
    .where(and(
      eq(catalogueCandidateChoices.panelId, id),
      eq(designProducts.productTypeId, productTypeId),
      eq(designProducts.status, "active"),
      sql`${designProducts.shopifyProductId} is not null`,
    ));
  const titles = [...new Set([...used, ...usedChoice].map((row) => row.title).filter(Boolean))];
  if (titles.length) {
    const label = rows[0]?.label || id;
    const extra = titles.length > 1 ? ` and ${titles.length - 1} more` : "";
    throw new Error(`${label} is used by the published product "${titles[0]}"${extra}.`);
  }

  await db.delete(mockupPanels).where(and(
    eq(mockupPanels.productTypeId, productTypeId),
    eq(mockupPanels.panelId, id),
  ));

  const [elsewhere] = await db
    .select({ id: mockupPanels.id })
    .from(mockupPanels)
    .where(and(eq(mockupPanels.panelId, id), ne(mockupPanels.productTypeId, productTypeId)))
    .limit(1);
  if (!elsewhere) {
    await db.execute(sql`UPDATE design_candidates
      SET panel_id = NULL, updated_at = now()
      WHERE panel_id = ${id} AND shopify_product_id IS NULL`);
    await db.execute(sql`UPDATE catalogue_candidate_choices AS choice
      SET panel_id = NULL
      WHERE choice.panel_id = ${id}
        AND NOT EXISTS (
          SELECT 1 FROM design_candidates AS candidate
          WHERE candidate.id = choice.candidate_id AND candidate.shopify_product_id IS NOT NULL
        )`);
  }

  if (rows.some((row) => row.isDefault)) {
    const [next] = await db
      .select({ panelId: mockupPanels.panelId })
      .from(mockupPanels)
      .where(eq(mockupPanels.productTypeId, productTypeId))
      .orderBy(desc(mockupPanels.createdAt))
      .limit(1);
    if (next) {
      await db.update(mockupPanels).set({ isDefault: true }).where(and(
        eq(mockupPanels.productTypeId, productTypeId),
        eq(mockupPanels.panelId, next.panelId),
      ));
    }
  }

  for (const row of rows) {
    await removeLibraryObject(row.storagePath).catch(() => undefined);
    await removeLibraryObject(row.maskPath).catch(() => undefined);
  }
  return { panelId: id, rows: rows.length };
}
