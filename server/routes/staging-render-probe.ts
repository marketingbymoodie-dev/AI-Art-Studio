/**
 * Staging-only render probe (QA tooling).
 *
 * POST /api/staging/render-probe sends a prompt VERBATIM to a configured direct
 * renderer (Google Nano Banana family or OpenAI GPT Image) on the Petposterous
 * dedicated credentials — no prompt layers, decor rules or customer storage — so
 * a model/API path can be isolated from our prompt stack.
 *
 * POST /api/staging/render-probe/style-batch/prepare plus
 * POST /api/staging/render-probe/style-example run the storefront compose
 * (look + pinned concept framework) for the six Petposterous LOOKs. Those rows
 * store the composed prompt. Verbatim rows still store only a prompt id + length.
 *
 * Results (metadata + image in a PRIVATE bucket) are shown on
 * GET /staging/render-probe.
 *
 * Every route is 404 unless the Railway environment is staging AND the
 * x-appai-probe-token header matches STAGING_PROBE_TOKEN. Never in production.
 * The browser never receives provider keys or bucket URLs. Verbatim prompts
 * stay server-side; style-example rows return the composed prompt behind the
 * same token so a set can be regenerated.
 */
import type { Express, Request, Response } from "express";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import sharp from "sharp";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { desc, eq } from "drizzle-orm";
import { renderProbeResults } from "@shared/schema";
import { PETPOSTEROUS_CONCEPT_FRAMEWORKS, PETPOSTEROUS_VISUAL_SYSTEMS } from "@shared/petposterousCreative";
import { PETPOSTEROUS_STYLES } from "@shared/packs/petposterous";
import { generateImageBase64 } from "../replit_integrations/image/client";
import {
  STYLE_EXAMPLE_DEFAULT_VARIANTS,
  STYLE_EXAMPLE_MAX_VARIANTS,
  StyleExampleInputError,
  composeStyleExample,
  generatePinnedStyleConcept,
  parseStyleExampleConcept,
  styleExampleFamilyError,
  styleExampleRecipe,
  type StyleExampleFamily,
} from "../style-example-batch";
import {
  CREDENTIALS,
  GOOGLE_RENDERERS,
  RENDERERS,
  readCredential,
  type GoogleImageSize,
} from "../generation-providers";
import { estimateGoogleImageCostUsd, renderGoogleImage } from "../google-image-client";
import { estimateOpenAIImageCostUsd, renderOpenAIImage, type OpenAIImageUsage } from "../openai-image-client";
import { recordGenerationEvent } from "../generation-events";
import { measureSoftAlpha } from "../native-transparency";
import { PETPOSTEROUS_ART_STYLES, PETPOSTEROUS_ART_STYLE_BATCH, artStyleConceptHeading, artStyleConceptShotFlags, artStyleDeviceLine, artStyleSurfaceForProduct, petposterousArtStyle } from "@shared/petposterousArtStyles";
import { composeArtStyleProbe } from "../art-style-probe";
import { behaviourObject, generateArtStyleDevices, generateArtStyleTruths } from "../art-style-writers";
import { ART_STYLE_DEVICE_STRUCTURES, adminCandidateDraft, flywheelShopDomain, flywheelSpecies } from "@shared/flywheelRecipe";
import { getDesignCandidate, insertAdminDesignCandidate, listDesignCandidates } from "../design-candidates";
import { buildFlywheelPrintFile, printCanvasFromStoredPlaceholders } from "../flywheel-print-file";
import { petSwapRenderInput } from "../flywheel-pet-swap";

export function stagingProbeAllowed(req: Pick<Request, "get">, env: Record<string, string | undefined> = process.env): boolean {
  const envName = String(env.RAILWAY_ENVIRONMENT_NAME ?? "").toLowerCase();
  const expected = env.STAGING_PROBE_TOKEN ?? "";
  const got = req.get("x-appai-probe-token") ?? "";
  if (envName !== "staging" || expected.length < 24 || got.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}

function stagingOnly(env: Record<string, string | undefined> = process.env): boolean {
  return String(env.RAILWAY_ENVIRONMENT_NAME ?? "").toLowerCase() === "staging" && (env.STAGING_PROBE_TOKEN ?? "").length >= 24;
}

export type EdgeSide = { palePct: number; uniformPct: number };
export type EdgeReport = { bandPx: number; top: EdgeSide; bottom: EdgeSide; left: EdgeSide; right: EdgeSide };

/**
 * Outer-1% band per side: share of near-white "bare paper" pixels, and share of
 * pixels within a small distance of the band's median colour (a solid margin of
 * any colour — cream, mustard — reads high; painted content reads low).
 */
export async function measureEdges(buf: Buffer): Promise<EdgeReport> {
  const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width;
  const H = info.height;
  const c = info.channels;
  const band = Math.max(1, Math.round(Math.min(W, H) * 0.01));
  const sides = ["top", "bottom", "left", "right"] as const;
  const px: Record<(typeof sides)[number], number[]> = { top: [], bottom: [], left: [], right: [] };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const k = y < band ? "top" : y >= H - band ? "bottom" : x < band ? "left" : x >= W - band ? "right" : null;
      if (k) px[k].push((y * W + x) * c);
    }
  }
  const median = (arr: number[]) => arr.sort((a, b) => a - b)[arr.length >> 1] ?? 0;
  const out = { bandPx: band } as EdgeReport;
  for (const s of sides) {
    const idx = px[s];
    const r = median(idx.map((i) => data[i]));
    const g = median(idx.map((i) => data[i + 1]));
    const b = median(idx.map((i) => data[i + 2]));
    let pale = 0;
    let uniform = 0;
    for (const i of idx) {
      const R = data[i], G = data[i + 1], B = data[i + 2];
      if (R > 225 && G > 220 && B > 205 && Math.max(R, G, B) - Math.min(R, G, B) < 40) pale++;
      if (Math.abs(R - r) + Math.abs(G - g) + Math.abs(B - b) < 36) uniform++;
    }
    out[s] = { palePct: Math.round((pale / idx.length) * 100), uniformPct: Math.round((uniform / idx.length) * 100) };
  }
  return out;
}

// ---- private storage for probe images -------------------------------------
const BUCKET = "staging-render-probes";
let _sb: SupabaseClient | null | undefined;
function sb(): SupabaseClient | null {
  if (_sb !== undefined) return _sb;
  const url = process.env.SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  _sb = url && key ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
  return _sb;
}
let bucketReady: Promise<void> | null = null;
function ensureBucket(c: SupabaseClient): Promise<void> {
  bucketReady ??= (async () => {
    const { data } = await c.storage.getBucket(BUCKET);
    if (data) {
      if (data.public) throw new Error(`${BUCKET} bucket is public — refusing`);
      return;
    }
    const { error } = await c.storage.createBucket(BUCKET, { public: false, fileSizeLimit: "40MB" });
    if (error && !/already exists/i.test(error.message)) throw new Error(`createBucket failed: ${error.message}`);
  })().catch((e) => {
    bucketReady = null;
    throw e;
  });
  return bucketReady;
}

async function db() {
  return (await import("../db")).db;
}

type ProbeBody = {
  prompt?: unknown;
  promptId?: unknown;
  experiment?: unknown;
  run?: unknown;
  renderer?: unknown;
  aspectRatio?: unknown;
  imageSize?: unknown;
};

const str = (v: unknown, max: number, fallback = "") => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : fallback);

export function registerStagingRenderProbeRoutes(app: Express): void {
  app.post("/api/staging/flywheel-print-file", async (req: Request, res: Response) => {
    if (!stagingProbeAllowed(req)) return res.status(404).json({ error: "Not found" });
    try {
      const { runBedEtiquettePrint } = await import("../flywheel-staging-run");
      return res.json(await runBedEtiquettePrint());
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return res.status(502).json({ error: message });
    }
  });

  app.post("/api/staging/flywheel-promote", async (req: Request, res: Response) => {
    if (!stagingProbeAllowed(req)) return res.status(404).json({ error: "Not found" });
    try {
      const { runBedEtiquettePromote } = await import("../flywheel-staging-run");
      return res.json(await runBedEtiquettePromote());
    } catch (err) {
      const status = (err as { status?: number })?.status === 409 ? 409 : 400;
      return res.status(status).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post("/api/staging/render-probe", async (req: Request, res: Response) => {
    if (!stagingProbeAllowed(req)) return res.status(404).json({ error: "Not found" });
    const body = (req.body ?? {}) as ProbeBody;
    const prompt = typeof body.prompt === "string" ? body.prompt : "";
    if (!prompt) return res.status(400).json({ error: "prompt required" });
    const promptHash = createHash("sha256").update(prompt).digest("hex").slice(0, 12);
    const promptId = str(body.promptId, 60, `prompt-${promptHash}`);
    const experiment = str(body.experiment, 80, "ad-hoc");
    const run = Number.isInteger(body.run) ? (body.run as number) : null;
    const aspectRatio = str(body.aspectRatio, 8, "4:3");
    const imageSize = (["1K", "2K", "4K"].includes(String(body.imageSize)) ? body.imageSize : "2K") as GoogleImageSize;
    const rendererId = str(body.renderer, 40, "google-nb2");
    const google = GOOGLE_RENDERERS[rendererId];
    const openai = RENDERERS[rendererId];
    if (!google && !openai) return res.status(400).json({ error: "unknown renderer" });
    const credential = google ? CREDENTIALS["google:petposterous"] : CREDENTIALS["openai:petposterous"];

    const started = Date.now();
    let mimeType = "";
    let data = "";
    let usage: OpenAIImageUsage | null = null;
    let requestId: string | null = null;
    let providerMs = 0;
    let estimatedCostUsd: number | null = null;
    let thoughtsTokens = 0;
    try {
      const apiKey = await readCredential(credential);
      if (google) {
        const r = await renderGoogleImage({ apiKey, credential, renderer: google, prompt, aspectRatio, imageSize });
        ({ mimeType, data, usage, requestId, thoughtsTokens } = r);
        providerMs = r.durationMs;
        estimatedCostUsd = estimateGoogleImageCostUsd(usage, google);
      } else {
        const r = await renderOpenAIImage({ apiKey, credential, renderer: openai, prompt, aspectRatio, background: "opaque" });
        ({ mimeType, data, usage, requestId } = r);
        providerMs = r.durationMs;
        estimatedCostUsd = estimateOpenAIImageCostUsd(usage, openai);
      }
    } catch (err) {
      const message = String((err as Error)?.message ?? err).slice(0, 300);
      void recordGenerationEvent(
        { kind: "image", route: "staging-render-probe", experienceProfile: "petposterous", legacyModel: (google ?? openai).model },
        { success: false, durationMs: Date.now() - started, error: err },
      );
      try {
        await (await db()).insert(renderProbeResults).values({
          experiment, promptId, promptChars: prompt.length, run, provider: credential.provider, model: (google ?? openai).model,
          rendererId, aspectRatio, imageSize: google ? imageSize : null, success: false, error: message,
        });
      } catch { /* best effort */ }
      return res.status(502).json({ error: message });
    }

    const buf = Buffer.from(data, "base64");
    const meta = await sharp(buf).metadata();
    const edges = await measureEdges(buf);
    const model = (google ?? openai).model;
    const sizeLabel = `${meta.width}x${meta.height}`;
    void recordGenerationEvent(
      { kind: "image", route: "staging-render-probe", experienceProfile: "petposterous" },
      {
        success: true,
        durationMs: Date.now() - started,
        meta: {
          provider: credential.provider as "google" | "openai",
          credentialRefId: credential.id,
          credentialScope: credential.scope,
          model,
          quality: google ? (google.supportsImageSize === false ? "native" : imageSize) : openai.quality,
          size: sizeLabel,
          attempts: 1,
          durationMs: providerMs,
          transparent: null,
          transparentFraction: null,
          usage,
          estimatedCostUsd,
          providerRequestId: requestId,
          providerMime: mimeType,
        },
      },
    );

    let storagePath: string | null = null;
    let storageError: string | null = null;
    const c = sb();
    if (c) {
      try {
        await ensureBucket(c);
        const ext = mimeType.includes("png") ? "png" : mimeType.includes("webp") ? "webp" : "jpg";
        const path = `${experiment.replace(/[^A-Za-z0-9_-]/g, "-")}/${Date.now()}-${rendererId}-${run ?? "x"}.${ext}`;
        const { error } = await c.storage.from(BUCKET).upload(path, buf, { contentType: mimeType, upsert: false });
        if (error) throw new Error(error.message);
        storagePath = path;
      } catch (e) {
        storageError = String((e as Error)?.message ?? e).slice(0, 200);
      }
    }
    const [row] = await (await db())
      .insert(renderProbeResults)
      .values({
        experiment, promptId, promptChars: prompt.length, run, provider: credential.provider, model, rendererId,
        aspectRatio, imageSize: google ? (google.supportsImageSize === false ? "native" : imageSize) : openai.quality,
        width: meta.width ?? null, height: meta.height ?? null, mimeType, providerMs, totalMs: Date.now() - started,
        usage, thoughtsTokens, estimatedCostUsd: estimatedCostUsd != null ? estimatedCostUsd.toFixed(6) : null,
        edges, providerRequestId: requestId, storagePath, success: true, error: storageError,
      })
      .returning({ id: renderProbeResults.id });

    return res.json({
      id: row?.id, experiment, promptId, run, provider: credential.provider, model, credentialRef: credential.id,
      mimeType, width: meta.width, height: meta.height, durationMs: providerMs, usage, thoughtsTokens,
      estimatedCostUsd, requestId, edges, stored: !!storagePath, storageError,
    });
  });

  app.get("/api/staging/render-probe/results", async (req: Request, res: Response) => {
    if (!stagingProbeAllowed(req)) return res.status(404).json({ error: "Not found" });
    const rows = await (await db()).select().from(renderProbeResults).orderBy(desc(renderProbeResults.id)).limit(500);
    // storagePath stays server-side; the page asks for images by id.
    return res.json({
      results: rows.map(({ storagePath, ...r }) => ({ ...r, hasImage: !!storagePath })),
    });
  });

  app.get("/api/staging/render-probe/image/:id", async (req: Request, res: Response) => {
    if (!stagingProbeAllowed(req)) return res.status(404).json({ error: "Not found" });
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "bad id" });
    const [row] = await (await db()).select().from(renderProbeResults).where(eq(renderProbeResults.id, id)).limit(1);
    const c = sb();
    if (!row?.storagePath || !c) return res.status(404).json({ error: "Not found" });
    const { data, error } = await c.storage.from(BUCKET).download(row.storagePath);
    if (error || !data) return res.status(404).json({ error: "Not found" });
    let buf = Buffer.from(await data.arrayBuffer());
    let type = row.mimeType || "application/octet-stream";
    if (req.query.thumb === "1") {
      const bg = req.query.bg === "dark" ? "#141210" : req.query.bg === "light" ? "#f4f1ea" : "";
      const resized = sharp(buf).resize(640, 640, { fit: "inside" });
      if (bg) {
        buf = await resized.flatten({ background: bg }).png().toBuffer();
        type = "image/png";
      } else if (type.includes("png")) {
        buf = await resized.png().toBuffer();
      } else {
        buf = await resized.jpeg({ quality: 82 }).toBuffer();
        type = "image/jpeg";
      }
    }
    res.setHeader("Content-Type", type);
    res.setHeader("Cache-Control", "private, no-store");
    return res.send(buf);
  });

  app.post("/api/staging/render-probe/style-batch/prepare", async (req: Request, res: Response) => {
    if (!stagingProbeAllowed(req)) return res.status(404).json({ error: "Not found" });
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const behavior = str(body.behavior, 600);
      const conceptFramework = str(body.conceptFramework, 80);
      const productFamily = str(body.productFamily, 20, "apparel");
      const variantsRaw = body.variants == null ? STYLE_EXAMPLE_DEFAULT_VARIANTS : Number(body.variants);
      if (!Number.isInteger(variantsRaw) || variantsRaw < 1 || variantsRaw > STYLE_EXAMPLE_MAX_VARIANTS) {
        return res.status(400).json({ error: `variants must be 1–${STYLE_EXAMPLE_MAX_VARIANTS}` });
      }
      const familyError = styleExampleFamilyError(productFamily);
      if (familyError) return res.status(400).json({ error: familyError });
      if (!behavior) return res.status(400).json({ error: "Describe what they do." });
      if (!Object.prototype.hasOwnProperty.call(PETPOSTEROUS_CONCEPT_FRAMEWORKS, conceptFramework)) {
        return res.status(400).json({ error: "Choose a concept framework." });
      }

      let photoId = str(body.referencePhotoId, 16);
      if (typeof body.photoDataUrl === "string" && body.photoDataUrl) {
        const parsed = parseImageDataUrl(body.photoDataUrl);
        if (!parsed) return res.status(400).json({ error: "Photo must be a JPEG, PNG, or WebP under 8MB." });
        const meta = await sharp(parsed.buf).metadata();
        if (!meta.width || !meta.height) return res.status(400).json({ error: "Photo could not be read." });
        photoId = await storeProbePhoto(parsed.buf, parsed.mime);
      } else if (!photoId || !(await loadProbePhoto(photoId))) {
        return res.status(400).json({ error: "A reference pet photo is required." });
      }

      const supplied = body.concept != null ? parseStyleExampleConcept(body.concept) : null;
      if (body.concept != null && !supplied) return res.status(400).json({ error: "Concept snapshot is incomplete." });
      const concept = supplied ?? (await generatePinnedStyleConcept(behavior, conceptFramework));
      const recipe = styleExampleRecipe(productFamily as StyleExampleFamily);
      const batchId = `b${Date.now().toString(36)}${randomBytes(2).toString("hex")}`;
      return res.json({
        batchId,
        referencePhotoId: photoId,
        behavior,
        conceptFramework,
        concept,
        variants: variantsRaw,
        productFamily: recipe.productFamily,
        aspectRatio: recipe.aspectRatio,
        route: recipe.route,
        model: recipe.model,
        rendererId: recipe.rendererId,
        credentialRef: recipe.credentialRef,
        imageSize: recipe.imageSize,
        provider: recipe.provider,
        looks: PETPOSTEROUS_VISUAL_SYSTEMS.map((look) => ({ id: look.id, label: look.label })),
      });
    } catch (err) {
      if (err instanceof StyleExampleInputError) return res.status(400).json({ error: err.message });
      const status = Number((err as { status?: number }).status) || 502;
      return res.status(status >= 400 && status < 600 ? status : 502).json({
        error: String((err as Error)?.message ?? err).slice(0, 300),
      });
    }
  });

  app.post("/api/staging/render-probe/style-example", async (req: Request, res: Response) => {
    if (!stagingProbeAllowed(req)) return res.status(404).json({ error: "Not found" });
    const body = (req.body ?? {}) as Record<string, unknown>;
    const batchId = str(body.batchId, 40);
    if (!/^b[a-z0-9]{6,32}$/.test(batchId)) return res.status(400).json({ error: "batchId required" });
    const variant = Number(body.variant);
    if (!Number.isInteger(variant) || variant < 1 || variant > STYLE_EXAMPLE_MAX_VARIANTS) {
      return res.status(400).json({ error: "variant out of range" });
    }
    const behavior = str(body.behavior, 600);
    const conceptFramework = str(body.conceptFramework, 80);
    const productFamily = str(body.productFamily, 20, "apparel");
    const visualSystem = str(body.visualSystem, 80);
    const photoId = str(body.referencePhotoId, 16);
    const concept = parseStyleExampleConcept(body.concept);
    if (!concept) return res.status(400).json({ error: "Concept snapshot is incomplete." });
    const familyError = styleExampleFamilyError(productFamily);
    if (familyError) return res.status(400).json({ error: familyError });
    const dataUrl = await loadProbePhoto(photoId);
    if (!dataUrl) return res.status(400).json({ error: "Reference photo was not found. Upload it again." });

    let composed: ReturnType<typeof composeStyleExample>;
    try {
      composed = composeStyleExample({
        behavior,
        conceptFramework,
        productFamily: productFamily as StyleExampleFamily,
        visualSystem,
        concept,
        referenceDataUrl: dataUrl,
      });
    } catch (err) {
      const message = err instanceof StyleExampleInputError ? err.message : "Could not compose the prompt.";
      return res.status(400).json({ error: message });
    }

    const recipe = composed.recipe;
    const experiment = `style-batch:${batchId}`;
    const rowBase = {
      experiment,
      promptId: visualSystem,
      promptChars: composed.sentPrompt.length,
      run: variant,
      provider: recipe.provider,
      model: recipe.model,
      rendererId: recipe.rendererId,
      aspectRatio: recipe.aspectRatio,
      imageSize: recipe.imageSize,
      batchId,
      visualSystem,
      conceptFramework,
      composedPrompt: composed.sentPrompt,
      credentialRef: recipe.credentialRef,
      route: recipe.route,
      referencePhotoId: photoId,
      behavior,
      productFamily,
      conceptSnapshot: concept,
    };
    const started = Date.now();
    try {
      const result = await generateImageBase64(composed.params);
      if (!result.data) throw new Error("AI model returned no image data");
      const buf = Buffer.from(result.data, "base64");
      const meta = await sharp(buf).metadata();
      const edges = await measureEdges(buf);
      const mimeType = result.mimeType || "image/png";
      let storagePath: string | null = null;
      let storageError: string | null = null;
      const c = sb();
      if (c) {
        try {
          await ensureBucket(c);
          const ext = mimeType.includes("png") ? "png" : mimeType.includes("webp") ? "webp" : "jpg";
          const path = `${experiment.replace(/[^A-Za-z0-9_-]/g, "-")}/${Date.now()}-${recipe.rendererId}-${visualSystem}-${variant}.${ext}`;
          const { error } = await c.storage.from(BUCKET).upload(path, buf, { contentType: mimeType, upsert: false });
          if (error) throw new Error(error.message);
          storagePath = path;
        } catch (e) {
          storageError = String((e as Error)?.message ?? e).slice(0, 200);
        }
      }
      void recordGenerationEvent(
        {
          kind: "image",
          route: "staging-style-example",
          experienceProfile: "petposterous",
          visualSystem,
          conceptFramework,
          productFamily,
          legacyModel: recipe.model,
        },
        { success: true, durationMs: Date.now() - started, meta: result.meta },
      );
      const [row] = await (await db())
        .insert(renderProbeResults)
        .values({
          ...rowBase,
          width: meta.width ?? null,
          height: meta.height ?? null,
          mimeType,
          providerMs: result.meta?.durationMs ?? null,
          totalMs: Date.now() - started,
          usage: result.meta?.usage ?? null,
          estimatedCostUsd: result.meta?.estimatedCostUsd != null ? result.meta.estimatedCostUsd.toFixed(6) : null,
          edges,
          providerRequestId: result.meta?.providerRequestId ?? null,
          storagePath,
          success: true,
          error: storageError,
        })
        .returning({ id: renderProbeResults.id });
      return res.json({
        id: row?.id,
        batchId,
        visualSystem,
        variant,
        route: recipe.route,
        model: recipe.model,
        credentialRef: recipe.credentialRef,
        width: meta.width,
        height: meta.height,
        stored: !!storagePath,
        storageError,
      });
    } catch (err) {
      const message = String((err as Error)?.message ?? err).slice(0, 300);
      void recordGenerationEvent(
        {
          kind: "image",
          route: "staging-style-example",
          experienceProfile: "petposterous",
          visualSystem,
          conceptFramework,
          productFamily,
          legacyModel: recipe.model,
        },
        { success: false, durationMs: Date.now() - started, error: err },
      );
      try {
        await (await db()).insert(renderProbeResults).values({ ...rowBase, success: false, error: message });
      } catch { /* best effort */ }
      return res.status(502).json({ error: message, batchId, visualSystem, variant });
    }
  });

  app.post("/api/staging/render-probe/art-style/prepare", async (req: Request, res: Response) => {
    if (!stagingProbeAllowed(req)) return res.status(404).json({ error: "Not found" });
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      let photoId = str(body.referencePhotoId, 16);
      if (typeof body.photoDataUrl === "string" && body.photoDataUrl) {
        const parsed = parseImageDataUrl(body.photoDataUrl);
        if (!parsed) return res.status(400).json({ error: "Photo must be a JPEG, PNG, or WebP under 8MB." });
        photoId = await storeProbePhoto(parsed.buf, parsed.mime);
      } else if (!photoId || !(await loadProbePhoto(photoId))) {
        return res.status(400).json({ error: "A reference pet photo is required." });
      }
      const batchId = `a${Date.now().toString(36)}${randomBytes(2).toString("hex")}`;
      return res.json({
        batchId,
        referencePhotoId: photoId,
        variants: 2,
        behaviour: PETPOSTEROUS_ART_STYLE_BATCH.behaviour,
        concept: PETPOSTEROUS_ART_STYLE_BATCH.concept,
        words: PETPOSTEROUS_ART_STYLE_BATCH.words,
        composedHeading: artStyleConceptHeading(PETPOSTEROUS_ART_STYLE_BATCH.concept, PETPOSTEROUS_ART_STYLE_BATCH.words),
        shotFlags: artStyleConceptShotFlags(PETPOSTEROUS_ART_STYLE_BATCH.concept),
        conceptFramework: PETPOSTEROUS_ART_STYLE_BATCH.frameworkId,
        styles: PETPOSTEROUS_ART_STYLES.map((style) => ({ id: style.id, label: style.label })),
      });
    } catch (err) {
      const status = Number((err as { status?: number }).status) || 502;
      return res.status(status >= 400 && status < 600 ? status : 502).json({
        error: String((err as Error)?.message ?? err).slice(0, 300),
      });
    }
  });

  app.post("/api/staging/render-probe/art-style/concepts", async (req: Request, res: Response) => {
    if (!stagingProbeAllowed(req)) return res.status(404).json({ error: "Not found" });
    const body = (req.body ?? {}) as Record<string, unknown>;
    const behaviour = str(body.behaviour, 400);
    const productFamily = str(body.productFamily, 20, "apparel");
    const artStyle = str(body.artStyle, 40);
    const exactWording = str(body.exactWording, 120);
    if (!behaviour) return res.status(400).json({ error: "Describe what they do." });
    const familyError = styleExampleFamilyError(productFamily);
    if (familyError) return res.status(400).json({ error: familyError });
    if (artStyle && !petposterousArtStyle(artStyle)) return res.status(400).json({ error: "Choose an art style." });
    const started = Date.now();
    try {
      const options = await generateArtStyleTruths(behaviour, productFamily, artStyle, exactWording);
      return res.json({
        mode: "full",
        behaviour,
        productFamily,
        artStyle,
        truthMs: Date.now() - started,
        options: options.map((option) => ({
          ...option,
          composedHeading: artStyleConceptHeading(option.funnyTruth, option.punchline),
        })),
      });
    } catch (err) {
      const status = Number((err as { status?: number }).status) || 502;
      return res.status(status >= 400 && status < 600 ? status : 502).json({
        error: String((err as Error)?.message ?? err).slice(0, 300),
      });
    }
  });

  app.post("/api/staging/render-probe/art-style/device", async (req: Request, res: Response) => {
    if (!stagingProbeAllowed(req)) return res.status(404).json({ error: "Not found" });
    const body = (req.body ?? {}) as Record<string, unknown>;
    const funnyTruth = str(body.funnyTruth, 400);
    const punchline = str(body.punchline, 120);
    const requested = Array.isArray(body.artStyles) ? body.artStyles : [];
    const styleIds = requested.map((id) => str(id, 40)).filter(Boolean);
    if (!funnyTruth) return res.status(400).json({ error: "A truth is required." });
    if (!styleIds.length || styleIds.some((id) => !petposterousArtStyle(id))) {
      return res.status(400).json({ error: "Choose an art style." });
    }
    const productFamily = str(body.productFamily, 20, "apparel");
    const surface = artStyleSurfaceForProduct(productFamily);
    const behaviour = str(body.behaviour, 400);
    const species = flywheelSpecies(body.species) ?? "";
    const object = behaviourObject(body.object);
    if (!behaviour) return res.status(400).json({ error: "The behaviour is required." });
    if (!species) return res.status(400).json({ error: "Species is required." });
    if (object === undefined) return res.status(400).json({ error: "Object must be a short noun phrase or null." });
    try {
      const result = await generateArtStyleDevices({ styleIds, funnyTruth, punchline, surface, behaviour, species, object });
      return res.json({
        behaviour,
        species,
        object,
        ...result,
        devices: result.devices.map((row) => ({
          ...row,
          label: petposterousArtStyle(row.styleId)?.label || row.styleId,
          deviceLine: artStyleDeviceLine(row.device),
        })),
      });
    } catch (err) {
      const status = Number((err as { status?: number }).status) || 502;
      return res.status(status >= 400 && status < 600 ? status : 502).json({
        error: String((err as Error)?.message ?? err).slice(0, 300),
      });
    }
  });

  async function executeArtStyleRender(body: Record<string, unknown>, res: Response) {
    const batchId = str(body.batchId, 40);
    if (!/^a[a-z0-9]{6,32}$/.test(batchId)) return res.status(400).json({ error: "batchId required" });
    const variant = Number(body.variant);
    if (!Number.isInteger(variant) || variant < 1 || variant > 2) return res.status(400).json({ error: "variant out of range" });
    const artStyle = str(body.artStyle, 40);
    const promptLength = "short" as const;
    const mode = body.mode === "pinned" ? "pinned" : "full";
    const renderAnyway = body.renderAnyway === true;
    const concept = str(body.funnyTruth, 400) || (mode === "pinned" ? PETPOSTEROUS_ART_STYLE_BATCH.concept : "");
    const words = str(body.punchline, 120) || (mode === "pinned" ? PETPOSTEROUS_ART_STYLE_BATCH.words : "");
    const device = str(body.device, 400);
    if (!concept) return res.status(400).json({ error: "Full flow needs the selected truth" });
    if (!device) return res.status(400).json({ error: "A device is required before rendering." });
    const photoId = str(body.referencePhotoId, 16);
    const dataUrl = await loadProbePhoto(photoId);
    if (!dataUrl) return res.status(400).json({ error: "Reference photo was not found. Upload it again." });
    let composed: ReturnType<typeof composeArtStyleProbe>;
    try {
      composed = composeArtStyleProbe({
        styleId: artStyle,
        length: promptLength,
        referenceDataUrl: dataUrl,
        mode,
        concept,
        words,
        device,
        renderAnyway,
        productFamily: str(body.productFamily, 20, "apparel"),
        behaviour: str(body.behaviour, 400),
      });
    } catch (err) {
      return res.status(400).json({ error: String((err as Error)?.message ?? err).slice(0, 200) });
    }
    const recipe = composed.recipe;
    const visualSystem = composed.composed.style.id;
    const experiment = `art-styles:${batchId}`;
    const rowBase = {
      experiment,
      promptId: `style:${visualSystem}`,
      promptChars: composed.sentPrompt.length,
      run: variant,
      provider: recipe.provider,
      model: recipe.model,
      rendererId: recipe.rendererId,
      aspectRatio: composed.params.aspectRatio ?? "1:1",
      imageSize: recipe.imageSize,
      batchId,
      visualSystem,
      conceptFramework: composed.batch.frameworkId,
      composedPrompt: composed.sentPrompt,
      credentialRef: recipe.credentialRef,
      route: recipe.route,
      referencePhotoId: photoId,
      behavior: composed.behaviour,
      productFamily: str(body.productFamily, 20, "apparel"),
      conceptSnapshot: {
        mode: composed.mode,
        behaviour: composed.behaviour,
        funnyTruth: composed.concept,
        punchline: composed.words,
        device: composed.device,
        surface: composed.surface,
        shotFlags: composed.shotFlags,
        renderAnyway: composed.renderAnyway,
        deviceMs: Number(body.deviceMs) || 0,
        speculativeHit: body.speculativeHit === true,
        discardedDeviceMs: Number(body.discardedDeviceMs) || 0,
        discardedDeviceReason: str(body.discardedDeviceReason, 80),
        pickedIndex: Number(body.pickedIndex) || 0,
        truths: Array.isArray(body.truths) ? body.truths.slice(0, 3) : [],
        petSwap: body.petSwap === true,
        conceptSource: body.suppliedTruth === true || body.suppliedDevice === true ? "manual" : "generated",
        promptLength,
      },
    };
    const started = Date.now();
    try {
      const result = await generateImageBase64(composed.params);
      if (!result.data) throw new Error("AI model returned no image data");
      const buf = Buffer.from(result.data, "base64");
      const meta = await sharp(buf).metadata();
      const measured = await measureEdges(buf);
      const alpha = await measureSoftAlpha(buf);
      const edges = {
        ...measured,
        alpha: {
          transparentPct: Math.round(alpha.transparentFraction * 1000) / 10,
          featherPct: Math.round(alpha.featherFractionOfInk * 1000) / 10,
          haloPct: Math.round(alpha.haloFractionOfInk * 1000) / 10,
        },
      };
      const mimeType = result.mimeType || "image/png";
      let storagePath: string | null = null;
      let storageError: string | null = null;
      const c = sb();
      if (c) {
        try {
          await ensureBucket(c);
          const ext = mimeType.includes("png") ? "png" : "png";
          const path = `${experiment.replace(/[^A-Za-z0-9_-]/g, "-")}/${Date.now()}-${recipe.rendererId}-${visualSystem}-${variant}.${ext}`;
          const { error } = await c.storage.from(BUCKET).upload(path, buf, { contentType: "image/png", upsert: false });
          if (error) throw new Error(error.message);
          storagePath = path;
        } catch (e) {
          storageError = String((e as Error)?.message ?? e).slice(0, 200);
        }
      }
      const [row] = await (await db())
        .insert(renderProbeResults)
        .values({
          ...rowBase,
          width: meta.width ?? null,
          height: meta.height ?? null,
          mimeType,
          providerMs: result.meta?.durationMs ?? null,
          totalMs: Date.now() - started,
          usage: result.meta?.usage ?? null,
          estimatedCostUsd: result.meta?.estimatedCostUsd != null ? result.meta.estimatedCostUsd.toFixed(6) : null,
          edges,
          providerRequestId: result.meta?.providerRequestId ?? null,
          storagePath,
          success: true,
          error: storageError,
        })
        .returning({ id: renderProbeResults.id });
      let candidateId: string | null = null;
      let candidateSkipped: string | null = null;
      const decision = adminCandidateDraft({
        source: "admin-probe",
        petSwap: body.petSwap === true,
        shopDomain: body.shopDomain,
        humourOperator: body.humourOperator,
        darknessLevel: body.darknessLevel,
        species: body.species,
        deviceStructure: body.deviceStructure,
        deviceText: device,
        funnyTruth: concept,
        punchline: words,
        artStyle,
        behaviour: body.behaviour,
        productFamily: body.productFamily,
        credentialRef: recipe.credentialRef,
        renderProbeResultId: row?.id ?? null,
        imageVariant: variant,
        suppliedTruth: body.suppliedTruth === true,
        suppliedDevice: body.suppliedDevice === true,
        approveNow: body.approveNow === true,
      });
      if ("skip" in decision) {
        candidateSkipped = decision.skip;
      } else {
        try {
          if (decision.draft.status === "approved") {
            const { db } = await import("../db");
            const { productTypes } = await import("@shared/schema");
            const { eq } = await import("drizzle-orm");
            const { softstyleType } = await import("../mockup-library-store");
            const garment = await softstyleType();
            const [typeRow] = await db
              .select({ placeholderPositions: productTypes.placeholderPositions })
              .from(productTypes)
              .where(eq(productTypes.id, garment.id))
              .limit(1);
            const canvas = printCanvasFromStoredPlaceholders(typeRow?.placeholderPositions, garment.name);
            const print = await buildFlywheelPrintFile(artStyle, buf, canvas);
            const { writeLibraryObject } = await import("../mockup-library-store");
            const printPath = `print-files/${row?.id ?? Date.now()}-${artStyle}.png`;
            await writeLibraryObject(printPath, print.buffer, "image/png");
            decision.draft.printFilePath = printPath;
          }
          candidateId = await insertAdminDesignCandidate(decision.draft);
        } catch (insertErr) {
          candidateSkipped = String((insertErr as Error)?.message ?? insertErr).slice(0, 300);
          console.warn("[design-candidates] insert failed:", candidateSkipped);
        }
      }
      return res.json({
        id: row?.id,
        candidateId,
        candidateSkipped,
        batchId,
        visualSystem,
        variant,
        promptLength,
        route: recipe.route,
        model: recipe.model,
        credentialRef: recipe.credentialRef,
        width: meta.width,
        height: meta.height,
        durationMs: result.meta?.durationMs ?? null,
        estimatedCostUsd: result.meta?.estimatedCostUsd ?? null,
        edges,
        promptChars: composed.sentPrompt.length,
        composedPrompt: composed.sentPrompt,
        mode: composed.mode,
        idea: composed.idea,
        stored: !!storagePath,
        storageError,
      });
    } catch (err) {
      const message = String((err as Error)?.message ?? err).slice(0, 300);
      try {
        await (await db()).insert(renderProbeResults).values({ ...rowBase, success: false, error: message });
      } catch { /* best effort */ }
      return res.status(502).json({ error: message, batchId, visualSystem, variant });
    }
  }

  app.post("/api/staging/render-probe/art-style", async (req: Request, res: Response) => {
    if (!stagingProbeAllowed(req)) return res.status(404).json({ error: "Not found" });
    return executeArtStyleRender((req.body ?? {}) as Record<string, unknown>, res);
  });

  app.get("/api/staging/render-probe/candidates", async (req: Request, res: Response) => {
    if (!stagingProbeAllowed(req)) return res.status(404).json({ error: "Not found" });
    const shop = flywheelShopDomain(req.query.shop);
    if (!shop) return res.status(400).json({ error: "Shop must be a myshopify.com domain." });
    const rows = await listDesignCandidates(shop);
    return res.json({
      shop,
      candidates: rows.filter((row) => row.status !== "dropped").map((row) => ({
        ...row,
        createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
      })),
    });
  });

  app.post("/api/staging/render-probe/pet-swap", async (req: Request, res: Response) => {
    if (!stagingProbeAllowed(req)) return res.status(404).json({ error: "Not found" });
    const body = (req.body ?? {}) as Record<string, unknown>;
    const shop = flywheelShopDomain(body.shopDomain);
    const candidateId = str(body.candidateId, 40);
    if (!shop || !/^[0-9a-f-]{36}$/i.test(candidateId)) return res.status(400).json({ error: "Shop and candidate are required." });
    const row = await getDesignCandidate(shop, candidateId);
    if (!row || row.status === "dropped") return res.status(404).json({ error: "That design is not in the queue." });
    let photoId = str(body.referencePhotoId, 16);
    try {
      if (typeof body.photoDataUrl === "string" && body.photoDataUrl) {
        const parsed = parseImageDataUrl(body.photoDataUrl);
        if (!parsed) return res.status(400).json({ error: "Photo must be a JPEG, PNG, or WebP under 8MB." });
        photoId = await storeProbePhoto(parsed.buf, parsed.mime);
      }
    } catch (err) {
      const status = Number((err as { status?: number }).status) || 400;
      return res.status(status >= 400 && status < 600 ? status : 400).json({ error: String((err as Error)?.message ?? err).slice(0, 200) });
    }
    if (!photoId) return res.status(400).json({ error: "A pet photo is required." });
    const batchId = `a${Date.now().toString(36)}${randomBytes(2).toString("hex")}`;
    return executeArtStyleRender(petSwapRenderInput({
      artStyle: row.artStyle,
      funnyTruth: row.funnyTruth,
      punchline: row.punchline,
      deviceText: row.deviceText,
      deviceStructure: row.deviceStructure,
      humourOperator: row.humourOperator,
      darknessLevel: row.darknessLevel,
      species: row.species,
      behaviour: row.behaviour,
      productFamily: row.productFamily,
      shopDomain: row.shopDomain,
    }, photoId, batchId), res);
  });

  app.get("/staging/render-probe", (_req: Request, res: Response) => {
    if (!stagingOnly()) return res.status(404).send("Not found");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Robots-Tag", "noindex");
    const catalog = {
      looks: PETPOSTEROUS_VISUAL_SYSTEMS.map((look) => ({ id: look.id, label: look.label })),
      frameworks: PETPOSTEROUS_STYLES.filter((style) =>
        Object.prototype.hasOwnProperty.call(PETPOSTEROUS_CONCEPT_FRAMEWORKS, style.id),
      ).map((style) => ({ id: style.id, label: style.name })),
      families: [
        { id: "apparel", label: "Apparel (2:3 chest print)" },
        { id: "poster", label: "Poster (3:4 wall art)" },
        { id: "pillow", label: "Pillow (1:1)" },
      ],
      defaultVariants: STYLE_EXAMPLE_DEFAULT_VARIANTS,
      maxVariants: STYLE_EXAMPLE_MAX_VARIANTS,
      artStyles: PETPOSTEROUS_ART_STYLES.map((style) => ({ id: style.id, label: style.label, launch: style.launch })),
      deviceStructures: ART_STYLE_DEVICE_STRUCTURES.map((id) => ({ id, label: id.replace(/_/g, " ") })),
    };
    res.type("html").send(RESULTS_PAGE.replace("/*__CATALOG__*/null", JSON.stringify(catalog).replace(/</g, "\\u003c")));
  });
}

const PHOTO_MAX = 8 * 1024 * 1024;

function parseImageDataUrl(raw: string): { mime: string; buf: Buffer } | null {
  const m = /^data:(image\/(?:jpeg|jpg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/i.exec(raw.trim());
  if (!m) return null;
  const buf = Buffer.from(m[2].replace(/\s/g, ""), "base64");
  if (!buf.length || buf.length > PHOTO_MAX) return null;
  const mime = m[1].toLowerCase() === "image/jpg" ? "image/jpeg" : m[1].toLowerCase();
  return { mime, buf };
}

async function storeProbePhoto(buf: Buffer, mime: string): Promise<string> {
  const c = sb();
  if (!c) throw Object.assign(new Error("Probe storage is not configured."), { status: 503 });
  await ensureBucket(c);
  const id = createHash("sha256").update(buf).digest("hex").slice(0, 16);
  const ext = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : "jpg";
  const path = `refs/${id}.${ext}`;
  const { error } = await c.storage.from(BUCKET).upload(path, buf, { contentType: mime, upsert: true });
  if (error && !/already exists/i.test(error.message)) throw new Error(error.message);
  return id;
}

async function loadProbePhoto(id: string): Promise<string | null> {
  if (!/^[a-f0-9]{16}$/.test(id)) return null;
  const c = sb();
  if (!c) return null;
  for (const ext of ["jpg", "png", "webp"]) {
    const { data, error } = await c.storage.from(BUCKET).download(`refs/${id}.${ext}`);
    if (error || !data) continue;
    const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
    return `data:${mime};base64,${Buffer.from(await data.arrayBuffer()).toString("base64")}`;
  }
  return null;
}

const RESULTS_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Render Probe Results</title>
<style>
:root{--bg:#f6f5f2;--card:#fff;--ink:#1d1d1b;--muted:#6b6a66;--line:#e2e0da;--bad:#b3261e;--ok:#1b6b3a}
*{box-sizing:border-box}body{margin:0;font:14px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--ink)}
header{padding:16px;border-bottom:1px solid var(--line);background:var(--card);display:flex;gap:12px;align-items:center;flex-wrap:wrap}
h1{font-size:18px;margin:0 auto 0 0}main{padding:16px;max-width:none;margin:0 auto}
input,button,select{font:inherit;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:#fff}button{cursor:pointer}
h2{font-size:16px;margin:24px 0 8px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;overflow:hidden}
.card img{display:block;width:100%;aspect-ratio:4/3;object-fit:contain;background:repeating-conic-gradient(#eee 0 25%,#fff 0 50%) 0 0/16px 16px;cursor:zoom-in}
.meta{padding:10px 12px;display:grid;grid-template-columns:auto 1fr;gap:2px 10px;font-size:12.5px}.meta b{color:var(--muted);font-weight:500}
.tag{display:inline-block;padding:1px 6px;border-radius:6px;background:#eceae4;font-size:12px;margin-right:4px}
.bad{color:var(--bad)}.ok{color:var(--ok)}.err{padding:12px;color:var(--bad)}
.batch{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px;margin:0 0 8px;display:grid;gap:8px}
.batch[hidden]{display:none}.batch .row{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:8px}
.batch label{display:grid;gap:4px;font-size:12px;color:var(--muted)}
.batch textarea, .batch input[type=file]{font:inherit;padding:8px;border:1px solid var(--line);border-radius:8px;background:#fff;color:inherit}
.batch textarea{min-height:68px}.batch .hint,.batchnote{margin:0;color:var(--muted);font-size:12.5px}
.tool{border:1px solid var(--line);border-radius:10px;padding:12px;display:grid;gap:8px;background:var(--bg)}
.tool h3{margin:0;font-size:14px}
.ticks{display:flex;flex-wrap:wrap;gap:6px 14px}.ticks label,.screens{display:flex;gap:8px;align-items:center}
.screens button[aria-pressed="true"]{background:#1f6b4a;color:#fff;border-color:#1f6b4a}
.looks{display:grid;grid-template-columns:repeat(6,minmax(190px,1fr));gap:10px;overflow-x:auto;align-items:start}
.looks.artstyles{grid-template-columns:repeat(10,minmax(150px,1fr))}.looks.artstyles .card img{aspect-ratio:1024/1168}
.lookcol h3{margin:0 0 8px;font-size:14px}
#artIdeas{display:grid;gap:8px;margin-top:8px}#artIdeas[hidden]{display:none}
.idea{border:1px solid var(--line);border-radius:8px;padding:8px 10px;display:grid;gap:4px}
.idea .shot{color:var(--bad);font-weight:600}
.idea pre{white-space:pre-wrap;margin:0;font:12px/1.4 ui-monospace,SFMono-Regular,Consolas,monospace}
details.prompt summary{cursor:pointer;color:var(--muted);font-size:12px;padding:0 12px 10px}
details.prompt pre{white-space:pre-wrap;max-height:220px;overflow:auto;font:11px/1.35 ui-monospace,SFMono-Regular,Consolas,monospace;margin:0 12px 12px}
dialog{border:0;padding:0;max-width:96vw;max-height:96vh;background:#111}dialog img{display:block;max-width:96vw;max-height:92vh}
dialog::backdrop{background:rgba(0,0,0,.8)}dialog .bar{color:#ddd;padding:6px 10px;font-size:12px;display:flex;justify-content:space-between;gap:8px}
@media (prefers-color-scheme:dark){:root{--bg:#141413;--card:#1e1e1c;--ink:#ecebe7;--muted:#a3a19b;--line:#33322f}input,button,select,textarea{background:#262624;color:var(--ink)}.tag{background:#2c2b28}}
</style></head><body>
<header><h1>Render Probe Results</h1>
<form id="auth"><input id="token" type="password" placeholder="Probe token" autocomplete="off" aria-label="Probe token"> <button>Unlock</button></form>
<select id="exp" aria-label="Experiment"><option value="">All experiments</option></select>
</header>
<section id="batch" class="batch" hidden>
<p class="hint">Creation writes a candidate. Triage is the queue those rows land in. Customer simulation runs a stored recipe on a new pet photo.</p>
<div class="screens"><button type="button" id="showCreation" aria-pressed="true">Creation</button><button type="button" id="showTriage" aria-pressed="false">Triage</button><button type="button" id="showSimulate" aria-pressed="false">Customer simulation</button></div>
<div class="row">
<label>Pet photo<input id="photo" type="file" accept="image/jpeg,image/png,image/webp"></label>
<label>Product<select id="family"></select></label>
<label>Shop<input id="flywheelShop" placeholder="demo-store.myshopify.com" autocomplete="off" aria-label="Shop domain"></label>
</div>
<label>What they do<textarea id="behavior" placeholder="What happened. Shirt text goes in Exact wording, under Art style batch."></textarea></label>
<section class="tool" id="sixLook">
<h3>Generate batch</h3>
<p class="hint">Style example batch — six looks, one pet, one pinned joke. Uses the storefront prompt composition. Joke framework, variants per look, and Reuse this concept belong to this button only.</p>
<div class="row">
<label>Joke framework<select id="framework"></select></label>
<label>Variants per look<input id="variants" type="number" min="1" max="4" value="3"></label>
</div>
<label class="hint"><span><input id="reuse" type="checkbox" disabled> Reuse this concept on the next run</span></label>
<p id="conceptNote" class="hint">The first run writes one concept and pins that framework across all six looks.</p>
<div><button id="runBatch" type="button">Generate batch</button></div>
</section>
<section class="tool" id="artTool">
<h3>Art style batch</h3>
<p class="hint">Leave Truth and Device blank and the writers run. Fill either one and that writer is skipped. Fill both and nothing is written — the sentence goes straight to compose. Exact wording is the punchline. A filled truth or device is stored as manual, so it does not train the weights.</p>
<label>Art style scope<select id="artMode"><option value="one" selected>One style — truths, then a device</option><option value="bench">Several styles — one concept, one image each</option><option value="pinned">Pinned concept</option></select></label>
<label>Style<select id="artStyle"></select></label>
<label>Truth<textarea id="manualTruth" placeholder="Leave blank and the truth writer runs."></textarea></label>
<label>Exact wording<input id="exactWording" placeholder="Punchline. Leave blank and the writer may propose the line." autocomplete="off" aria-label="Exact wording"></label>
<label>Device<textarea id="manualDevice" placeholder="Leave blank and the device writer runs. Your sentence is the physics."></textarea></label>
<label>Object<input id="manualObject" placeholder="Noun the device writer must contain. Ignored when Device is filled." autocomplete="off" aria-label="Object"></label>
<div class="row">
<label>Operator<select id="manualOperator"></select></label>
<label>Darkness<select id="manualDarkness"><option>1</option><option selected>2</option><option>3</option><option>4</option><option>5</option></select></label>
<label>Species<select id="manualSpecies"><option>dog</option><option>cat</option><option>other</option></select></label>
<label>Device structure<select id="manualStructure"></select></label>
</div>
<label class="hint"><span><input id="approveNow" type="checkbox"> Already judged — store as approved</span></label>
<div id="styleTicks" class="ticks"></div>
<div><button id="runArt" type="button">Art style batch</button></div>
<div id="artIdeas" hidden>
<p id="artIdeasLead" class="hint"></p>
<div id="artIdeaList"></div>
<div id="artDevices"></div>
<p id="artDeviceNote" class="hint"></p>
<label>Pet swap photo<input id="swapPhoto" type="file" accept="image/jpeg,image/png,image/webp"></label>
<div><button id="artConfirm" type="button">Render</button> <button id="artOriginal" type="button" hidden>Render the rejected original anyway</button> <button id="artSwap" type="button">Render this device on the swap photo</button> <button id="artCancel" type="button">Cancel</button></div>
</div>
</section>
<section class="tool" id="triage" hidden>
<h3>Queue</h3>
<p class="hint">Manual and generated candidates both land here. Colour eligibility, the print file, and promotion are still ahead. An approved row skipped that wait because the person who wrote it had already judged it.</p>
<div><button id="loadTriage" type="button">Refresh queue</button></div>
<div id="triageList"></div>
</section>
<section class="tool" id="simulate" hidden>
<h3>Customer simulation</h3>
<p class="hint">Pick a stored design and a pet photo. This is the pet-swap render the storefront button will call, with that recipe. It does not add a candidate. Run it three times on three distinctive dogs of one breed for the individuation check.</p>
<div><button id="loadSimulate" type="button">Load designs</button></div>
<div id="simulateList"></div>
<label>Simulation photo<input id="simulatePhoto" type="file" accept="image/jpeg,image/png,image/webp"></label>
<div><button id="runSimulate" type="button">Run My Pet</button></div>
</section>
<div><span class="hint">Result view</span> <button id="blind" type="button">Blind</button> <button id="matte" type="button">Dark garment</button></div>
<p id="batchStatus" class="hint" role="status"></p>
</section>
<main id="main"><p>Enter the staging probe token to load results. The token stays in this tab only.</p></main>
<dialog id="full"><div class="bar"><span id="fulltitle"></span><button id="close">Close</button></div><img id="fullimg" alt=""></dialog>
<script>
const KEY="appai-probe-token";const CONCEPT_KEY="appai-style-batch-concept";
const CATALOG=/*__CATALOG__*/null;
let token=sessionStorage.getItem(KEY)||"";let rows=[];const blobs={};let running=false;let blind=false;let matte="";const blindNames={};
const h=(s)=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function fillSelect(id, items, selected){const sel=document.getElementById(id);sel.innerHTML=items.map(it=>'<option value="'+h(it.id)+'"'+(it.id===selected?" selected":"")+">"+h(it.label)+"</option>").join("")}
fillSelect("framework", CATALOG.frameworks, CATALOG.frameworks[0]&&CATALOG.frameworks[0].id);
fillSelect("family", CATALOG.families, "apparel");
fillSelect("artStyle", (CATALOG.artStyles||[]).map(function(it){return {id:it.id,label:it.launch===false?it.label+" (not in launch set)":it.label}}), "woodcut");
fillSelect("manualOperator", CATALOG.frameworks, CATALOG.frameworks[0]&&CATALOG.frameworks[0].id);
fillSelect("manualStructure", CATALOG.deviceStructures||[], "object_evidence");
function paintStyleTicks(force){const box=document.getElementById("styleTicks");if(!box)return;if(!force&&box.querySelector("input"))return;const styles=CATALOG.artStyles||[];const mode=document.getElementById("artMode").value;const selected=document.getElementById("artStyle").value;box.innerHTML=styles.map(function(s){const on=mode==="bench"||s.id===selected;return "<label><input type='checkbox' value='"+h(s.id)+"'"+(on?" checked":"")+"> "+h(s.label)+"</label>"}).join("")}
paintStyleTicks(true);
document.getElementById("artMode").addEventListener("change",function(){paintStyleTicks(true)});
document.getElementById("variants").max=String(CATALOG.maxVariants);
function savedConcept(){try{return JSON.parse(sessionStorage.getItem(CONCEPT_KEY)||"null")}catch(e){return null}}
function conceptMatches(saved){if(!saved||!saved.concept)return false;return saved.behavior===document.getElementById("behavior").value.trim()&&saved.conceptFramework===document.getElementById("framework").value&&saved.productFamily===document.getElementById("family").value}
function refreshReuse(){const saved=savedConcept();const box=document.getElementById("reuse");const ok=conceptMatches(saved);box.disabled=!ok;if(!ok)box.checked=false;const joke=ok?saved.concept.visualJoke:"";document.getElementById("conceptNote").textContent=joke?("Pinned concept: "+joke):"The first run writes one concept and pins that framework across all six looks. Leave reuse on to paint the same joke again."}
["behavior","framework","family"].forEach(id=>{document.getElementById(id).addEventListener("input",refreshReuse);document.getElementById(id).addEventListener("change",refreshReuse)});
refreshReuse();
function setStatus(t){document.getElementById("batchStatus").textContent=t}
async function api(path){const r=await fetch(path,{headers:{"x-appai-probe-token":token}});if(!r.ok)throw new Error(r.status);return r}
async function apiJson(path, body){const r=await fetch(path,{method:"POST",headers:{"x-appai-probe-token":token,"content-type":"application/json"},body:JSON.stringify(body)});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||r.status);return j}
function fileToDataUrl(file){return new Promise((resolve,reject)=>{const fr=new FileReader();fr.onload=()=>resolve(String(fr.result||""));fr.onerror=()=>reject(new Error("Could not read the photo"));fr.readAsDataURL(file)})}
async function img(id,thumb){const k=id+(thumb?"t":"")+(matte||"");if(blobs[k])return blobs[k];const q=thumb?("?thumb=1"+(matte?"&bg="+matte:"")):"";const r=await api("/api/staging/render-probe/image/"+id+q);blobs[k]=URL.createObjectURL(await r.blob());return blobs[k]}
function blindLabel(id){if(!blindNames[id]){const n=Object.keys(blindNames).length;blindNames[id]=String.fromCharCode(65+(n%26))+(n>=26?String(Math.floor(n/26)+1):"")}return blindNames[id]}
function edge(e){if(!e)return"–";const s=["top","bottom","left","right"];return s.map(k=>k[0].toUpperCase()+" "+e[k].palePct+"% / "+e[k].uniformPct+"%").join(" · ")}
function fwLabel(id){const f=CATALOG.frameworks.find(x=>x.id===id);return f?f.label:(id||"")}
function lookLabel(id){if(id==="woodcut-short")return "Woodcut · short";const f=(CATALOG.artStyles||[]).concat(CATALOG.looks).find(x=>x.id===id);return f?f.label:(id||"")}
function probeCard(r){const c=document.createElement("div");c.className="card";
c.innerHTML=(r.hasImage?'<img alt="'+h(r.model)+' run '+h(r.run)+'" data-id="'+r.id+'">':'<div class="err">'+h(r.error||"no image")+"</div>")+
'<div class="meta"><b>Model</b><span><span class="tag">'+h(r.provider)+"</span>"+h(r.model)+'</span><b>Run</b><span>'+h(r.run??"–")+" · "+h(r.promptId)+" ("+h(r.promptChars)+' chars)</span><b>Size</b><span>'+h(r.width)+"×"+h(r.height)+" · "+h(r.aspectRatio)+" · "+h(r.imageSize)+'</span><b>MIME</b><span>'+h(r.mimeType)+'</span><b>Latency</b><span>'+(r.providerMs!=null?(r.providerMs/1000).toFixed(1)+"s provider":"–")+'</span><b>Cost</b><span>'+(r.estimatedCostUsd!=null?"$"+Number(r.estimatedCostUsd).toFixed(4):"–")+(r.usage?" · "+h(r.usage.inputTokens)+" in / "+h(r.usage.outputTokens)+" out":"")+'</span><b>Edges</b><span title="outer 1% band: bare-paper % / single-colour %">'+edge(r.edges)+'</span><b>When</b><span>'+h(new Date(r.createdAt).toLocaleString())+"</span></div>";
return c}
function styleCard(r){const c=document.createElement("div");c.className="card";
const alpha=r.edges&&r.edges.alpha?'<b>Alpha</b><span>clear '+h(r.edges.alpha.transparentPct)+'% · feather '+h(r.edges.alpha.featherPct)+'% · halo '+h(r.edges.alpha.haloPct)+'%</span>':"";
const prompt=!blind&&r.composedPrompt?'<details class="prompt"><summary>Composed prompt ('+h(r.promptChars)+' chars)</summary><pre>'+h(r.composedPrompt)+"</pre></details>":"";
c.innerHTML=(r.hasImage?'<img alt="'+h(blind?blindLabel(r.id):lookLabel(r.visualSystem))+" variant "+h(r.run)+'" data-id="'+r.id+'">':'<div class="err">'+h(r.error||"no image")+"</div>")+
'<div class="meta"><b>Variant</b><span>'+h(r.run??"–")+'</span><b>Route</b><span>'+h(r.route)+" · "+h(r.model)+'</span><b>Credential</b><span>'+h(r.credentialRef)+'</span><b>Size</b><span>'+h(r.width)+"×"+h(r.height)+" · "+h(r.aspectRatio)+" · "+h(r.imageSize)+'</span><b>Photo</b><span>'+h(r.referencePhotoId)+'</span>'+alpha+'<b>Time</b><span>'+(r.providerMs!=null?(r.providerMs/1000).toFixed(1)+"s":"–")+'</span><b>Cost</b><span>'+(r.estimatedCostUsd!=null?"$"+Number(r.estimatedCostUsd).toFixed(4):"–")+'</span><b>When</b><span>'+h(r.createdAt?new Date(r.createdAt).toLocaleString():"")+"</span></div>"+prompt;
return c}
function render(){const exp=document.getElementById("exp").value;const main=document.getElementById("main");main.innerHTML="";
const groups={};for(const r of rows){if(exp&&r.experiment!==exp)continue;(groups[r.experiment]??=[]).push(r)}
for(const [name,list] of Object.entries(groups)){const sec=document.createElement("section");
if(!list.some(r=>r.visualSystem)){sec.innerHTML="<h2>"+h(name)+"</h2>";const g=document.createElement("div");g.className="grid";
list.sort((a,b)=>String(a.model+a.run).localeCompare(String(b.model+b.run)));
for(const r of list)g.appendChild(probeCard(r));sec.appendChild(g);main.appendChild(sec);continue}
const sample=list.find(r=>r.conceptSnapshot)||list[0];
const artBatch=String(name).indexOf("art-styles:")===0;
const snap=sample.conceptSnapshot||{};
const joke=artBatch?(snap.funnyTruth||snap.visualJoke||""):(snap.visualJoke||"");
const words=artBatch&&snap.punchline?snap.punchline:"";
const deviceNote=artBatch&&snap.device?snap.device:"";
const deviceTiming=artBatch&&snap.deviceMs?("device "+snap.deviceMs+"ms"+(snap.speculativeHit?" · speculative hit":"")+(snap.discardedDeviceMs?(" · discarded "+snap.discardedDeviceMs+"ms"+(snap.discardedDeviceReason?(" — "+snap.discardedDeviceReason):"")):"")) :"";
sec.innerHTML="<h2>"+h(fwLabel(sample.conceptFramework))+"</h2><p class='batchnote'>"+h(name)+" · "+h(sample.productFamily)+" · "+h(sample.route)+" · "+h(sample.model)+" · "+h(sample.aspectRatio)+(sample.imageSize?" · "+h(sample.imageSize):"")+" · photo "+h(sample.referencePhotoId)+(artBatch?" · "+h(snap.conceptSource==="manual"?"manual":"generated"):"")+"</p>"+(joke?"<p class='batchnote'>"+h(joke)+"</p>":"")+(words?"<p class='batchnote'>"+h(words)+"</p>":"")+(deviceNote?"<p class='batchnote'>"+h(deviceNote)+"</p>":"")+(deviceTiming?"<p class='batchnote'>"+h(deviceTiming)+"</p>":"")+(sample.behavior?"<p class='batchnote'>"+h(sample.behavior)+"</p>":"");
if(blind&&artBatch){const g=document.createElement("div");g.className="grid";list.slice().sort(()=>Math.random()-0.5).forEach(r=>g.appendChild(styleCard(r)));sec.appendChild(g);main.appendChild(sec);continue}
const board=document.createElement("div");board.className=artBatch?"looks artstyles":"looks";
const byLook={};for(const r of list){(byLook[r.visualSystem||"other"]??=[]).push(r)}
const order=artBatch&&CATALOG.artStyles?CATALOG.artStyles:CATALOG.looks;
const ids=order.map(l=>l.id).filter(id=>byLook[id]);
for(const extra of Object.keys(byLook))if(!ids.includes(extra))ids.push(extra);
for(const id of ids){const col=document.createElement("div");col.className="lookcol";col.innerHTML="<h3>"+h(blind&&artBatch?"":lookLabel(id))+"</h3>";
byLook[id].slice().sort((a,b)=>(a.run??0)-(b.run??0)).forEach(r=>col.appendChild(styleCard(r)));board.appendChild(col)}
sec.appendChild(board);main.appendChild(sec)}
if(!main.children.length)main.innerHTML="<p>No results yet.</p>";
for(const el of main.querySelectorAll("img[data-id]")){img(el.dataset.id,true).then(u=>el.src=u).catch(()=>{});el.onclick=async()=>{const r=rows.find(x=>String(x.id)===el.dataset.id);document.getElementById("fulltitle").textContent=(blind&&r.visualSystem?blindLabel(r.id):(r.visualSystem?lookLabel(r.visualSystem):r.model))+" · variant "+(r.run??"–")+" · "+r.width+"×"+r.height;document.getElementById("fullimg").src=await img(el.dataset.id,false);document.getElementById("full").showModal()}}}
async function load(prefer){try{const r=await api("/api/staging/render-probe/results");rows=(await r.json()).results;document.getElementById("batch").hidden=false;const sel=document.getElementById("exp");const cur=prefer||sel.value;sel.innerHTML='<option value="">All experiments</option>'+[...new Set(rows.map(r=>r.experiment))].map(e=>'<option value="'+h(e)+'"'+(e===cur?" selected":"")+">"+h(e)+"</option>").join("");render()}catch(e){if(String(e.message)==="404")document.getElementById("batch").hidden=true;document.getElementById("main").innerHTML='<p class="err">Not authorised or unavailable ('+h(e.message)+").</p>"}}
document.getElementById("runBatch").onclick=async()=>{if(running)return;const file=document.getElementById("photo").files[0];const behavior=document.getElementById("behavior").value.trim();if(!token){setStatus("Unlock with the probe token first.");return}if(!file){setStatus("Choose a pet photo.");return}if(!behavior){setStatus("Describe what they do.");return}
const variants=Math.max(1,Math.min(CATALOG.maxVariants,Number(document.getElementById("variants").value)||CATALOG.defaultVariants));
running=true;document.getElementById("runBatch").disabled=true;
try{setStatus("Storing the photo and pinning the concept…");const saved=savedConcept();const reuse=document.getElementById("reuse").checked&&conceptMatches(saved);const photoDataUrl=await fileToDataUrl(file);
const prep=await apiJson("/api/staging/render-probe/style-batch/prepare",{behavior,conceptFramework:document.getElementById("framework").value,productFamily:document.getElementById("family").value,variants,photoDataUrl,concept:reuse?saved.concept:undefined});
document.getElementById("behavior").value=prep.behavior;
sessionStorage.setItem(CONCEPT_KEY,JSON.stringify({behavior:prep.behavior,conceptFramework:prep.conceptFramework,productFamily:prep.productFamily,concept:prep.concept,referencePhotoId:prep.referencePhotoId}));
document.getElementById("reuse").checked=true;refreshReuse();
const jobs=[];for(const look of prep.looks)for(let v=1;v<=prep.variants;v++)jobs.push({look,v});
let done=0;const failures=[];let cursor=0;
async function one(job){try{await apiJson("/api/staging/render-probe/style-example",{batchId:prep.batchId,variant:job.v,behavior:prep.behavior,conceptFramework:prep.conceptFramework,productFamily:prep.productFamily,visualSystem:job.look.id,referencePhotoId:prep.referencePhotoId,concept:prep.concept})}catch(e){failures.push(job.look.label+" "+job.v+": "+e.message)}
done++;setStatus(prep.batchId+" · "+done+"/"+jobs.length+(failures.length?" · "+failures.length+" failed":""));if(done%3===0||done===jobs.length)load("style-batch:"+prep.batchId).catch(()=>{})}
async function worker(){while(cursor<jobs.length){const job=jobs[cursor++];await one(job)}}
await Promise.all([worker(),worker()]);
await load("style-batch:"+prep.batchId);
setStatus(failures.length?failures.join(" · "):("Batch "+prep.batchId+" finished. Reuse stays on, so the next run keeps this concept."))}
catch(e){setStatus(e.message||"Batch failed")}
finally{running=false;document.getElementById("runBatch").disabled=false}};
let artPending=null;
function artStyleIds(pending){const ticked=[...document.querySelectorAll("#styleTicks input:checked")].map(function(el){return el.value});if(ticked.length)return ticked;if(pending.mode==="one")return [document.getElementById("artStyle").value];return pending.prep.styles.map(function(s){return s.id})}
function artDeviceKey(index, useOriginal){return String(index)+(useOriginal?":orig":"")}
function selectedArtIndex(){const picked=document.querySelector('input[name="artIdea"]:checked');return picked?Number(picked.value):-1}
function hideArtIdeas(){artPending=null;const box=document.getElementById("artIdeas");if(box)box.hidden=true;const list=document.getElementById("artIdeaList");if(list)list.innerHTML="";const devices=document.getElementById("artDevices");if(devices)devices.innerHTML=""}
function paintArtDevices(pending){const box=document.getElementById("artDevices");const note=document.getElementById("artDeviceNote");const idea=pending.options[selectedArtIndex()];
if(pending.manualDevice){box.innerHTML="<p class='idea'><b>Manual device</b> <span class='hint'>"+h(document.getElementById("manualStructure").value)+"</span><pre>"+h(pending.manualDevice)+"</pre></p>";note.textContent="No device writer. Each ticked style gets one image of this sentence.";document.getElementById("artConfirm").disabled=false;document.getElementById("artConfirm").textContent=artStyleIds(pending).length>1?("Render "+artStyleIds(pending).length+" styles"):"Render this style";document.getElementById("artOriginal").hidden=true;return}
const cached=pending.deviceCache[pending.deviceKey];
if(!cached){box.innerHTML="<p class='hint'>Writing the device…</p>";note.textContent="";document.getElementById("artConfirm").disabled=true;return}
box.innerHTML=cached.devices.map(function(row){return "<p class='idea'><b>"+h(row.label)+"</b> <span class='hint'>"+h(row.deviceStructure||"")+" · "+h(row.deviceMs)+"ms</span><pre>"+h(row.deviceLine||row.device)+"</pre></p>"}).join("");
let latency=(cached.behaviour?("Behaviour sent: "+cached.behaviour+". "):"")+(cached.object?("Object sent: "+cached.object+". "):"")+(cached.species?("Species sent: "+cached.species+". "):"")+(cached.truth?("Truth: "+cached.truth+". "):"")+(cached.surface?("Surface "+cached.surface+". "):"")+"Device server "+cached.deviceMs+"ms, round trip "+cached.clientMs+"ms.";
if(pending.discardedDeviceMs)latency="Earlier device discarded ("+pending.discardedDeviceMs+"ms"+(pending.discardedDeviceReason?": "+pending.discardedDeviceReason:"")+"). "+latency;
else if(cached.speculative)latency="Idea 1's device was written after the truths, before confirm. "+latency;
note.textContent=latency;
const flagged=idea&&((pending.useOriginal&&idea.originalFlags&&idea.originalFlags.length)||(!pending.useOriginal&&idea.shotFlags&&idea.shotFlags.length));
document.getElementById("artConfirm").disabled=false;
document.getElementById("artConfirm").textContent=flagged?"This truth is a shot. Render anyway?":(artStyleIds(pending).length>1?("Render "+artStyleIds(pending).length+" styles"):"Render this style");
document.getElementById("artOriginal").hidden=!(idea&&idea.rewritten&&!pending.useOriginal)}
function showArtIdeas(pending){artPending=pending;pending.deviceGen=0;pending.deviceCache={};pending.deviceKey="";pending.useOriginal=false;pending.discardedDeviceMs=0;pending.discardedDeviceReason="";pending.deviceError="";const list=document.getElementById("artIdeaList");list.innerHTML="";
document.getElementById("artIdeasLead").textContent=pending.manualDevice&&pending.suppliedTruth?"Manual concept. No writer ran. Tick the styles, then render one image each.":(pending.mode==="pinned"?"Pinned concept. The validator flags a placed seat. Render anyway is the operator override. Read the device before any image.":("Written for "+pending.productLabel+(pending.manualDevice?". The device is yours.":(pending.mode==="one"?" in "+pending.styleLabel:" across the ticked styles")+". The first truth is selected. Its device is already being written.")));
pending.options.forEach(function(idea,i){const label=document.createElement("label");label.className="idea";const flags=(idea.shotFlags||[]).join(", ");const originalFlags=(idea.originalFlags||[]).join(", ");const words=idea.punchline?idea.punchline:"(no words)";
label.innerHTML='<span><input type="radio" name="artIdea" value="'+i+'"> <b>Idea '+(i+1)+"</b></span><span><b>Funny truth</b> "+h(idea.funnyTruth)+"</span><span><b>Exact wording</b> "+h(words)+"</span><span><b>Object</b> "+h(idea.object||"none")+"</span><span><b>Operator</b> "+h(idea.humourOperator||"—")+"</span><span><b>Darkness</b> "+h(idea.darknessLevel?String(idea.darknessLevel):"—")+"</span><span><b>Species</b> <select class='species' aria-label='Species'>"+["dog","cat","other"].map(function(s){return "<option value='"+s+"'"+(idea.species===s?" selected":"")+">"+s+"</option>"}).join("")+"</select></span>"+(idea.composedHeading?"<pre>"+h(idea.composedHeading)+"</pre>":"")+(idea.rewritten?"<span class='hint'>Rewritten. Rejected original: "+h(idea.originalTruth)+" ("+h(originalFlags)+")</span>":"")+(flags?"<span class='shot'>Shot warning: "+h(flags)+". Render anyway is the only way this reaches an image.</span>":"");
list.appendChild(label)});
const first=list.querySelector("input");if(first)first.checked=true;
document.getElementById("artIdeas").hidden=false;
if(pending.manualDevice){pending.deviceKey=artDeviceKey(0,false);pending.deviceCache[pending.deviceKey]={devices:[],deviceMs:0,clientMs:0,speculative:false,surface:"",truth:"",behaviour:pending.behaviour||"",species:"",object:""};paintArtDevices(pending);return}
requestArtDevices(pending, 0, false, "speculative")}
function noteDiscard(pending, ms, reason){if(!ms)return;pending.discardedDeviceMs=ms;pending.discardedDeviceReason=reason}
async function requestArtDevices(pending, index, useOriginal, reason){const idea=pending.options[index];if(!idea)return;const key=artDeviceKey(index, useOriginal);pending.deviceKey=key;pending.useOriginal=useOriginal;
if(reason!=="speculative"){const first=pending.deviceCache[artDeviceKey(0,false)];if(first&&first.speculative)noteDiscard(pending, first.deviceMs, reason)}
if(pending.deviceCache[key]){paintArtDevices(pending);return}
const gen=++pending.deviceGen;pending.deviceError="";paintArtDevices(pending);const started=performance.now();
try{const truth=useOriginal&&idea.originalTruth?idea.originalTruth:idea.funnyTruth;const speciesEl=document.querySelectorAll("#artIdeaList select.species")[index];const species=speciesEl?speciesEl.value:(idea.species||"");const typedObject=(document.getElementById("manualObject").value||"").trim();const res=await apiJson("/api/staging/render-probe/art-style/device",{funnyTruth:truth,punchline:idea.punchline||"",species:species,object:typedObject||idea.object||null,behaviour:pending.behaviour||"",artStyles:artStyleIds(pending),productFamily:pending.productFamily});
if(artPending!==pending)return;
if(pending.deviceGen!==gen){noteDiscard(pending, res.deviceMs||pending.discardedDeviceMs, "superseded by a newer request");if(pending.deviceCache[pending.deviceKey])paintArtDevices(pending);return}
pending.deviceCache[key]={devices:res.devices||[],deviceMs:res.deviceMs||0,clientMs:Math.round(performance.now()-started),speculative:reason==="speculative",surface:res.surface||"",truth:truth,behaviour:res.behaviour||"",species:res.species||"",object:res.object||""};
if(pending.deviceKey===key)paintArtDevices(pending)}
catch(e){if(artPending!==pending||pending.deviceGen!==gen)return;pending.deviceError=e.message||"Device failed";document.getElementById("artDevices").innerHTML="<p class='shot'>"+h(pending.deviceError)+"</p>";document.getElementById("artDeviceNote").textContent=pending.deviceError;document.getElementById("artConfirm").disabled=true;setStatus(pending.deviceError)}}
document.getElementById("artIdeaList").addEventListener("change",function(ev){if(!artPending)return;const index=selectedArtIndex();if(index<0)return;if(artPending.manualDevice){if(ev.target&&ev.target.classList&&ev.target.classList.contains("species")){const idea=artPending.options[index];if(idea)idea.species=ev.target.value}return}if(ev.target&&ev.target.classList&&ev.target.classList.contains("species")){const idea=artPending.options[index];if(idea)idea.species=ev.target.value;const key=artDeviceKey(index, artPending.useOriginal);const current=artPending.deviceCache[key];if(current)noteDiscard(artPending, current.deviceMs, "switched species");delete artPending.deviceCache[key];requestArtDevices(artPending, index, artPending.useOriginal, "switched species");return}requestArtDevices(artPending, index, false, index===0?"speculative":"switched idea")});
document.getElementById("artStyle").addEventListener("change",function(){if(!artPending||artPending.mode!=="one"||artPending.manualDevice)return;const current=artPending.deviceCache[artPending.deviceKey];if(current)noteDiscard(artPending, current.deviceMs, "switched style");artPending.deviceCache={};const index=selectedArtIndex();requestArtDevices(artPending, index<0?0:index, false, "switched style")});
document.getElementById("styleTicks").addEventListener("change",function(){if(!artPending)return;if(artPending.manualDevice){paintArtDevices(artPending);return}const index=selectedArtIndex();if(index<0)return;delete artPending.deviceCache[artDeviceKey(index, artPending.useOriginal)];requestArtDevices(artPending, index, artPending.useOriginal, "switched style")});
document.getElementById("family").addEventListener("change",function(){if(!artPending)return;artPending.productFamily=document.getElementById("family").value;if(artPending.manualDevice)return;const current=artPending.deviceCache[artPending.deviceKey];if(current)noteDiscard(artPending, current.deviceMs, "switched product");artPending.deviceCache={};const index=selectedArtIndex();requestArtDevices(artPending, index<0?0:index, artPending.useOriginal, "switched product")});
document.getElementById("artOriginal").onclick=function(){if(!artPending)return;const index=selectedArtIndex();if(index<0)return;const current=artPending.deviceCache[artPending.deviceKey];if(current)noteDiscard(artPending, current.deviceMs, "chose the rejected original");requestArtDevices(artPending, index, true, "chose the rejected original")};
async function renderArtJobs(pending, idea, petSwap){if(pending.deviceError){setStatus(pending.deviceError);return}const ids=artStyleIds(pending);if(!ids.length){setStatus("Tick at least one style.");return}
let deviceRows;const cached=pending.deviceCache[pending.deviceKey]||{speculative:false};
if(pending.manualDevice){const structure=document.getElementById("manualStructure").value;deviceRows=ids.map(function(id){return {styleId:id,label:lookLabel(id),device:pending.manualDevice,deviceStructure:structure,deviceMs:0}})}
else{if(!cached.devices||!cached.devices.length){setStatus("The device is still being written.");return}deviceRows=cached.devices.filter(function(row){return ids.indexOf(row.styleId)>=0})}
if(petSwap)deviceRows=deviceRows.slice(0,1);
if(!deviceRows.length){setStatus("Tick a style that has a device.");return}
if(pending.suppliedTruth){idea.humourOperator=document.getElementById("manualOperator").value;idea.darknessLevel=Number(document.getElementById("manualDarkness").value);idea.species=document.getElementById("manualSpecies").value}
if(running)return;running=true;document.getElementById("artConfirm").disabled=true;document.getElementById("runArt").disabled=true;document.getElementById("runBatch").disabled=true;
const prep=pending.prep;const index=selectedArtIndex();const truth=pending.useOriginal&&idea.originalTruth?idea.originalTruth:idea.funnyTruth;const flagged=pending.useOriginal?(idea.originalFlags||[]).length:(idea.shotFlags||[]).length;
try{let photoId=prep.referencePhotoId;if(petSwap){const swap=document.getElementById("swapPhoto").files[0];if(!swap)throw new Error("Choose a pet swap photo.");setStatus("Storing the swap photo…");const stored=await apiJson("/api/staging/render-probe/art-style/prepare",{photoDataUrl:await fileToDataUrl(swap)});photoId=stored.referencePhotoId}
const variants=petSwap||pending.manualDevice||pending.suppliedTruth||deviceRows.length>1?1:prep.variants;const jobs=[];
deviceRows.forEach(function(row){for(let v=1;v<=variants;v++)jobs.push({artStyle:row.styleId,label:row.label,variant:v,device:row.device,deviceStructure:row.deviceStructure||"",deviceMs:row.deviceMs})});
let done=0;const failures=[];const stored=[];let cursor=0;
const speciesEl=document.querySelectorAll("#artIdeaList select.species")[index];
const species=pending.suppliedTruth?document.getElementById("manualSpecies").value:(speciesEl?speciesEl.value:(idea.species||""));
const shopDomain=(document.getElementById("flywheelShop").value||"").trim();
async function one(job){try{const out=await apiJson("/api/staging/render-probe/art-style",{batchId:prep.batchId,variant:job.variant,artStyle:job.artStyle,referencePhotoId:photoId,mode:pending.mode==="pinned"?"pinned":"full",behaviour:pending.behaviour,productFamily:pending.productFamily,funnyTruth:truth,punchline:idea.punchline||"",device:job.device,deviceStructure:job.deviceStructure,humourOperator:idea.humourOperator||"",darknessLevel:idea.darknessLevel||0,species:species,shopDomain:shopDomain,renderAnyway:flagged>0,deviceMs:job.deviceMs,speculativeHit:!pending.discardedDeviceMs&&!!cached.speculative,discardedDeviceMs:pending.discardedDeviceMs||0,discardedDeviceReason:pending.discardedDeviceReason||"",pickedIndex:index,suppliedTruth:!!pending.suppliedTruth,suppliedDevice:!!pending.suppliedDevice,approveNow:!!pending.approveNow,truths:pending.options.map(function(o){return {funnyTruth:o.funnyTruth,punchline:o.punchline||"",shotFlags:o.shotFlags||[],originalTruth:o.originalTruth||"",rewritten:!!o.rewritten}}),petSwap:!!petSwap});if(out.candidateId)stored.push(out.candidateId);else if(out.candidateSkipped)stored.push(job.label+" "+job.variant+" not stored ("+out.candidateSkipped+")")}catch(e){failures.push(job.label+" "+job.variant+": "+e.message)}
done++;setStatus(prep.batchId+" · "+done+"/"+jobs.length+(failures.length?" · "+failures.length+" failed":""));if(done%2===0||done===jobs.length)load("art-styles:"+prep.batchId).catch(()=>{})}
async function worker(){while(cursor<jobs.length){const job=jobs[cursor++];await one(job)}}
await Promise.all([worker(),worker()]);
await load("art-styles:"+prep.batchId);
setStatus((failures.length?failures.join(" · "):("Art style batch "+prep.batchId+" finished. Blind hides the labels."))+(stored.length?" · "+stored.join(", "):""));
if(!petSwap)hideArtIdeas()}
catch(e){setStatus(e.message||"Art style batch failed")}
finally{running=false;document.getElementById("artConfirm").disabled=false;document.getElementById("runArt").disabled=false;document.getElementById("runBatch").disabled=false;if(artPending)paintArtDevices(artPending)}}
document.getElementById("artConfirm").onclick=function(){if(!artPending)return;const idea=artPending.options[selectedArtIndex()];if(!idea){setStatus("Pick an idea first.");return}renderArtJobs(artPending, idea, false)};
document.getElementById("artSwap").onclick=function(){if(!artPending)return;const idea=artPending.options[selectedArtIndex()];if(!idea){setStatus("Pick an idea first.");return}renderArtJobs(artPending, idea, true)};
document.getElementById("artCancel").onclick=function(){hideArtIdeas();setStatus("Cancelled. Nothing was rendered.")};
document.getElementById("runArt").onclick=async()=>{if(running)return;const file=document.getElementById("photo").files[0];if(!token){setStatus("Unlock with the probe token first.");return}if(!file){setStatus("Choose the spaniel photo.");return}
const mode=document.getElementById("artMode").value==="bench"?"bench":(document.getElementById("artMode").value==="pinned"?"pinned":"one");
const behaviour=(document.getElementById("behavior").value||"").trim();
const family=document.getElementById("family");
const styleSel=document.getElementById("artStyle");
const productFamily=family.value;
const productLabel=family.selectedOptions[0]?family.selectedOptions[0].textContent:productFamily;
const styleLabel=styleSel.selectedOptions[0]?styleSel.selectedOptions[0].textContent:styleSel.value;
const manualTruth=(document.getElementById("manualTruth").value||"").trim();
const manualDevice=(document.getElementById("manualDevice").value||"").trim();
const wording=(document.getElementById("exactWording").value||"").trim();
if(mode!=="pinned"&&!behaviour){setStatus("Describe what they do.");return}
if(!artStyleIds({mode:mode,prep:{styles:CATALOG.artStyles||[]}}).length){setStatus("Tick at least one style.");return}
running=true;document.getElementById("runArt").disabled=true;document.getElementById("runBatch").disabled=true;
try{setStatus("Storing the photo…");const photoDataUrl=await fileToDataUrl(file);const prep=await apiJson("/api/staging/render-probe/art-style/prepare",{photoDataUrl});
const manual={manualDevice:mode==="pinned"?"":manualDevice,suppliedTruth:mode!=="pinned"&&!!manualTruth,suppliedDevice:mode!=="pinned"&&!!manualDevice,approveNow:mode!=="pinned"&&(!!manualTruth||!!manualDevice)&&document.getElementById("approveNow").checked};
if(mode==="pinned"){showArtIdeas(Object.assign({prep,mode,behaviour,productFamily,productLabel,styleLabel,options:[{funnyTruth:prep.concept,punchline:prep.words,shotFlags:prep.shotFlags||[],originalTruth:prep.concept,originalFlags:prep.shotFlags||[],rewritten:false,composedHeading:prep.composedHeading||""}]},manual));setStatus("Confirm the pinned truth and its device. Nothing has been rendered.")}
else if(manualTruth){const idea={funnyTruth:manualTruth,punchline:wording,object:(document.getElementById("manualObject").value||"").trim()||null,humourOperator:document.getElementById("manualOperator").value,darknessLevel:Number(document.getElementById("manualDarkness").value),species:document.getElementById("manualSpecies").value,shotFlags:[],originalTruth:manualTruth,originalFlags:[],rewritten:false};showArtIdeas(Object.assign({prep,mode,behaviour,productFamily,productLabel,styleLabel,options:[idea]},manual));setStatus(manualDevice?"Manual concept ready. No writer ran. Nothing has been rendered.":"Truth is yours. The device is being written. Nothing has been rendered.")}
else{setStatus(manualDevice?"Writing three truths. The device is yours.":("Writing three truths for "+productLabel+"…"));const concepts=await apiJson("/api/staging/render-probe/art-style/concepts",{behaviour,exactWording:wording,productFamily,artStyle:mode==="one"?styleSel.value:""});
showArtIdeas(Object.assign({prep,mode,behaviour:concepts.behaviour,productFamily,productLabel,styleLabel,options:concepts.options||[]},manual));
setStatus(manualDevice?"Truths in "+(concepts.truthMs||"?")+"ms. The device is yours. Nothing has been rendered.":("Three truths in "+(concepts.truthMs||"?")+"ms. The first device is already writing. Nothing has been rendered."))}}
catch(e){setStatus(e.message||"Art style batch failed");hideArtIdeas()}
finally{running=false;document.getElementById("runArt").disabled=false;document.getElementById("runBatch").disabled=false}};
function showScreen(name){document.getElementById("sixLook").hidden=name!=="creation";document.getElementById("artTool").hidden=name!=="creation";document.getElementById("triage").hidden=name!=="triage";document.getElementById("simulate").hidden=name!=="simulate";document.getElementById("showCreation").setAttribute("aria-pressed",name==="creation"?"true":"false");document.getElementById("showTriage").setAttribute("aria-pressed",name==="triage"?"true":"false");document.getElementById("showSimulate").setAttribute("aria-pressed",name==="simulate"?"true":"false")}
function candidateCard(row, pick){const head="<b>"+h(row.status)+"</b> · "+h(row.source)+" · "+h(lookLabel(row.artStyle))+" · "+h(row.species);const body="<span>"+h(row.funnyTruth)+"</span><span class='hint'>"+h(row.deviceText)+"</span>";if(!pick)return "<div class='idea'>"+head+"<br>"+body+"</div>";return "<label class='idea'><span><input type='radio' name='simulateCandidate' value='"+h(row.id)+"'> "+head+"</span>"+body+"</label>"}
async function loadCandidates(listId, pick){const shop=(document.getElementById("flywheelShop").value||"").trim();const list=document.getElementById(listId);if(!token){setStatus("Unlock with the probe token first.");return}if(!shop){list.innerHTML="<p class='hint'>Enter the shop domain first.</p>";return}list.innerHTML="<p class='hint'>Loading…</p>";try{const j=await (await api("/api/staging/render-probe/candidates?shop="+encodeURIComponent(shop))).json();const rows=j.candidates||[];list.innerHTML=rows.length?rows.map(function(row){return candidateCard(row,pick)}).join(""):"<p class='hint'>No candidates for this shop yet.</p>"}catch(e){list.innerHTML="<p class='err'>"+h(e.message)+"</p>"}}
document.getElementById("showCreation").onclick=function(){showScreen("creation")};
document.getElementById("showTriage").onclick=function(){showScreen("triage");loadCandidates("triageList",false)};
document.getElementById("showSimulate").onclick=function(){showScreen("simulate");loadCandidates("simulateList",true)};
document.getElementById("loadTriage").onclick=function(){loadCandidates("triageList",false)};
document.getElementById("loadSimulate").onclick=function(){loadCandidates("simulateList",true)};
document.getElementById("runSimulate").onclick=async function(){if(running)return;const shop=(document.getElementById("flywheelShop").value||"").trim();const picked=document.querySelector("input[name='simulateCandidate']:checked");const file=document.getElementById("simulatePhoto").files[0];if(!token){setStatus("Unlock with the probe token first.");return}if(!shop||!picked){setStatus("Choose a shop and a stored design.");return}if(!file){setStatus("Choose a pet photo.");return}running=true;document.getElementById("runSimulate").disabled=true;try{setStatus("Running the stored recipe on this pet…");const out=await apiJson("/api/staging/render-probe/pet-swap",{shopDomain:shop,candidateId:picked.value,photoDataUrl:await fileToDataUrl(file)});await load(out.batchId?"art-styles:"+out.batchId:"");setStatus("Pet swap finished. No new candidate."+(out.width?" "+out.width+"×"+out.height:""))}catch(e){setStatus(e.message||"Pet swap failed")}finally{running=false;document.getElementById("runSimulate").disabled=false}};
document.getElementById("blind").onclick=()=>{blind=!blind;document.getElementById("blind").textContent=blind?"Reveal labels":"Blind";render()};
document.getElementById("matte").onclick=()=>{matte=matte==="dark"?"":"dark";document.getElementById("matte").textContent=matte?"Checkerboard":"Dark garment";render()};
document.getElementById("auth").onsubmit=(e)=>{e.preventDefault();token=document.getElementById("token").value.trim();sessionStorage.setItem(KEY,token);load()};
document.getElementById("exp").onchange=render;document.getElementById("close").onclick=()=>document.getElementById("full").close();
if(token)load();
</script></body></html>`;
