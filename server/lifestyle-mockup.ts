/**
 * "See it worn" AI lifestyle mockups (admin-only for now).
 *
 * One Replicate google/nano-banana call per (design + gender) renders the same
 * person front + back side by side, from the design's own front/back flat
 * renders plus a per-garment static pocket close-up.
 * The prompt is a fixed per-garment template (shared/lifestyleMockup.ts) whose
 * {SETTING} comes from a small Replicate-hosted text model on the design's own
 * description, and whose printed/plain panel lists are read from the job's
 * actual print files. Only REPLICATE_API_TOKEN is required.
 *
 * Rows in `lifestyle_mockups` are the cache (one per design + gender, plus up
 * to LIFESTYLE_MAX_REROLLS re-rolls), the daily cap, and the per-call cost log.
 */
import sharp from "sharp";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "./db";
import { storage } from "./storage";
import { generationJobs, lifestyleMockups, type LifestyleMockupRow } from "@shared/schema";
import {
  fillLifestyleTemplate,
  joinPanelList,
  lifestyleGarmentForBlueprint,
  lifestyleImageInput,
  lifestylePanelManifest,
  sanitiseLifestyleSetting,
  LIFESTYLE_PART_POSITIONS,
  lifestylePartStateFromCoverage,
  LIFESTYLE_DAILY_CAP,
  LIFESTYLE_MAX_PER_DESIGN_GENDER,
  LIFESTYLE_SETTING_FALLBACK,
  type LifestyleGarment,
  type LifestyleGender,
  type LifestylePanelFacts,
  type LifestylePanelState,
} from "@shared/lifestyleMockup";
import { publicHoodieTemplateUrl } from "./supabaseHoodieTemplates";
import { uploadDesignFileToSupabase } from "./supabaseDesigns";

const REPLICATE_API = "https://api.replicate.com/v1";
const NANO_BANANA_MODEL = "google/nano-banana";
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 4 * 60 * 1000;
/** Replicate's per-output-image price for google/nano-banana; override if it changes. */
const COST_USD_PER_IMAGE = Number(process.env.LIFESTYLE_COST_USD_PER_IMAGE ?? "0.039");
/** Small instruct model for the {SETTING} phrase (fractions of a cent per call). */
const SETTING_MODEL = process.env.LIFESTYLE_SETTING_MODEL || "meta/meta-llama-3-8b-instruct";
const SETTING_TIMEOUT_MS = 45_000;
/** Per-channel distance from the panel's background colour that counts as artwork. */
const ART_PIXEL_MIN_DISTANCE = 60;

export class LifestyleMockupError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
  }
}

/**
 * Per-garment static references, stored once in the hoodie-templates bucket.
 * Only the pocket close-up is sent (reference 3); the blank-hoodie photo is
 * kept in the bucket but no longer part of the prompt.
 */
export function lifestyleAssetPaths(garment: LifestyleGarment): { blank: string; pocket: string } {
  return {
    blank: `lifestyle/${garment}/blank.png`,
    pocket: `lifestyle/${garment}/pocket.png`,
  };
}

function lifestylePocketUrl(garment: LifestyleGarment): string {
  const pocket = publicHoodieTemplateUrl(lifestyleAssetPaths(garment).pocket);
  if (!pocket) throw new LifestyleMockupError("Supabase is not configured", 500, "STORAGE_UNCONFIGURED");
  return pocket;
}

function replicateToken(): string {
  const tok = process.env.REPLICATE_API_TOKEN || process.env.REPLICATE_API_KEY;
  if (!tok) {
    throw new LifestyleMockupError("REPLICATE_API_TOKEN is not set", 500, "REPLICATE_UNCONFIGURED");
  }
  return tok;
}

function parseDesignState(raw: unknown): Record<string, any> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, any>;
  if (typeof raw === "string") {
    try {
      const v = JSON.parse(raw);
      return v && typeof v === "object" ? v : {};
    } catch {
      return {};
    }
  }
  return {};
}

function panelStateFrom(ds: Record<string, any>): LifestylePanelState | null {
  if (ds.hoodieAopPlacerState && typeof ds.hoodieAopPlacerState === "object") {
    return ds.hoodieAopPlacerState;
  }
  const sig = ds.aopPanelCaptureSignature;
  if (typeof sig === "string" && sig.trim()) {
    try {
      return JSON.parse(sig);
    } catch {
      return null;
    }
  }
  return sig && typeof sig === "object" ? sig : null;
}

type ReplicatePrediction = {
  id: string;
  status: string;
  output?: unknown;
  error?: unknown;
  logs?: string;
  input?: Record<string, unknown>;
  metrics?: { predict_time?: number };
};

/** Create a prediction on an official Replicate model and wait for it to finish. */
async function runReplicateModel(
  model: string,
  input: Record<string, unknown>,
  timeoutMs: number,
): Promise<ReplicatePrediction> {
  const headers = { Authorization: `Bearer ${replicateToken()}`, "Content-Type": "application/json" };
  const create = await fetch(`${REPLICATE_API}/models/${model}/predictions`, {
    method: "POST",
    headers,
    body: JSON.stringify({ input }),
  });
  let pred = (await create.json().catch(() => ({}))) as ReplicatePrediction & { detail?: string };
  if (!create.ok) {
    throw new Error(`Replicate ${model} create failed (${create.status}): ${String(pred?.detail ?? pred?.error ?? "").slice(0, 300)}`);
  }
  const started = Date.now();
  while (pred.status !== "succeeded" && pred.status !== "failed" && pred.status !== "canceled") {
    if (Date.now() - started > timeoutMs) throw new Error(`Replicate prediction ${pred.id} timed out`);
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    pred = (await (await fetch(`${REPLICATE_API}/predictions/${pred.id}`, { headers })).json()) as ReplicatePrediction;
  }
  if (pred.status !== "succeeded") {
    throw new Error(`Replicate prediction ${pred.id} ${pred.status}: ${String(pred.error ?? "").slice(0, 300)}`);
  }
  return pred;
}

const SETTING_SYSTEM_PROMPT =
  "You pick the background location for a casual smartphone photo of someone wearing a hoodie printed with an artwork. " +
  "Given the artwork's description, reply with ONLY an ordinary, everyday real-world place (3-6 words, no final punctuation) " +
  "that suits the artwork's mood but is clearly NOT a literal depiction of the artwork's subject or scene. " +
  "Examples of the form: 'farmers market stall', 'quiet suburban bus stop', 'laundromat with folding tables'.";

/** Short everyday location that suits the artwork's vibe without depicting it. */
export async function deriveLifestyleSetting(description: string | null | undefined): Promise<string> {
  const text = (description ?? "").trim();
  if (!text) return LIFESTYLE_SETTING_FALLBACK;
  try {
    const pred = await runReplicateModel(
      SETTING_MODEL,
      {
        system_prompt: SETTING_SYSTEM_PROMPT,
        prompt: `Artwork description: ${text.slice(0, 1000)}`,
        max_tokens: 24,
        temperature: 0.7,
      },
      SETTING_TIMEOUT_MS,
    );
    const out = Array.isArray(pred.output) ? pred.output.join("") : String(pred.output ?? "");
    return sanitiseLifestyleSetting(out) ?? LIFESTYLE_SETTING_FALLBACK;
  } catch (error) {
    console.warn("[lifestyle] setting call failed:", (error as Error)?.message);
    return LIFESTYLE_SETTING_FALLBACK;
  }
}

/**
 * Fraction of a print panel covered by artwork: pixels far from the panel's
 * dominant (background) colour. Solid background panels read 0.
 */
async function printPanelArtCoverage(url: string): Promise<number> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`panel fetch ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const { data } = await sharp(buf).resize(128, 128, { fit: "fill" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const counts = new Map<number, number>();
  for (let i = 0; i < data.length; i += 3) {
    const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const bgKey = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const bg = [((bgKey >> 8) & 15) * 16 + 8, ((bgKey >> 4) & 15) * 16 + 8, (bgKey & 15) * 16 + 8];
  let art = 0;
  for (let i = 0; i < data.length; i += 3) {
    const d = Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2]);
    if (d > ART_PIXEL_MIN_DISTANCE) art++;
  }
  return art / (data.length / 3);
}

/**
 * Printed/plain per manifest part, read from the job's persisted print files.
 * A part is printed when any of its panels carries artwork; parts with no
 * persisted panel stay undefined and fall back to the toggle rules.
 */
async function measurePanelFacts(
  garment: LifestyleGarment,
  ds: Record<string, any>,
): Promise<LifestylePanelFacts> {
  const panels: Array<{ position?: string; url?: string }> = Array.isArray(ds.aopPrintPanelUrls) ? ds.aopPrintPanelUrls : [];
  const byPosition = new Map(panels.filter((p) => p?.position && p?.url).map((p) => [p.position!, p.url!]));
  const facts: LifestylePanelFacts = {};
  for (const [part, positions] of Object.entries(LIFESTYLE_PART_POSITIONS[garment]) as Array<[keyof LifestylePanelFacts, string[]]>) {
    const urls = positions.map((pos) => byPosition.get(pos)).filter((u): u is string => !!u);
    if (urls.length === 0) continue;
    try {
      const coverage = Math.max(...(await Promise.all(urls.map(printPanelArtCoverage))));
      facts[part] = lifestylePartStateFromCoverage(coverage);
    } catch (error) {
      console.warn(`[lifestyle] could not read ${part} panel:`, (error as Error)?.message);
    }
  }
  return facts;
}

type PreparedLifestyle = {
  garment: LifestyleGarment;
  prompt: string;
  setting: string;
  imageInput: string[];
};

async function prepareLifestyle(jobId: string, gender: LifestyleGender): Promise<PreparedLifestyle> {
  const [job] = await db.select().from(generationJobs).where(eq(generationJobs.id, jobId)).limit(1);
  if (!job) throw new LifestyleMockupError("Design not found", 404, "JOB_NOT_FOUND");
  const productType = job.productTypeId ? await storage.getProductType(parseInt(job.productTypeId, 10)) : undefined;
  const garment = lifestyleGarmentForBlueprint(productType?.printifyBlueprintId ?? null);
  if (!garment) {
    throw new LifestyleMockupError("Lifestyle mockups support zip and pullover hoodies only", 400, "UNSUPPORTED_PRODUCT");
  }
  const ds = parseDesignState(job.designState);
  const front = ds.hoodieAopMockups?.front;
  const back = ds.hoodieAopMockups?.back;
  if (typeof front !== "string" || typeof back !== "string" || !front || !back) {
    throw new LifestyleMockupError(
      "This design has no saved front/back renders yet — apply the placement first",
      409,
      "FLATS_MISSING",
    );
  }
  const panelState = panelStateFrom(ds);
  if (!panelState) {
    throw new LifestyleMockupError("This design has no saved panel state", 409, "PANEL_STATE_MISSING");
  }
  const manifest = lifestylePanelManifest(garment, panelState, await measurePanelFacts(garment, ds));
  const setting = await deriveLifestyleSetting(job.userPrompt || ds.prompt || job.prompt);
  const prompt = fillLifestyleTemplate(garment, {
    gender,
    setting,
    frontPrinted: joinPanelList(manifest.frontPrinted),
    frontPlain: joinPanelList(manifest.frontPlain),
    backPrinted: joinPanelList(manifest.backPrinted),
    backPlain: joinPanelList(manifest.backPlain),
  });
  const imageInput = lifestyleImageInput({ frontFlat: front, backFlat: back, pocket: lifestylePocketUrl(garment) });
  return { garment, prompt, setting, imageInput };
}

type NanoBananaResult = {
  outputUrl: string;
  predictionId: string;
  predictTimeSec: number | null;
  seed: string | null;
};

async function runNanoBanana(prompt: string, imageInput: string[]): Promise<NanoBananaResult> {
  const pred = await runReplicateModel(
    NANO_BANANA_MODEL,
    { prompt, image_input: imageInput, aspect_ratio: "16:9", output_format: "png" },
    POLL_TIMEOUT_MS,
  );
  const out = Array.isArray(pred.output) ? pred.output[0] : pred.output;
  if (typeof out !== "string" || !out) throw new Error(`Replicate prediction ${pred.id} returned no image`);
  const seedFromInput = pred.input?.seed;
  const seedFromLogs = typeof pred.logs === "string" ? pred.logs.match(/seed[^0-9-]*(-?\d+)/i)?.[1] : undefined;
  const seed = seedFromInput != null ? String(seedFromInput) : seedFromLogs ?? null;
  const predictTime = pred.metrics?.predict_time;
  return {
    outputUrl: out,
    predictionId: String(pred.id),
    predictTimeSec: typeof predictTime === "number" ? predictTime : null,
    seed,
  };
}

async function enforceCaps(jobId: string, gender: LifestyleGender): Promise<void> {
  const [{ perDesign }] = await db
    .select({ perDesign: sql<number>`count(*)::int` })
    .from(lifestyleMockups)
    .where(
      and(
        eq(lifestyleMockups.generationJobId, jobId),
        eq(lifestyleMockups.gender, gender),
        inArray(lifestyleMockups.status, ["pending", "succeeded"]),
      ),
    );
  if (perDesign >= LIFESTYLE_MAX_PER_DESIGN_GENDER) {
    throw new LifestyleMockupError(
      `Re-roll limit reached for this design (${LIFESTYLE_MAX_PER_DESIGN_GENDER} per gender)`,
      429,
      "REROLL_CAP",
    );
  }
  const [{ today }] = await db
    .select({ today: sql<number>`count(*)::int` })
    .from(lifestyleMockups)
    .where(
      and(
        gte(lifestyleMockups.createdAt, sql`date_trunc('day', now())`),
        inArray(lifestyleMockups.status, ["pending", "succeeded"]),
      ),
    );
  if (today >= LIFESTYLE_DAILY_CAP) {
    throw new LifestyleMockupError(`Daily lifestyle-mockup cap reached (${LIFESTYLE_DAILY_CAP})`, 429, "DAILY_CAP");
  }
}

async function runGeneration(rowId: number, jobId: string, gender: LifestyleGender): Promise<void> {
  try {
    const prepared = await prepareLifestyle(jobId, gender);
    await db
      .update(lifestyleMockups)
      .set({ garment: prepared.garment, prompt: prepared.prompt, setting: prepared.setting })
      .where(eq(lifestyleMockups.id, rowId));
    const result = await runNanoBanana(prepared.prompt, prepared.imageInput);
    const img = await fetch(result.outputUrl);
    if (!img.ok) throw new Error(`Downloading Replicate output failed (${img.status})`);
    const buffer = Buffer.from(await img.arrayBuffer());
    const imageUrl = await uploadDesignFileToSupabase({
      buffer,
      filename: `lifestyle/${jobId}/${gender}-${rowId}.png`,
      contentType: "image/png",
    });
    if (!imageUrl) throw new Error("Supabase designs bucket is not configured");
    await db
      .update(lifestyleMockups)
      .set({
        status: "succeeded",
        imageUrl,
        seed: result.seed,
        predictionId: result.predictionId,
        predictTimeSec: result.predictTimeSec != null ? String(result.predictTimeSec) : null,
        costUsd: String(COST_USD_PER_IMAGE),
        completedAt: new Date(),
      })
      .where(eq(lifestyleMockups.id, rowId));
    console.log(
      `[lifestyle] job ${jobId} ${gender}: prediction ${result.predictionId} ` +
        `${result.predictTimeSec ?? "?"}s cost $${COST_USD_PER_IMAGE.toFixed(4)} setting "${prepared.setting}"`,
    );
  } catch (error) {
    const message = (error as Error)?.message ?? String(error);
    console.error(`[lifestyle] job ${jobId} ${gender} failed:`, message);
    await db
      .update(lifestyleMockups)
      .set({ status: "failed", error: message.slice(0, 1000), completedAt: new Date() })
      .where(eq(lifestyleMockups.id, rowId));
  }
}

/**
 * Start (or return the cached) lifestyle mockup for a design + gender. Returns
 * immediately; the generation runs in the background and callers poll
 * `listLifestyleMockups`. `reroll` forces a new generation within the caps.
 */
export async function requestLifestyleMockup(
  jobId: string,
  gender: LifestyleGender,
  reroll: boolean,
): Promise<LifestyleMockupRow> {
  const [latest] = await db
    .select()
    .from(lifestyleMockups)
    .where(and(eq(lifestyleMockups.generationJobId, jobId), eq(lifestyleMockups.gender, gender)))
    .orderBy(desc(lifestyleMockups.createdAt))
    .limit(1);
  if (latest?.status === "pending") return latest;
  if (latest?.status === "succeeded" && !reroll) return latest;

  // Validate the design before spending a slot, so a bad request never counts.
  await prepareLifestyleChecksOnly(jobId);
  await enforceCaps(jobId, gender);
  const [row] = await db
    .insert(lifestyleMockups)
    .values({ generationJobId: jobId, gender, garment: "pending", status: "pending" })
    .returning();
  void runGeneration(row.id, jobId, gender);
  return row;
}

async function prepareLifestyleChecksOnly(jobId: string): Promise<void> {
  const [job] = await db.select().from(generationJobs).where(eq(generationJobs.id, jobId)).limit(1);
  if (!job) throw new LifestyleMockupError("Design not found", 404, "JOB_NOT_FOUND");
  const productType = job.productTypeId ? await storage.getProductType(parseInt(job.productTypeId, 10)) : undefined;
  if (!lifestyleGarmentForBlueprint(productType?.printifyBlueprintId ?? null)) {
    throw new LifestyleMockupError("Lifestyle mockups support zip and pullover hoodies only", 400, "UNSUPPORTED_PRODUCT");
  }
  const ds = parseDesignState(job.designState);
  if (!ds.hoodieAopMockups?.front || !ds.hoodieAopMockups?.back) {
    throw new LifestyleMockupError(
      "This design has no saved front/back renders yet — apply the placement first",
      409,
      "FLATS_MISSING",
    );
  }
}

/** Whether the design's front and back flats are saved (what "See it worn" needs). */
export async function lifestyleFlatsReady(jobId: string): Promise<boolean> {
  const [job] = await db
    .select({ designState: generationJobs.designState })
    .from(generationJobs)
    .where(eq(generationJobs.id, jobId))
    .limit(1);
  const ds = parseDesignState(job?.designState);
  return typeof ds.hoodieAopMockups?.front === "string" && typeof ds.hoodieAopMockups?.back === "string"
    && !!ds.hoodieAopMockups.front && !!ds.hoodieAopMockups.back;
}

export async function listLifestyleMockups(jobId: string): Promise<LifestyleMockupRow[]> {
  return db
    .select()
    .from(lifestyleMockups)
    .where(eq(lifestyleMockups.generationJobId, jobId))
    .orderBy(desc(lifestyleMockups.createdAt));
}

/** Product type id of a design, for the admin access check. */
export async function lifestyleJobProductTypeId(jobId: string): Promise<number | null> {
  const [job] = await db
    .select({ productTypeId: generationJobs.productTypeId })
    .from(generationJobs)
    .where(eq(generationJobs.id, jobId))
    .limit(1);
  const id = job?.productTypeId ? parseInt(job.productTypeId, 10) : NaN;
  return Number.isFinite(id) ? id : null;
}

/** Read-only: what a generation for this design would use (flats, measured facts, manifest). */
export async function describeLifestyleInputs(jobId: string) {
  const [job] = await db.select().from(generationJobs).where(eq(generationJobs.id, jobId)).limit(1);
  if (!job) throw new LifestyleMockupError("Design not found", 404, "JOB_NOT_FOUND");
  const productType = job.productTypeId ? await storage.getProductType(parseInt(job.productTypeId, 10)) : undefined;
  const garment = lifestyleGarmentForBlueprint(productType?.printifyBlueprintId ?? null);
  if (!garment) throw new LifestyleMockupError("Not a zip or pullover hoodie", 400, "UNSUPPORTED_PRODUCT");
  const ds = parseDesignState(job.designState);
  const state = panelStateFrom(ds) ?? {};
  const facts = await measurePanelFacts(garment, ds);
  return {
    garment,
    flats: ds.hoodieAopMockups ?? null,
    stateOnly: lifestylePanelManifest(garment, state),
    facts,
    manifest: lifestylePanelManifest(garment, state, facts),
    description: job.userPrompt || ds.prompt || job.prompt,
  };
}
