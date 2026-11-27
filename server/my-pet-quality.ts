/**
 * Cheap vision reads and the pet-mask paste for My Pet.
 * Haiku looks at the photo and the original design. Sunburst still does the
 * edit at the shop's saved quality (medium). The paste puts the edited pet
 * back onto the original artwork so lettering outside the mask is untouched.
 */
import sharp from "sharp";
import { eq } from "drizzle-orm";
import {
  clipMyPetNote,
  compositePetRegion,
  myPetPawCheckPass,
  parsePetMask,
  poseNotePawCounts,
  resolvedPetMask,
  type PetMask,
} from "@shared/myPetQuality";
import { designCandidates } from "@shared/schema";
import { db } from "./db";
import { anthropicApiKey, redactAnthropicSecrets, summarizeAnthropicError } from "./concept-engine";
import { readLibraryObject } from "./mockup-library-store";

export const MY_PET_VISION_MODEL = "claude-haiku-4-5";
/** Published Haiku rates, USD per million tokens. */
const HAIKU_INPUT_PER_M = 1;
const HAIKU_OUTPUT_PER_M = 5;
const VISION_URL = "https://api.anthropic.com/v1/messages";

export type MyPetVisionUsage = {
  input_tokens?: number;
  output_tokens?: number;
};

export function myPetVisionCostUsd(usage: MyPetVisionUsage | null | undefined): number {
  const input = Math.max(0, Number(usage?.input_tokens) || 0);
  const output = Math.max(0, Number(usage?.output_tokens) || 0);
  return (input * HAIKU_INPUT_PER_M + output * HAIKU_OUTPUT_PER_M) / 1_000_000;
}

type VisionJson = { json: Record<string, unknown> | null; durationMs: number; costUsd: number };

async function visionImage(buf: Buffer): Promise<Buffer> {
  return sharp(buf)
    .rotate()
    .resize(768, 768, { fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 70 })
    .toBuffer();
}

async function askVision(buf: Buffer, system: string, user: string): Promise<VisionJson> {
  const key = anthropicApiKey();
  if (!key) throw new Error("ANTHROPIC_API_KEY is not configured");
  const image = await visionImage(buf);
  const started = Date.now();
  const res = await fetch(VISION_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MY_PET_VISION_MODEL,
      max_tokens: 400,
      system,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: image.toString("base64") } },
          { type: "text", text: user },
        ],
      }],
    }),
  });
  const bodyText = await res.text();
  if (!res.ok) {
    const detail = summarizeAnthropicError(res.status, redactAnthropicSecrets(bodyText));
    throw new Error(detail.anthropicMessage || "The My Pet vision check failed.");
  }
  let payload: { content?: Array<{ type?: string; text?: string }>; usage?: MyPetVisionUsage } = {};
  try {
    payload = JSON.parse(bodyText);
  } catch {
    throw new Error("The My Pet vision check was not JSON.");
  }
  const text = (payload.content || []).filter((block) => block?.type === "text" && block.text).map((block) => block.text).join("\n");
  let json: Record<string, unknown> | null = null;
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    const fenced = text.match(/\{[\s\S]*\}/);
    if (fenced) {
      try { json = JSON.parse(fenced[0]) as Record<string, unknown>; } catch { json = null; }
    }
  }
  return { json, durationMs: Date.now() - started, costUsd: myPetVisionCostUsd(payload.usage) };
}

export type PetDescription = { description: string; durationMs: number; costUsd: number };

export async function describeShopperPet(photo: Buffer): Promise<PetDescription> {
  const result = await askVision(
    photo,
    "You describe one pet photo for an artist. Return only JSON. Do not invent body parts that are outside the frame.",
    'Return {"description": string}. Cover likely breed or mix, build, coat colours, pattern and markings, ear type, and tail type. Name which body parts are not visible. One or two sentences.',
  );
  return {
    description: clipMyPetNote(result.json?.description, 500),
    durationMs: result.durationMs,
    costUsd: result.costUsd,
  };
}

export type DesignPoseRead = {
  poseNote: string;
  mask: PetMask | null;
  letteringOverlapsPet: boolean;
  durationMs: number;
  costUsd: number;
};

export async function readDesignPose(artwork: Buffer): Promise<DesignPoseRead> {
  const result = await askVision(
    artwork,
    "You read one finished shirt design. Return only JSON. The box is the animal only, not the lettering.",
    'Return {"poseNote": string, "x": number, "y": number, "w": number, "h": number, "letteringOverlapsPet": boolean}. poseNote must start "Visible front paws: N. Visible hind paws: M." Then assign every limb as raised, planted, folded, or hidden, and say what each paw holds. Include a second animal or bird. Count flippers and wings as front paws and feet as hind paws. x, y, w, h are fractions from 0 to 1 of the image. letteringOverlapsPet is true only when lettering sits on the animal.',
  );
  const poseNote = clipMyPetNote(result.json?.poseNote, 500);
  const mask = parsePetMask({
    x: result.json?.x,
    y: result.json?.y,
    w: result.json?.w,
    h: result.json?.h,
    letteringOverlapsPet: result.json?.letteringOverlapsPet === true,
  });
  return {
    poseNote,
    mask,
    letteringOverlapsPet: mask?.letteringOverlapsPet === true,
    durationMs: result.durationMs,
    costUsd: result.costUsd,
  };
}

export type EditCheck = {
  pass: boolean;
  checked: boolean;
  reason: string;
  visibleFrontPaws: number | null;
  visibleHindPaws: number | null;
  noteFrontPaws: number | null;
  noteHindPaws: number | null;
  durationMs: number;
  costUsd: number;
};

const UNCHECKED: Pick<EditCheck, "visibleFrontPaws" | "visibleHindPaws" | "noteFrontPaws" | "noteHindPaws"> = {
  visibleFrontPaws: null,
  visibleHindPaws: null,
  noteFrontPaws: null,
  noteHindPaws: null,
};

function pawCount(value: unknown): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= 12 ? n : null;
}

export async function checkMyPetEdit(original: Buffer, edited: Buffer, poseNote: string): Promise<EditCheck> {
  const note = clipMyPetNote(poseNote, 500);
  const expected = poseNotePawCounts(note);
  const key = anthropicApiKey();
  if (!key) {
    return { pass: true, checked: false, reason: "Vision is not configured.", ...UNCHECKED, noteFrontPaws: expected.front, noteHindPaws: expected.hind, durationMs: 0, costUsd: 0 };
  }
  const [left, right] = await Promise.all([visionImage(original), visionImage(edited)]);
  const started = Date.now();
  const res = await fetch(VISION_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MY_PET_VISION_MODEL,
      max_tokens: 800,
      system: "You count paws on an edited shirt design. Return only JSON. Image 1 is the original design. Image 2 is the edit. The pose note is the required pose. Breed, coat, markings, and ear shape may change.",
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: left.toString("base64") } },
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: right.toString("base64") } },
          { type: "text", text: `Pose note: ${note || "None."}\nReturn {"visibleFrontPaws": number, "visibleHindPaws": number, "frontMatch": boolean, "hindMatch": boolean, "reason": string}. Count every visible front paw and every visible hind paw in Image 2, including a second animal or bird. A flipper or wing counts as a front paw. A foot counts as a hind paw. frontMatch is true only when Image 2 has the note's front-paw count and each front paw is raised, planted, folded, or hidden as the note says, holding what the note says. hindMatch is the same for hind paws. reason states the counts and any paw that does not match.` },
        ],
      }],
    }),
  });
  const bodyText = await res.text();
  const durationMs = Date.now() - started;
  if (!res.ok) {
    const detail = summarizeAnthropicError(res.status, redactAnthropicSecrets(bodyText));
    return { pass: true, checked: false, reason: detail.anthropicMessage || "The check did not run.", ...UNCHECKED, noteFrontPaws: expected.front, noteHindPaws: expected.hind, durationMs, costUsd: 0 };
  }
  let payload: { content?: Array<{ type?: string; text?: string }>; usage?: MyPetVisionUsage } = {};
  try { payload = JSON.parse(bodyText); } catch { payload = {}; }
  const text = (payload.content || []).filter((block) => block?.type === "text" && block.text).map((block) => block.text).join("\n");
  let json: Record<string, unknown> | null = null;
  try { json = JSON.parse(text) as Record<string, unknown>; } catch {
    const fenced = text.match(/\{[\s\S]*\}/);
    if (fenced) {
      try { json = JSON.parse(fenced[0]) as Record<string, unknown>; } catch { json = null; }
    }
  }
  const costUsd = myPetVisionCostUsd(payload.usage);
  if (!json) {
    return { pass: true, checked: false, reason: "The check could not be read.", ...UNCHECKED, noteFrontPaws: expected.front, noteHindPaws: expected.hind, durationMs, costUsd };
  }
  const verdict = myPetPawCheckPass({
    note,
    visibleFrontPaws: pawCount(json.visibleFrontPaws),
    visibleHindPaws: pawCount(json.visibleHindPaws),
    frontMatch: json.frontMatch === true,
    hindMatch: json.hindMatch === true,
  });
  const modelReason = String(json.reason || "").replace(/\s+/g, " ").trim();
  return {
    pass: verdict.pass,
    checked: true,
    reason: [verdict.reason, modelReason].filter(Boolean).join(" "),
    visibleFrontPaws: pawCount(json.visibleFrontPaws),
    visibleHindPaws: pawCount(json.visibleHindPaws),
    noteFrontPaws: expected.front,
    noteHindPaws: expected.hind,
    durationMs,
    costUsd,
  };
}

function contentBox(rgba: Uint8Array, width: number, height: number): { left: number; top: number; width: number; height: number } {
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (rgba[(y * width + x) * 4 + 3] < 16) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < minX || maxY < minY) return { left: 0, top: 0, width, height };
  return { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/**
 * Line the edit up with the original artwork, then keep every original pixel
 * outside the pet box. The model often returns the whole design at a
 * different size, so a straight stretch leaves a second animal beside the box.
 */
export async function pasteEditedPet(originalPng: Buffer, editedPng: Buffer, mask: PetMask | null): Promise<Buffer> {
  if (!mask) return editedPng;
  const base = await sharp(originalPng).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const width = base.info.width || 1;
  const height = base.info.height || 1;
  const editedRaw = await sharp(editedPng).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const ew = editedRaw.info.width || 1;
  const eh = editedRaw.info.height || 1;
  const originalBox = contentBox(new Uint8Array(base.data), width, height);
  const editedBox = contentBox(new Uint8Array(editedRaw.data), ew, eh);
  const aligned = await sharp(editedPng)
    .extract({ left: editedBox.left, top: editedBox.top, width: editedBox.width, height: editedBox.height })
    .resize(originalBox.width, originalBox.height, { fit: "fill", kernel: "lanczos3" })
    .png()
    .toBuffer();
  const placed = await sharp({
    create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).composite([{ input: aligned, left: originalBox.left, top: originalBox.top }]).ensureAlpha().raw().toBuffer();
  const merged = compositePetRegion(new Uint8Array(base.data), new Uint8Array(placed), width, height, resolvedPetMask(mask));
  return sharp(Buffer.from(merged), { raw: { width, height, channels: 4 } }).png().toBuffer();
}

export type StoredPose = {
  candidateId: string;
  title: string;
  poseNote: string;
  mask: PetMask | null;
  letteringOverlapsPet: boolean;
  wrote: boolean;
  durationMs: number;
  costUsd: number;
  skipped: boolean;
};

export async function ensureMyPetPose(candidateId: string, opts?: { write?: boolean }): Promise<StoredPose> {
  const write = opts?.write !== false;
  const [row] = await db.select().from(designCandidates).where(eq(designCandidates.id, candidateId)).limit(1);
  if (!row) throw new Error("That design is not stored.");
  const existing = parsePetMask(row.petMask);
  const title = String(row.title || row.punchline || row.id).slice(0, 80);
  if (String(row.poseNote || "").trim() && existing) {
    return {
      candidateId,
      title,
      poseNote: row.poseNote,
      mask: existing,
      letteringOverlapsPet: existing.letteringOverlapsPet,
      wrote: false,
      durationMs: 0,
      costUsd: 0,
      skipped: true,
    };
  }
  if (!row.artworkPath) throw new Error("This design has no stored artwork.");
  const artwork = await readLibraryObject(row.artworkPath);
  const read = await readDesignPose(artwork);
  if (!read.poseNote || !read.mask) throw new Error("The pose note could not be read.");
  const mask = { ...read.mask, nudgeX: existing?.nudgeX || 0, nudgeY: existing?.nudgeY || 0, nudgeW: existing?.nudgeW || 0, nudgeH: existing?.nudgeH || 0 };
  if (write) {
    await db.update(designCandidates).set({
      poseNote: read.poseNote,
      petMask: mask,
      updatedAt: new Date(),
    }).where(eq(designCandidates.id, candidateId));
  }
  return {
    candidateId,
    title,
    poseNote: read.poseNote,
    mask,
    letteringOverlapsPet: mask.letteringOverlapsPet,
    wrote: write,
    durationMs: read.durationMs,
    costUsd: read.costUsd,
    skipped: false,
  };
}
