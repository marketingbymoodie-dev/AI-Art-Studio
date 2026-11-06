/**
 * My Pet — core orchestration. See shared/myPetSettings.ts for the pure
 * prompt/cap logic and docs/ticket-my-pet-storefront (plan) for the full spec.
 *
 * Flow: upload photo → generate (image edit of the finished design + pet,
 * then composited onto the garment via the same server compositor the
 * catalogue studio uses) → preview → (colour change recomposites, no new
 * generation) → add to cart via the existing resolve-design-variant shadow
 * SKU endpoint (storefront JS calls it directly, same as every other
 * customizer flow) → on purchase, server/my-pet-print-file.ts builds the
 * print file from the stored edited artwork.
 */
import { randomUUID } from "crypto";
import { and, eq, gte, sql } from "drizzle-orm";
import {
  designCandidates,
  generationEvents,
  generationJobs,
  myPetEmailCaptures,
  myPetPetPhotos,
  myPetRenders,
  myPetSettings,
  type MyPetSettingsRow,
} from "@shared/schema";
import {
  MY_PET_DEFAULT_BASE_PROMPT,
  MY_PET_DEFAULT_CAPS,
  MY_PET_DEFAULT_RENDER_PARAMS,
  MY_PET_SUNBURST_ESTIMATED_COST_USD,
  buildMyPetPrompt,
  evaluateMyPetCap,
  sanitizeMyPetCaps,
  sanitizeMyPetRenderParams,
  sanitizeMyPetStyleTweaks,
  type MyPetCapResult,
  type MyPetRenderParams,
  type MyPetSettings,
} from "@shared/myPetSettings";
import { db } from "./db";
import { CREDENTIALS, REPLICATE_ROUTE_MODELS, readPlatformReplicateToken } from "./generation-providers";
import { generationErrorCategory } from "./generation-events";
import { readLibraryObject, renderCandidateOnPanel, signedLibraryUrl, writeLibraryObject } from "./mockup-library-store";
import { softstyleType } from "./mockup-library-store";
import { decodeDataUrlOrBase64Image, getMyPetObject, putMyPetObject, removeMyPetObjects, signedMyPetUrl } from "./my-pet-storage";
import { renderReplicateImageEdit } from "./replit_integrations/image/client";
import { storage } from "./storage";

// My Pet uses the shared Replicate account (REPLICATE_API_TOKEN) to call Sunburst
// — openai/gpt-image-2.5-sunburst, the premium tier of the gpt-image-2.5 family
// routed through Replicate. See shared/myPetSettings.ts for the per-call
// parameters (size, quality, background, output_format, output_compression,
// moderation) and MY_PET_SUNBURST_ESTIMATED_COST_USD for the flat cost estimate
// (Replicate's API does not return token usage per prediction).
const MY_PET_REPLICATE_CREDENTIAL = CREDENTIALS["replicate:shared"];
const MY_PET_REPLICATE_MODEL = REPLICATE_ROUTE_MODELS["replicate-sunburst"];

const PHOTO_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const EMAIL_PREVIEW_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

// ─────────────────────────────────────────────────────────────────────────
// Settings
// ─────────────────────────────────────────────────────────────────────────

function rowToSettings(row: MyPetSettingsRow): MyPetSettings {
  // renderParams is JSONB with a defaulted row value — but guard against rows
  // written before the column existed (or an operator setting it to an invalid
  // partial payload by hand) by routing it through the same sanitizer the PUT
  // endpoint uses, falling back to the default per-field.
  const renderParams = sanitizeMyPetRenderParams(row.renderParams, MY_PET_DEFAULT_RENDER_PARAMS);
  return {
    shopDomain: row.shopDomain,
    basePrompt: row.basePrompt || MY_PET_DEFAULT_BASE_PROMPT,
    styleTweaks: (row.styleTweaks as Record<string, string>) || {},
    caps: { perListing: row.capPerListing, perDay: row.capPerDay, emailBonus: row.capEmailBonus },
    renderParams,
  };
}

export async function getMyPetSettings(shopDomain: string): Promise<MyPetSettings> {
  const [row] = await db.select().from(myPetSettings).where(eq(myPetSettings.shopDomain, shopDomain));
  if (row) return rowToSettings(row);
  const [created] = await db
    .insert(myPetSettings)
    .values({
      shopDomain,
      basePrompt: MY_PET_DEFAULT_BASE_PROMPT,
      styleTweaks: {},
      ...MY_PET_DEFAULT_CAPS_COLUMNS(),
      renderParams: { ...MY_PET_DEFAULT_RENDER_PARAMS },
    })
    .onConflictDoNothing()
    .returning();
  if (created) return rowToSettings(created);
  // Lost the race to insert — another request created it first.
  const [again] = await db.select().from(myPetSettings).where(eq(myPetSettings.shopDomain, shopDomain));
  return again
    ? rowToSettings(again)
    : {
        shopDomain,
        basePrompt: MY_PET_DEFAULT_BASE_PROMPT,
        styleTweaks: {},
        caps: { ...MY_PET_DEFAULT_CAPS },
        renderParams: { ...MY_PET_DEFAULT_RENDER_PARAMS },
      };
}

function MY_PET_DEFAULT_CAPS_COLUMNS() {
  return {
    capPerListing: MY_PET_DEFAULT_CAPS.perListing,
    capPerDay: MY_PET_DEFAULT_CAPS.perDay,
    capEmailBonus: MY_PET_DEFAULT_CAPS.emailBonus,
  };
}

export async function updateMyPetSettings(
  shopDomain: string,
  patch: { basePrompt?: string; styleTweaks?: unknown; caps?: unknown; renderParams?: unknown },
): Promise<MyPetSettings> {
  const current = await getMyPetSettings(shopDomain);
  const basePrompt = typeof patch.basePrompt === "string" && patch.basePrompt.trim() ? patch.basePrompt.trim().slice(0, 4000) : current.basePrompt;
  const styleTweaks = patch.styleTweaks !== undefined ? sanitizeMyPetStyleTweaks(patch.styleTweaks) : current.styleTweaks;
  const caps = patch.caps !== undefined ? sanitizeMyPetCaps(patch.caps, current.caps) : current.caps;
  const renderParams =
    patch.renderParams !== undefined ? sanitizeMyPetRenderParams(patch.renderParams, current.renderParams) : current.renderParams;
  await db
    .insert(myPetSettings)
    .values({
      shopDomain,
      basePrompt,
      styleTweaks,
      capPerListing: caps.perListing,
      capPerDay: caps.perDay,
      capEmailBonus: caps.emailBonus,
      renderParams,
    })
    .onConflictDoUpdate({
      target: myPetSettings.shopDomain,
      set: {
        basePrompt,
        styleTweaks,
        capPerListing: caps.perListing,
        capPerDay: caps.perDay,
        capEmailBonus: caps.emailBonus,
        renderParams,
        updatedAt: new Date(),
      },
    });
  return { shopDomain, basePrompt, styleTweaks, caps, renderParams };
}

// ─────────────────────────────────────────────────────────────────────────
// Candidate lookup / eligibility
// ─────────────────────────────────────────────────────────────────────────

export type MyPetEligibleCandidate = {
  id: string;
  shopDomain: string;
  species: string;
  artStyle: string;
  punchline: string;
  artworkPath: string;
  panelId: string;
  selectedColors: Array<{ name: string; hex: string }>;
};

export class MyPetCandidateIneligibleError extends Error {}

export async function getEligibleCandidateForMyPet(shop: string, candidateId: string): Promise<MyPetEligibleCandidate> {
  const [row] = await db.select().from(designCandidates).where(eq(designCandidates.id, candidateId));
  if (!row) throw new MyPetCandidateIneligibleError("Design not found");
  if (row.shopDomain !== shop) throw new MyPetCandidateIneligibleError("Design not found");
  if (row.status !== "promoted") throw new MyPetCandidateIneligibleError("Design is not published");
  if (!row.artworkPath) throw new MyPetCandidateIneligibleError("Design has no stored artwork");
  if (!row.panelId) throw new MyPetCandidateIneligibleError("Design has no scene set");
  const colors = Array.isArray(row.selectedColors) ? (row.selectedColors as Array<{ name: string; hex: string }>) : [];
  if (!colors.length) throw new MyPetCandidateIneligibleError("Design has no colours set");
  return {
    id: row.id,
    shopDomain: row.shopDomain,
    species: row.species,
    artStyle: row.artStyle,
    punchline: row.punchline || "",
    artworkPath: row.artworkPath,
    panelId: row.panelId,
    selectedColors: colors,
  };
}

function resolveColorHex(candidate: MyPetEligibleCandidate, colorName: string | null | undefined): { name: string; hex: string } {
  const wanted = String(colorName || "").trim().toLowerCase();
  const match = wanted ? candidate.selectedColors.find((c) => c.name.trim().toLowerCase() === wanted) : undefined;
  return match || candidate.selectedColors[0];
}

// ─────────────────────────────────────────────────────────────────────────
// Caps — cookie device key AND client IP, whichever is stricter (plan: "no
// login, cookie + IP").
// ─────────────────────────────────────────────────────────────────────────

async function countRenders(shop: string, shopifyProductId: string | null, deviceKey: string, clientIp: string, sinceDailyOnly: boolean): Promise<{ perListingCount: number; dailyCount: number }> {
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [deviceDaily] = await db
    .select({ n: sql<number>`count(*)` })
    .from(myPetRenders)
    .where(and(eq(myPetRenders.shopDomain, shop), eq(myPetRenders.deviceKey, deviceKey), gte(myPetRenders.createdAt, dayAgo)));
  const [ipDaily] = clientIp
    ? await db
        .select({ n: sql<number>`count(*)` })
        .from(myPetRenders)
        .where(and(eq(myPetRenders.shopDomain, shop), eq(myPetRenders.clientIp, clientIp), gte(myPetRenders.createdAt, dayAgo)))
    : [{ n: 0 }];
  let perListingCount = 0;
  if (!sinceDailyOnly && shopifyProductId) {
    const [deviceListing] = await db
      .select({ n: sql<number>`count(*)` })
      .from(myPetRenders)
      .where(and(eq(myPetRenders.shopDomain, shop), eq(myPetRenders.deviceKey, deviceKey), eq(myPetRenders.shopifyProductId, shopifyProductId)));
    const [ipListing] = clientIp
      ? await db
          .select({ n: sql<number>`count(*)` })
          .from(myPetRenders)
          .where(and(eq(myPetRenders.shopDomain, shop), eq(myPetRenders.clientIp, clientIp), eq(myPetRenders.shopifyProductId, shopifyProductId)))
      : [{ n: 0 }];
    perListingCount = Math.max(Number(deviceListing?.n) || 0, Number(ipListing?.n) || 0);
  }
  return { perListingCount, dailyCount: Math.max(Number(deviceDaily?.n) || 0, Number(ipDaily?.n) || 0) };
}

async function hasEmailBonus(shop: string, deviceKey: string, shopifyProductId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: myPetEmailCaptures.id })
    .from(myPetEmailCaptures)
    .where(and(eq(myPetEmailCaptures.shopDomain, shop), eq(myPetEmailCaptures.deviceKey, deviceKey), eq(myPetEmailCaptures.shopifyProductId, shopifyProductId)))
    .limit(1);
  return !!row;
}

export async function checkMyPetCap(args: { shop: string; shopifyProductId: string; deviceKey: string; clientIp: string }): Promise<MyPetCapResult> {
  const settings = await getMyPetSettings(args.shop);
  const [{ perListingCount, dailyCount }, emailBonus] = await Promise.all([
    countRenders(args.shop, args.shopifyProductId, args.deviceKey, args.clientIp, false),
    hasEmailBonus(args.shop, args.deviceKey, args.shopifyProductId),
  ]);
  return evaluateMyPetCap({ perListingCount, dailyCount, hasEmailBonus: emailBonus, caps: settings.caps });
}

// ─────────────────────────────────────────────────────────────────────────
// Photo upload
// ─────────────────────────────────────────────────────────────────────────

export async function uploadMyPetPhoto(shop: string, deviceKey: string, imageData: string): Promise<{ photoId: string }> {
  const buf = decodeDataUrlOrBase64Image(imageData);
  if (buf.length > 15 * 1024 * 1024) throw new Error("Photo is too large");
  const photoId = randomUUID();
  const path = `pet-photos/${shop}/${photoId}.png`;
  await putMyPetObject(path, buf, "image/png");
  await db.insert(myPetPetPhotos).values({ id: photoId, shopDomain: shop, deviceKey, storagePath: path });
  return { photoId };
}

// ─────────────────────────────────────────────────────────────────────────
// Generate (image edit + compositor preview)
// ─────────────────────────────────────────────────────────────────────────

export type MyPetGenerateResult = {
  renderId: string;
  jobId: string;
  previewUrl: string;
  colorName: string;
};

export async function generateMyPetRender(args: {
  shop: string;
  shopifyProductId: string;
  candidate: MyPetEligibleCandidate;
  photoId: string;
  deviceKey: string;
  clientIp: string;
  colorName: string | null;
  sizeId: string | null;
}): Promise<MyPetGenerateResult> {
  const [photo] = await db.select().from(myPetPetPhotos).where(eq(myPetPetPhotos.id, args.photoId));
  if (!photo || photo.shopDomain !== args.shop || photo.deviceKey !== args.deviceKey) {
    throw new Error("Pet photo not found — please upload again");
  }
  const settings = await getMyPetSettings(args.shop);
  const color = resolveColorHex(args.candidate, args.colorName);
  const prompt = buildMyPetPrompt(settings, {
    species: args.candidate.species,
    artStyle: args.candidate.artStyle,
    punchline: args.candidate.punchline,
  });

  // Signed HTTPS URLs for both references — keeps Replicate's POST body small
  // vs. inlining multi-MB base64 data URLs, and matches the catalogue flow.
  // Both buckets are the same ones the compositor reads from.
  const [designUrl, petUrl, token] = await Promise.all([
    signedLibraryUrl(args.candidate.artworkPath),
    signedMyPetUrl(photo.storagePath),
    Promise.resolve(readPlatformReplicateToken()),
  ]);
  const started = Date.now();
  const renderParams: MyPetRenderParams = settings.renderParams;

  let result;
  try {
    result = await renderReplicateImageEdit({
      token,
      modelSlug: MY_PET_REPLICATE_MODEL,
      prompt,
      references: [designUrl, petUrl],
      size: renderParams.size,
      quality: renderParams.quality,
      background: renderParams.background,
      outputFormat: renderParams.outputFormat,
      outputCompression: renderParams.outputCompression,
      moderation: renderParams.moderation,
    });
  } catch (err) {
    await recordMyPetGenerationEvent({ shop: args.shop, success: false, durationMs: Date.now() - started, error: err });
    throw err;
  }

  const renderId = randomUUID();
  const editedPath = `my-pet/edited/${renderId}.png`;
  const editedBuf = Buffer.from(result.data, "base64");
  await writeLibraryObject(editedPath, editedBuf, "image/png");

  const productType = await softstyleType();
  const { png: previewPng } = await renderCandidateOnPanel({
    productTypeId: productType.id,
    typeName: productType.name,
    panelId: args.candidate.panelId,
    colorName: color.name,
    colorHex: color.hex,
    artworkPath: editedPath,
  });
  const previewPath = `my-pet/previews/${renderId}.png`;
  await putMyPetObject(previewPath, previewPng, "image/png");
  const previewUrl = await signedMyPetUrl(previewPath);

  // Replicate's API does not return per-prediction token usage, so we record
  // a flat measured cost (see MY_PET_SUNBURST_ESTIMATED_COST_USD). Update that
  // constant if size/quality in MY_PET_DEFAULT_RENDER_PARAMS change.
  const estimatedCostUsd = MY_PET_SUNBURST_ESTIMATED_COST_USD;
  await recordMyPetGenerationEvent({
    shop: args.shop,
    success: true,
    durationMs: result.durationMs,
    estimatedCostUsd,
    model: MY_PET_REPLICATE_MODEL,
    quality: renderParams.quality,
    providerRequestId: result.providerRequestId,
  });

  const jobId = randomUUID();
  await db.insert(generationJobs).values({
    id: jobId,
    shop: args.shop,
    // Lets /api/storefront/resolve-design-variant's ownership check (anon
    // session must match job.sessionId — see decideJobAccess) pass: our own
    // device cookie doubles as that anon session id, forwarded again at
    // resolve-variant time in routes/my-pet.ts.
    sessionId: args.deviceKey,
    status: "complete",
    prompt,
    size: args.sizeId || null,
    frameColor: color.name,
    productTypeId: String(productType.id),
    designImageUrl: previewUrl,
    designState: {
      source: "my-pet",
      candidateId: args.candidate.id,
      renderId,
      petPhotoId: args.photoId,
      artStyle: args.candidate.artStyle,
      species: args.candidate.species,
      punchline: args.candidate.punchline,
      editedArtworkPath: editedPath,
      colorName: color.name,
      colorHex: color.hex,
      sizeId: args.sizeId || null,
      panelId: args.candidate.panelId,
    },
    expiresAt: new Date(Date.now() + EMAIL_PREVIEW_RETENTION_MS),
  });

  await db.insert(myPetRenders).values({
    id: renderId,
    shopDomain: args.shop,
    deviceKey: args.deviceKey,
    clientIp: args.clientIp || null,
    shopifyProductId: args.shopifyProductId,
    candidateId: args.candidate.id,
    petPhotoId: args.photoId,
    previewPath,
    jobId,
    colorId: color.name,
    sizeId: args.sizeId || null,
    durationMs: result.durationMs,
    estimatedCostUsd: estimatedCostUsd != null ? String(estimatedCostUsd) : null,
  });

  return { renderId, jobId, previewUrl, colorName: color.name };
}

async function recordMyPetGenerationEvent(args: {
  shop: string;
  success: boolean;
  durationMs: number;
  estimatedCostUsd?: number | null;
  model?: string;
  quality?: string;
  providerRequestId?: string | null;
  error?: unknown;
}): Promise<void> {
  try {
    await db.insert(generationEvents).values({
      kind: "image",
      route: "my-pet-generate",
      shopDomain: args.shop,
      productFamily: "apparel",
      provider: "replicate",
      credentialScope: MY_PET_REPLICATE_CREDENTIAL.scope,
      credentialRef: MY_PET_REPLICATE_CREDENTIAL.id,
      model: args.model ?? MY_PET_REPLICATE_MODEL,
      quality: args.quality ?? MY_PET_DEFAULT_RENDER_PARAMS.quality,
      durationMs: Math.round(args.durationMs),
      // Replicate's API does not return per-prediction token usage.
      usage: null,
      estimatedCostUsd: args.estimatedCostUsd != null ? args.estimatedCostUsd.toFixed(6) : null,
      providerRequestId: args.providerRequestId ?? null,
      providerMime: "image/png",
      success: args.success,
      errorCategory: args.success ? null : generationErrorCategory(args.error),
      endUserHash: null,
    });
  } catch (err) {
    console.warn("[my-pet] failed to write generation event:", (err as Error)?.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Recomposite on colour change — no model call
// ─────────────────────────────────────────────────────────────────────────

export async function recompositeMyPetRender(args: { shop: string; deviceKey: string; renderId: string; colorName: string }): Promise<{ previewUrl: string; colorName: string }> {
  const [render] = await db.select().from(myPetRenders).where(eq(myPetRenders.id, args.renderId));
  if (!render || render.shopDomain !== args.shop || render.deviceKey !== args.deviceKey) {
    throw new Error("Design not found");
  }
  const candidate = await getEligibleCandidateForMyPet(args.shop, render.candidateId);
  const color = resolveColorHex(candidate, args.colorName);
  const job = render.jobId ? await storage.getGenerationJob(render.jobId) : undefined;
  const designState = (job?.designState as Record<string, unknown>) || {};
  const editedArtworkPath = String(designState.editedArtworkPath || "");
  if (!editedArtworkPath) throw new Error("Original edit is missing — please generate again");

  const productType = await softstyleType();
  const { png } = await renderCandidateOnPanel({
    productTypeId: productType.id,
    typeName: productType.name,
    panelId: candidate.panelId,
    colorName: color.name,
    colorHex: color.hex,
    artworkPath: editedArtworkPath,
  });
  const previewPath = `my-pet/previews/${render.id}-${color.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.png`;
  await putMyPetObject(previewPath, png, "image/png");
  const previewUrl = await signedMyPetUrl(previewPath);

  if (render.jobId) {
    await storage.updateGenerationJob(render.jobId, {
      designImageUrl: previewUrl,
      frameColor: color.name,
      designState: { ...designState, colorName: color.name, colorHex: color.hex },
    } as any);
  }

  return { previewUrl, colorName: color.name };
}

// ─────────────────────────────────────────────────────────────────────────
// Add to cart — the storefront calls the existing /api/storefront/resolve-
// design-variant endpoint itself (same one every other customizer flow uses
// for its shadow SKU), so this only has to hand back a job id and a FRESH
// signed preview URL (the one on the job row may have expired by now).
// ─────────────────────────────────────────────────────────────────────────

export async function getMyPetRenderForAddToCart(args: { shop: string; deviceKey: string; renderId: string }): Promise<{ jobId: string; previewUrl: string }> {
  const [render] = await db.select().from(myPetRenders).where(eq(myPetRenders.id, args.renderId));
  if (!render || render.shopDomain !== args.shop || render.deviceKey !== args.deviceKey || !render.jobId) {
    throw new Error("Design not found");
  }
  const previewUrl = await signedMyPetUrl(render.previewPath);
  return { jobId: render.jobId, previewUrl };
}

// ─────────────────────────────────────────────────────────────────────────
// Email save
// ─────────────────────────────────────────────────────────────────────────

function generateToken(): string {
  return randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "").slice(0, 16);
}

export async function sendMyPetEmailSave(args: {
  shop: string;
  deviceKey: string;
  renderId: string;
  email: string;
  marketingConsent: boolean;
  pageUrl: string;
}): Promise<{ ok: true }> {
  const [render] = await db.select().from(myPetRenders).where(eq(myPetRenders.id, args.renderId));
  if (!render || render.shopDomain !== args.shop || render.deviceKey !== args.deviceKey) {
    throw new Error("Design not found");
  }
  const email = args.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Please enter a valid email");

  const token = generateToken();
  await db.insert(myPetEmailCaptures).values({
    shopDomain: args.shop,
    deviceKey: args.deviceKey,
    shopifyProductId: render.shopifyProductId,
    renderId: render.id,
    email,
    marketingConsent: !!args.marketingConsent,
    token,
    expiresAt: new Date(Date.now() + EMAIL_PREVIEW_RETENTION_MS),
  });

  const previewUrl = await signedMyPetUrl(render.previewPath);
  const link = withTokenParam(args.pageUrl, token);
  await sendMyPetSaveEmail(email, previewUrl, link);
  void createShopifyCustomerWithConsent(args.shop, email, args.marketingConsent);
  return { ok: true };
}

function withTokenParam(pageUrl: string, token: string): string {
  try {
    const url = new URL(pageUrl);
    url.searchParams.set("my_pet_token", token);
    return url.toString();
  } catch {
    const sep = pageUrl.includes("?") ? "&" : "?";
    return `${pageUrl}${sep}my_pet_token=${token}`;
  }
}

async function sendMyPetSaveEmail(email: string, previewUrl: string, link: string): Promise<void> {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    console.error("[my-pet] RESEND_API_KEY not set — cannot send save email");
    throw new Error("Email service is not configured");
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "My Pet <onboarding@resend.dev>",
      to: [email],
      subject: "Your My Pet design is saved",
      html:
        `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:20px">` +
        `<h2 style="text-align:center">Your design is saved</h2>` +
        `<img src="${previewUrl}" alt="Your design" style="width:100%;border-radius:8px;margin:16px 0" />` +
        `<p style="text-align:center"><a href="${link}" style="display:inline-block;background:#111;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none">Continue where you left off</a></p>` +
        `<p style="color:#666;text-align:center;font-size:13px">This link works for 30 days, on any device.</p>` +
        `</div>`,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Resend error: ${text.slice(0, 200)}`);
  }
}

async function createShopifyCustomerWithConsent(shop: string, email: string, marketingConsent: boolean): Promise<void> {
  try {
    const installation = await storage.getShopifyInstallationByShop(shop);
    if (!installation?.accessToken) return;
    const query = `mutation($input: CustomerInput!) {
      customerCreate(input: $input) {
        customer { id }
        userErrors { field message }
      }
    }`;
    const input: Record<string, unknown> = { email };
    if (marketingConsent) {
      input.emailMarketingConsent = { marketingState: "SUBSCRIBED", marketingOptInLevel: "SINGLE_OPT_IN" };
    }
    const res = await fetch(`https://${shop}/admin/api/2025-10/graphql.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": installation.accessToken },
      body: JSON.stringify({ query, variables: { input } }),
    });
    const json = await res.json().catch(() => ({}));
    const userErrors = json?.data?.customerCreate?.userErrors || [];
    if (userErrors.length && !userErrors.some((e: { message?: string }) => /taken|already/i.test(e.message || ""))) {
      console.warn(`[my-pet] customerCreate userErrors for ${shop}:`, JSON.stringify(userErrors));
    }
  } catch (err) {
    console.warn(`[my-pet] customerCreate failed for ${shop}:`, (err as Error)?.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Resolve by email-saved token
// ─────────────────────────────────────────────────────────────────────────

export async function resolveMyPetEmailToken(token: string): Promise<{
  renderId: string;
  candidateId: string;
  previewUrl: string;
  colorName: string | null;
  sizeId: string | null;
} | null> {
  const [capture] = await db.select().from(myPetEmailCaptures).where(eq(myPetEmailCaptures.token, token));
  if (!capture) return null;
  if (capture.expiresAt.getTime() < Date.now()) return null;
  const [render] = await db.select().from(myPetRenders).where(eq(myPetRenders.id, capture.renderId));
  if (!render) return null;
  await db.update(myPetEmailCaptures).set({ resolvedAt: new Date() }).where(eq(myPetEmailCaptures.id, capture.id));
  const previewUrl = await signedMyPetUrl(render.previewPath);
  return { renderId: render.id, candidateId: render.candidateId, previewUrl, colorName: render.colorId, sizeId: render.sizeId };
}

// ─────────────────────────────────────────────────────────────────────────
// Retention sweeps — 7-day photos (unless purchased), 30-day email-saved
// previews. Called hourly by registerMyPetRoutes().
// ─────────────────────────────────────────────────────────────────────────

export async function sweepMyPetRetention(): Promise<{ photosDeleted: number; previewsDeleted: number }> {
  let photosDeleted = 0;
  let previewsDeleted = 0;
  try {
    const cutoff = new Date(Date.now() - PHOTO_RETENTION_MS);
    const expired = await db
      .select({ id: myPetPetPhotos.id, storagePath: myPetPetPhotos.storagePath })
      .from(myPetPetPhotos)
      .where(and(sql`${myPetPetPhotos.createdAt} < ${cutoff}`, sql`${myPetPetPhotos.orderId} IS NULL`));
    if (expired.length) {
      await removeMyPetObjects(expired.map((row) => row.storagePath));
      for (const row of expired) {
        await db.delete(myPetPetPhotos).where(eq(myPetPetPhotos.id, row.id));
      }
      photosDeleted = expired.length;
    }
  } catch (err) {
    console.warn("[my-pet] photo sweep failed:", (err as Error)?.message);
  }

  try {
    // Previews with an email save keep 30 days from that save; everything else
    // follows the same 7-day window as the photo it came from.
    const emailCutoff = new Date(Date.now() - EMAIL_PREVIEW_RETENTION_MS);
    const plainCutoff = new Date(Date.now() - PHOTO_RETENTION_MS);
    const rows = await db
      .select({ id: myPetRenders.id, previewPath: myPetRenders.previewPath, createdAt: myPetRenders.createdAt })
      .from(myPetRenders)
      .where(sql`${myPetRenders.createdAt} < ${plainCutoff}`);
    for (const row of rows) {
      const [emailRow] = await db
        .select({ id: myPetEmailCaptures.id })
        .from(myPetEmailCaptures)
        .where(eq(myPetEmailCaptures.renderId, row.id))
        .limit(1);
      const hasEmail = !!emailRow;
      const expired = hasEmail ? row.createdAt < emailCutoff : true;
      if (!expired) continue;
      try {
        await removeMyPetObjects([row.previewPath]);
      } catch {
        // storage object already gone — still clear the row
      }
      await db.delete(myPetRenders).where(eq(myPetRenders.id, row.id));
      previewsDeleted++;
    }
  } catch (err) {
    console.warn("[my-pet] preview sweep failed:", (err as Error)?.message);
  }

  return { photosDeleted, previewsDeleted };
}

let sweepTimer: ReturnType<typeof setInterval> | null = null;

export function startMyPetSweepInterval(): void {
  if (sweepTimer) return;
  sweepTimer = setInterval(() => {
    sweepMyPetRetention().catch((err) => console.error("[my-pet] sweep interval error:", err));
  }, 60 * 60 * 1000);
  sweepTimer.unref?.();
}

/** Marks the photo behind a purchased design as kept (order linked), exempting it from the 7-day sweep. */
export async function markMyPetPhotoPurchased(petPhotoId: string, orderId: string): Promise<void> {
  try {
    await db.update(myPetPetPhotos).set({ orderId }).where(eq(myPetPetPhotos.id, petPhotoId));
  } catch (err) {
    console.warn("[my-pet] markMyPetPhotoPurchased failed:", (err as Error)?.message);
  }
}
