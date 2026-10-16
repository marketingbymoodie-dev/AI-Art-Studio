/**
 * Photographs for the catalogue compositor. One row is one scene colour.
 * Panels are keyed by product type. A second tee blueprint re-uploads its own set.
 */
import { randomUUID } from "crypto";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { catalogueCandidateChoices, designCandidates, mockupPanels, productTypes } from "@shared/schema";
import { db } from "./db";
import "./load-env";
import {
  backgroundAgrees,
  decodeRgba,
  DEFAULT_PRINT_FRACTIONS,
  describeWhiteSegment,
  garmentOutlineJpeg,
  maskFromPng,
  maskToPng,
  printRectForMask,
  renderArtworkOnPanel,
  resolvePanelColour,
  scaleMask,
  segmentGarmentNearHex,
  segmentWhiteGarment,
  type PanelColour,
} from "./mockup-library";

const BUCKET = "mockup-library";
const VIEW = "front";

export type StoredColour = PanelColour & { id: string };

export type SceneGroup = {
  panelId: string;
  label: string;
  isDefault: boolean;
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
      group = { panelId: row.panelId, label: row.label, isDefault: false, colours: [] };
      groups.set(row.panelId, group);
    }
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

export async function readChoice(candidateId: string): Promise<{ panelId: string | null; selectedColors: ChoiceColor[]; artworkPath: string | null }> {
  const [row] = await db.select().from(catalogueCandidateChoices).where(eq(catalogueCandidateChoices.candidateId, candidateId)).limit(1);
  return {
    panelId: row?.panelId ?? null,
    selectedColors: Array.isArray(row?.selectedColors) ? row.selectedColors : [],
    artworkPath: row?.artworkPath ?? null,
  };
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
  maskSource: "white-rule" | "copied-from-white" | "operator-confirmed" | "hex-segment";
  isDefault: boolean;
  uploadedBy: string | null;
}): Promise<void> {
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
  await db.insert(mockupPanels).values({
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
    printWidthOfH: String(DEFAULT_PRINT_FRACTIONS.widthOfH),
    printHeightOfH: String(DEFAULT_PRINT_FRACTIONS.heightOfH),
    printTopOfH: String(DEFAULT_PRINT_FRACTIONS.topOfH),
    printRotationDeg: String(DEFAULT_PRINT_FRACTIONS.rotationDeg),
    isDefault: makeDefault,
    uploadedBy: args.uploadedBy,
  });
  if (makeDefault) {
    await db
      .update(mockupPanels)
      .set({ isDefault: true })
      .where(and(eq(mockupPanels.productTypeId, args.productTypeId), eq(mockupPanels.view, VIEW), eq(mockupPanels.panelId, args.panelId)));
  }
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
  printRectForMask(segment.mask, decoded.width, decoded.height);
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
  });
  const outline = await garmentOutlineJpeg(decoded.rgba, decoded.width, decoded.height, segment.mask);
  return {
    stored: true,
    panelId,
    areaFraction: segment.areaFraction,
    touchesEdge: segment.touchesEdge,
    disconnected: segment.disconnected,
    outlineJpegBase64: outline.toString("base64"),
  };
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
    if (check.agree) {
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

export async function renderCandidateOnPanel(args: {
  productTypeId: number;
  typeName: string;
  panelId: string;
  colorName: string;
  colorHex: string;
  artworkPath: string | null;
}): Promise<{ png: Buffer; source: "produced" | "recolour" }> {
  const rows = await sceneRows(args.productTypeId, args.panelId);
  if (!rows.length) {
    resolvePanelColour([], { name: args.colorName, hex: args.colorHex }, args.typeName, args.productTypeId, args.panelId);
  }
  const colours: PanelColour[] = rows.map((row) => ({
    name: row.garmentColor,
    hex: row.garmentHex,
    kind: row.kind === "white-master" ? "white-master" : "produced",
  }));
  const label = rows[0].label;
  const resolved = resolvePanelColour(colours, { name: args.colorName, hex: args.colorHex }, args.typeName, args.productTypeId, label);
  const sourceRow = rows.find((row) => row.garmentColor.trim().toLowerCase() === (resolved.kind === "produced" ? args.colorName : resolved.sourceName).trim().toLowerCase());
  if (!sourceRow) throw new Error(`${args.colorName} on ${args.typeName} (${args.productTypeId}), panel ${label}, has no produced colourway and no white master`);
  if (!args.artworkPath) throw new Error("Candidate artwork is not stored. Upload it once on this page.");
  const [photo, maskPng, artwork] = await Promise.all([
    getObject(sourceRow.storagePath),
    getObject(sourceRow.maskPath),
    getObject(args.artworkPath),
  ]);
  const png = await renderArtworkOnPanel({
    photo,
    maskPng,
    artwork,
    mode: resolved.kind,
    hex: resolved.hex,
    fractions: {
      widthOfH: Number(sourceRow.printWidthOfH),
      heightOfH: Number(sourceRow.printHeightOfH),
      topOfH: Number(sourceRow.printTopOfH),
      rotationDeg: Number(sourceRow.printRotationDeg),
    },
  });
  return { png, source: resolved.kind };
}

export async function approveCandidateChoice(args: {
  candidateId: string;
  productTypeId: number;
  typeName: string;
  panelId: string;
  selectedColors: ChoiceColor[];
}): Promise<void> {
  if (!args.selectedColors.length) throw new Error("No colours selected");
  const rows = await sceneRows(args.productTypeId, args.panelId);
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
  await saveChoice(args.candidateId, args.panelId, args.selectedColors);
  await db
    .update(catalogueCandidateChoices)
    .set({ approvedAt: now, updatedAt: now })
    .where(eq(catalogueCandidateChoices.candidateId, args.candidateId));
}
