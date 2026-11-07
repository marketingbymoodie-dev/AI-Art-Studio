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
import { decodeDataUrlOrBase64Image, getMyPetObject, myPetObjectExists, putMyPetObject, removeMyPetObjects, signedMyPetUrl } from "./my-pet-storage";
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

async function countRenders(
  shop: string,
  shopifyProductId: string | null,
  deviceKey: string,
  clientIp: string,
  sinceDailyOnly: boolean,
): Promise<{ perListingCount: number; dailyCount: number; perListingRenderIds: string[] }> {
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
  // Bug 3 diagnostic: the actual device-scoped render ids counted against this
  // product, so a merchant/debugger can reconcile "what's in the DB right now"
  // against what the shopper remembers doing, without a manual DB dump.
  let perListingRenderIds: string[] = [];
  if (!sinceDailyOnly && shopifyProductId) {
    const deviceListingRows = await db
      .select({ id: myPetRenders.id })
      .from(myPetRenders)
      .where(and(eq(myPetRenders.shopDomain, shop), eq(myPetRenders.deviceKey, deviceKey), eq(myPetRenders.shopifyProductId, shopifyProductId)));
    const [ipListing] = clientIp
      ? await db
          .select({ n: sql<number>`count(*)` })
          .from(myPetRenders)
          .where(and(eq(myPetRenders.shopDomain, shop), eq(myPetRenders.clientIp, clientIp), eq(myPetRenders.shopifyProductId, shopifyProductId)))
      : [{ n: 0 }];
    perListingCount = Math.max(deviceListingRows.length, Number(ipListing?.n) || 0);
    perListingRenderIds = deviceListingRows.map((r) => r.id);
  }
  return { perListingCount, dailyCount: Math.max(Number(deviceDaily?.n) || 0, Number(ipDaily?.n) || 0), perListingRenderIds };
}

async function hasEmailBonus(shop: string, deviceKey: string, shopifyProductId: string): Promise<boolean> {
  // Polish F (Model 2): the +2 bonus is granted only to shoppers who explicitly
  // opted in to the Petposterous Press (marketing_consent=true), not for every
  // email submission. The "Just save my design" secondary button still records
  // a capture row (marketing_consent=false, enabling the save-link email) but
  // does NOT earn the bonus — keeping the "Sign up for 2 more custom designs"
  // copy honest. No backfill needed: all existing captures already carry a
  // concrete true/false consent from the pre-change checkbox state.
  const [row] = await db
    .select({ id: myPetEmailCaptures.id })
    .from(myPetEmailCaptures)
    .where(and(
      eq(myPetEmailCaptures.shopDomain, shop),
      eq(myPetEmailCaptures.deviceKey, deviceKey),
      eq(myPetEmailCaptures.shopifyProductId, shopifyProductId),
      eq(myPetEmailCaptures.marketingConsent, true),
    ))
    .limit(1);
  return !!row;
}

export type MyPetCapStatus = MyPetCapResult & {
  perListingCount: number;
  perListingLimit: number;
  perListingRemaining: number;
  /** Base per-listing limit before any email bonus — lets the client show "X of Y (incl. Z email bonus)". */
  perListingBaseLimit: number;
  /** Configured email-bonus amount (settings.caps.emailBonus), regardless of whether it's been applied yet. */
  emailBonusAmount: number;
  dailyCount: number;
  dailyLimit: number;
  dailyRemaining: number;
  /** True when this shopper has email-saved on this product, so emailBonus is already in perListingLimit. */
  emailBonusApplied: boolean;
  /** True when the shopper can earn +emailBonus more attempts by saving their email on this product. */
  emailBonusAvailable: boolean;
  /** First 8 chars of the signed device key — same prefix the Railway cap-check log line shows. */
  deviceKeyShort: string;
  /** Bug 3 diagnostic: the exact render ids counted against this product for this device. */
  diagnostics: { shopifyProductId: string; countedRenderIds: string[] };
};

export async function checkMyPetCap(args: {
  shop: string;
  shopifyProductId: string;
  deviceKey: string;
  clientIp: string;
}): Promise<MyPetCapStatus> {
  const settings = await getMyPetSettings(args.shop);
  const [{ perListingCount, dailyCount, perListingRenderIds }, emailBonus] = await Promise.all([
    countRenders(args.shop, args.shopifyProductId, args.deviceKey, args.clientIp, false),
    hasEmailBonus(args.shop, args.deviceKey, args.shopifyProductId),
  ]);
  const base = evaluateMyPetCap({ perListingCount, dailyCount, hasEmailBonus: emailBonus, caps: settings.caps });
  const perListingLimit = settings.caps.perListing + (emailBonus ? settings.caps.emailBonus : 0);
  const dailyLimit = settings.caps.perDay;
  const status: MyPetCapStatus = {
    ...base,
    perListingCount,
    perListingLimit,
    perListingRemaining: Math.max(0, perListingLimit - perListingCount),
    perListingBaseLimit: settings.caps.perListing,
    emailBonusAmount: settings.caps.emailBonus,
    dailyCount,
    dailyLimit,
    dailyRemaining: Math.max(0, dailyLimit - dailyCount),
    emailBonusApplied: emailBonus,
    emailBonusAvailable: !emailBonus && settings.caps.emailBonus > 0,
    deviceKeyShort: args.deviceKey.slice(0, 8),
    diagnostics: { shopifyProductId: args.shopifyProductId, countedRenderIds: perListingRenderIds },
  };
  console.log(
    `[my-pet] cap check shop=${args.shop} product=${args.shopifyProductId} ` +
      `device=${args.deviceKey.slice(0, 8)} ip=${args.clientIp || "-"} ` +
      `perListing=${perListingCount}/${perListingLimit} daily=${dailyCount}/${dailyLimit} ` +
      `emailBonus=${emailBonus ? "applied" : "none"} allowed=${base.allowed} ` +
      `renderIds=[${perListingRenderIds.map((id) => id.slice(0, 8)).join(",")}]` +
      (base.allowed ? "" : ` reason=${base.reason}`),
  );
  return status;
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
  /**
   * BUG D (post-staging-89) — server-side pre-composite: at generate time
   * we composite the shopper's chosen colour synchronously (previewUrl) AND
   * every other candidate colour in parallel, returning the full
   * {colourName: signedUrl} map so the client can pre-populate its
   * per-colour cache. Every subsequent swatch click is then a CLIENT CACHE
   * HIT (instant <img src=…> swap, no /recomposite round-trip, no Supabase
   * sign, no server compose). Trades ~3-8s of parallel compose on top of
   * the existing ~22s generate wait for permanently-instant colour swaps.
   * Shopper eats the cost once per design; the current per-swap 6s was
   * being paid every single click.
   *
   * Partial failures silently drop the failed colour from the map (compose
   * is deterministic and retried on demand via /recomposite on first click,
   * which still has its own server-side cache lookup as a fallback).
   */
  previewUrlsByColor: Record<string, string>;
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
  // Issue 5 (post-staging-93) — prompt diagnostic. getMyPetSettings has no
  // in-memory cache (fresh DB SELECT every call via rowToSettings), so a
  // save from /admin/my-pet-settings is live on the very next generate.
  // When the Sunburst output doesn't reflect a merchant edit to basePrompt,
  // this log settles the debate between (a) stale cache / wrong shop /
  // wrong row and (b) the wording isn't strong enough to steer the model:
  //
  //   basePromptSource        — "default" if no row override, else "db"
  //   basePromptLen / tweakLen — quick sanity-check sizes
  //   basePromptHead           — first 160 chars of the stored basePrompt
  //                               so Craig can eyeball-match what he saved
  //   fullPromptLen            — bytes shipped to Replicate
  //   fullPromptHead/Tail      — first 240 + last 240 chars of the exact
  //                               string sent to Replicate (base + tweak +
  //                               details + locked rules concatenated)
  //
  // Log at info level — intentionally chatty, scoped to generate calls so
  // it runs at most once per cap-attempt. Trimmed to ~720 chars total so
  // Railway doesn't truncate it mid-prompt.
  const tweak = settings.styleTweaks?.[args.candidate.artStyle] || "";
  const basePromptSource = settings.basePrompt && settings.basePrompt !== MY_PET_DEFAULT_BASE_PROMPT ? "db" : "default";
  console.log(
    `[my-pet] prompt diagnostic shop=${args.shop} ` +
      `candidate=${args.candidate.id?.slice(0, 8) || "?"} ` +
      `artStyle=${args.candidate.artStyle || "?"} ` +
      `basePromptSource=${basePromptSource} basePromptLen=${settings.basePrompt.length} ` +
      `tweakLen=${tweak.length} fullPromptLen=${prompt.length}`,
  );
  console.log(`[my-pet] prompt basePromptHead=${JSON.stringify(settings.basePrompt.slice(0, 160))}`);
  console.log(`[my-pet] prompt fullPromptHead=${JSON.stringify(prompt.slice(0, 240))}`);
  console.log(`[my-pet] prompt fullPromptTail=${JSON.stringify(prompt.slice(-240))}`);

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
  // Canonical preview path — stays `{renderId}.png` for backward-compat with
  // every existing row (myPetRenders.previewPath, the sweep's object delete,
  // email save, etc.). The per-colour sibling we additionally write below
  // feeds the recomposite cache.
  const previewPath = `my-pet/previews/${renderId}.png`;
  await putMyPetObject(previewPath, previewPng, "image/png");
  const previewUrl = await signedMyPetUrl(previewPath);

  // Deterministic per-colour path matches recompositeMyPetRender's naming
  // scheme so a later `/recomposite` for the chosen (or any pre-composited)
  // colour finds the file and hits its CACHE HIT fast path.
  const previewPathFor = (name: string) =>
    `my-pet/previews/${renderId}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.png`;
  const chosenPerColorPath = previewPathFor(color.name);
  try {
    await putMyPetObject(chosenPerColorPath, previewPng, "image/png");
  } catch (err) {
    console.warn("[my-pet] chosen-colour sibling write failed:", (err as Error)?.message);
  }

  // BUG D — pre-composite every OTHER candidate colour in parallel so the
  // client can seed state.previewUrlByColor with all N urls and every swatch
  // click is a client-cache hit. Promise.allSettled + per-colour try/catch
  // means one bad colour (missing mockup panel, etc.) never blocks the
  // chosen one from returning. Each entry we succeed in composing goes
  // straight into the server-side cache too, so a cross-session restore
  // path still hits CACHE HIT on recomposite.
  const otherColors = args.candidate.selectedColors.filter(
    (c) => c.name.trim().toLowerCase() !== color.name.trim().toLowerCase(),
  );
  const precomposeStarted = Date.now();
  const otherResults = await Promise.allSettled(
    otherColors.map(async (other) => {
      const otherPath = previewPathFor(other.name);
      const existing = await myPetObjectExists(otherPath);
      if (!existing) {
        const { png } = await renderCandidateOnPanel({
          productTypeId: productType.id,
          typeName: productType.name,
          panelId: args.candidate.panelId,
          colorName: other.name,
          colorHex: other.hex,
          artworkPath: editedPath,
        });
        await putMyPetObject(otherPath, png, "image/png");
      }
      const url = await signedMyPetUrl(otherPath);
      return [other.name, url] as const;
    }),
  );
  const previewUrlsByColor: Record<string, string> = { [color.name]: previewUrl };
  let precomposeFailures = 0;
  for (const r of otherResults) {
    if (r.status === "fulfilled") {
      previewUrlsByColor[r.value[0]] = r.value[1];
    } else {
      precomposeFailures += 1;
      console.warn("[my-pet] pre-composite failed:", (r.reason as Error)?.message || r.reason);
    }
  }
  console.log(
    `[my-pet] generate pre-compose renderId=${renderId.slice(0, 8)} chosen=${color.name} ` +
      `others=${otherColors.length} ok=${otherResults.length - precomposeFailures} ` +
      `failed=${precomposeFailures} durationMs=${Date.now() - precomposeStarted}`,
  );

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
    replicatePredictionId: result.providerRequestId,
    replicatePredictionUrl: result.providerRequestUrl,
  });

  // STAGING-95 bug — the pre-composite map `previewUrlsByColor` is built
  // ~150 lines above (and the `[my-pet] generate pre-compose ... ok=N`
  // log confirms the compositions succeed server-side), but this final
  // return literal was missing the field entirely. The HTTP handler in
  // routes/my-pet.ts just spreads `...result` back to the client, so when
  // the field is absent here the client receives no map and
  // state.previewUrlByColor stays `{}`. Every subsequent swatch click
  // then triggered a lazy /recomposite round-trip (~4s each) instead of
  // the designed <1ms client cache hit. TypeScript didn't catch the
  // regression because tsconfig doesn't currently flag missing non-
  // optional properties on object literals returned from an async
  // function declared with an explicit Promise<...> return type.
  console.log(
    `[my-pet] generate response renderId=${renderId.slice(0, 8)} ` +
      `chosenColor=${color.name} includedColours=[${Object.keys(previewUrlsByColor).join(",")}] ` +
      `mapSize=${Object.keys(previewUrlsByColor).length}`,
  );
  return { renderId, jobId, previewUrl, colorName: color.name, previewUrlsByColor };
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
  // UX 5: timing breakdown so a slow colour-swap smoke test tells us whether
  // the lag is compose, storage write, signing, or job update — not a guess.
  const started = Date.now();
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
  const afterLookup = Date.now();

  const previewPath = `my-pet/previews/${render.id}-${color.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.png`;

  // Bug A (post-staging-86): the composite for a given (renderId, colour) is
  // deterministic (same artwork + same mockup + same colour hex = identical
  // bytes), so a repeat colour swap in the modal was paying ~4-5s of pointless
  // compose+write every time. If the object already exists in storage, skip
  // the compose and just re-sign — cuts repeat swaps from the user-reported
  // 6s down to a Supabase metadata-list + createSignedUrl round-trip.
  const cacheHit = await myPetObjectExists(previewPath);
  if (cacheHit) {
    const previewUrl = await signedMyPetUrl(previewPath);
    const afterSign = Date.now();
    if (render.jobId) {
      await storage.updateGenerationJob(render.jobId, {
        designImageUrl: previewUrl,
        frameColor: color.name,
        designState: { ...designState, colorName: color.name, colorHex: color.hex },
      } as any);
    }
    const afterJobUpdate = Date.now();
    console.log(
      `[my-pet] recomposite CACHE HIT renderId=${render.id.slice(0, 8)} color=${color.name} ` +
        `lookup=${afterLookup - started}ms sign=${afterSign - afterLookup}ms ` +
        `jobUpdate=${afterJobUpdate - afterSign}ms total=${afterJobUpdate - started}ms`,
    );
    return { previewUrl, colorName: color.name };
  }

  const productType = await softstyleType();
  const { png } = await renderCandidateOnPanel({
    productTypeId: productType.id,
    typeName: productType.name,
    panelId: candidate.panelId,
    colorName: color.name,
    colorHex: color.hex,
    artworkPath: editedArtworkPath,
  });
  const afterCompose = Date.now();
  await putMyPetObject(previewPath, png, "image/png");
  const previewUrl = await signedMyPetUrl(previewPath);
  const afterStorage = Date.now();

  if (render.jobId) {
    await storage.updateGenerationJob(render.jobId, {
      designImageUrl: previewUrl,
      frameColor: color.name,
      designState: { ...designState, colorName: color.name, colorHex: color.hex },
    } as any);
  }
  const afterJobUpdate = Date.now();

  console.log(
    `[my-pet] recomposite FRESH renderId=${render.id.slice(0, 8)} color=${color.name} ` +
      `lookup=${afterLookup - started}ms compose=${afterCompose - afterLookup}ms ` +
      `storage=${afterStorage - afterCompose}ms jobUpdate=${afterJobUpdate - afterStorage}ms ` +
      `total=${afterJobUpdate - started}ms`,
  );

  return { previewUrl, colorName: color.name };
}

// ─────────────────────────────────────────────────────────────────────────
// Add to cart — the storefront calls the existing /api/storefront/resolve-
// design-variant endpoint itself (same one every other customizer flow uses
// for its shadow SKU), so this only has to hand back a job id and a FRESH
// signed preview URL (the one on the job row may have expired by now).
// ─────────────────────────────────────────────────────────────────────────

export async function getMyPetRenderForAddToCart(args: { shop: string; deviceKey: string; renderId: string }): Promise<{
  jobId: string;
  previewUrl: string;
  renderId: string;
  /** Human-readable line-item label (e.g. "My Pet — Vintage Engraving"). */
  designLabel: string;
}> {
  const [render] = await db.select().from(myPetRenders).where(eq(myPetRenders.id, args.renderId));
  if (!render || render.shopDomain !== args.shop || render.deviceKey !== args.deviceKey || !render.jobId) {
    throw new Error("Design not found");
  }
  const previewUrl = await signedMyPetUrl(render.previewPath);
  // Enrich the label with the candidate's art style for cart readability.
  // Fallback to a plain "My Pet" if the candidate was later unpromoted.
  let designLabel = "My Pet";
  try {
    const [candidate] = await db
      .select({ artStyle: designCandidates.artStyle })
      .from(designCandidates)
      .where(eq(designCandidates.id, render.candidateId));
    if (candidate?.artStyle) {
      // "vintage-engraving" → "Vintage Engraving"
      const pretty = String(candidate.artStyle)
        .split(/[-_]/)
        .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
        .join(" ");
      designLabel = `My Pet — ${pretty}`;
    }
  } catch { /* label is cosmetic — never block ATC on it */ }
  return { jobId: render.jobId, previewUrl, renderId: render.id, designLabel };
}

// ─────────────────────────────────────────────────────────────────────────
// UX 6 — resolve a render by id for same-device cross-session restore.
// Client keeps { renderId, jobId, candidateId } in localStorage (never the
// signed previewUrl — that expires in an hour); on return visit it calls this
// to get a freshly-signed URL, or a clean "not_found" if the render was swept
// or belongs to a different device_key (e.g. localStorage survived but the
// signed device key cookie/localStorage was cleared and re-minted).
// ─────────────────────────────────────────────────────────────────────────

export async function resolveMyPetRenderById(args: {
  shop: string;
  deviceKey: string;
  renderId: string;
}): Promise<{ renderId: string; jobId: string | null; previewUrl: string; colorName: string | null } | null> {
  const [render] = await db.select().from(myPetRenders).where(eq(myPetRenders.id, args.renderId));
  if (!render || render.shopDomain !== args.shop || render.deviceKey !== args.deviceKey) return null;
  const previewUrl = await signedMyPetUrl(render.previewPath);
  return { renderId: render.id, jobId: render.jobId, previewUrl, colorName: render.colorId };
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

  // Defensive one-shot audit (post-staging-92): hasEmailBonus is a
  // boolean-exists check in checkMyPetCap, and perListingLimit =
  // perListing + (bonus ? emailBonus : 0) — additive ONCE regardless of
  // row count — so a repeat consent=true submission from the same device
  // on the same listing cannot double-grant the +2 bonus. Still, we want
  // to (a) log clearly when a repeat happens so audit trail stays
  // searchable, (b) treat consent as false on repeat so we don't re-fire
  // the Shopify customer upsert / audit-row spam. The underlying mechanic
  // (one-shot bonus) is preserved either way; this just stops wasting an
  // API call and polluting myPetEmailCaptures with "consented 7 times".
  const requestedConsent = !!args.marketingConsent;
  let effectiveConsent = requestedConsent;
  if (requestedConsent && render.shopifyProductId) {
    const alreadyConsented = await hasEmailBonus(args.shop, args.deviceKey, render.shopifyProductId);
    if (alreadyConsented) {
      console.log(
        `[my-pet] email-save repeat consent ignored shop=${args.shop} ` +
          `device=${args.deviceKey.slice(0, 8)} product=${render.shopifyProductId} ` +
          `render=${render.id.slice(0, 8)} — bonus already applied, recording as consent=false`,
      );
      effectiveConsent = false;
    }
  }

  const token = generateToken();
  await db.insert(myPetEmailCaptures).values({
    shopDomain: args.shop,
    deviceKey: args.deviceKey,
    shopifyProductId: render.shopifyProductId,
    renderId: render.id,
    email,
    marketingConsent: effectiveConsent,
    token,
    expiresAt: new Date(Date.now() + EMAIL_PREVIEW_RETENTION_MS),
  });

  // Bug 2: the default signedMyPetUrl TTL is 1 hour — fine for URLs used
  // immediately in a page response, but this one gets baked verbatim into the
  // email HTML. An hour after send every email showed a broken image. Sign
  // for the full 30-day email-save retention window instead so the thumbnail
  // works for as long as the saved link itself is valid. Already-sent emails
  // with the old 1hr URL cannot be fixed retroactively (the URL is static
  // text in a delivered email) — this only fixes emails sent from here on.
  const previewUrl = await signedMyPetUrl(render.previewPath, EMAIL_PREVIEW_RETENTION_MS / 1000);
  const link = withTokenParam(args.pageUrl, token);
  await sendMyPetSaveEmail(email, previewUrl, link);
  // Shopify customer upsert is skipped on repeat consents (effectiveConsent
  // dropped to false above) so we don't spam Shopify Admin on every save-
  // modal submit — the merchant's customer-with-consent row was already
  // written the first time around.
  void createShopifyCustomerWithConsent(args.shop, email, effectiveConsent);
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

// ─────────────────────────────────────────────────────────────────────────
// Order audit (Issue 11)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Pull render ids out of a Shopify order's line-item properties.
 * The storefront ATC in appai-my-pet.js sets `_appai_my_pet_render_id` on every
 * custom cart line, so this is both the trigger ("is this order a My Pet sale?")
 * and the lookup key back to my_pet_renders.
 */
function extractMyPetLineProperties(order: any): Array<{
  renderId: string;
  lineItemId: string | null;
  mockupUrl: string | null;
  jobId: string | null;
}> {
  const out: Array<{ renderId: string; lineItemId: string | null; mockupUrl: string | null; jobId: string | null }> = [];
  const lineItems = Array.isArray(order?.line_items) ? order.line_items : [];
  for (const li of lineItems) {
    const props = Array.isArray(li?.properties) ? li.properties : [];
    let renderId: string | null = null;
    let mockupUrl: string | null = null;
    let jobId: string | null = null;
    for (const p of props) {
      const n = String(p?.name || p?.key || "");
      const v = p?.value == null ? "" : String(p.value);
      if (!v) continue;
      if (n === "_appai_my_pet_render_id") renderId = v;
      else if (n === "_mockup_url" && v.startsWith("https://")) mockupUrl = v;
      else if (n === "_appai_job_id") jobId = v;
    }
    if (renderId) out.push({ renderId, lineItemId: li?.id != null ? String(li.id) : null, mockupUrl, jobId });
  }
  return out;
}

/**
 * On a paid order containing My Pet line(s), write a Shopify order metafield
 * summarising every render on the order (preview URL, render id, Replicate
 * prediction id + URL, candidate, line-item id), and backfill
 * my_pet_renders.shopify_order_id / order_name for admin lookup.
 *
 * The metafield lives at ai_art_studio.my_pet_render_id as JSON. Shopify Admin
 * shows it in the standard metafield panel on the order page — no admin
 * extension required for v1. For richer inline display we'd add a Shopify
 * Admin UI extension later (separate deploy-worthy scope).
 */
export async function recordMyPetSaleForOrder(shop: string, order: any): Promise<{ matched: number; metafieldWritten: boolean }> {
  const entries = extractMyPetLineProperties(order);
  if (entries.length === 0) return { matched: 0, metafieldWritten: false };
  const orderGid = order?.admin_graphql_api_id ? String(order.admin_graphql_api_id) : null;
  const orderId = order?.id != null ? String(order.id) : null;
  const orderName = order?.name ? String(order.name) : null;

  // Enrich each line with DB rows (cheap: at most a handful of renders per order).
  const enriched: Array<{
    renderId: string;
    lineItemId: string | null;
    mockupUrl: string | null;
    jobId: string | null;
    replicatePredictionId: string | null;
    replicatePredictionUrl: string | null;
    candidateId: string | null;
    artStyle: string | null;
    species: string | null;
    petPhotoId: string | null;
  }> = [];
  for (const e of entries) {
    try {
      const [row] = await db.select().from(myPetRenders).where(and(eq(myPetRenders.shopDomain, shop), eq(myPetRenders.id, e.renderId)));
      if (!row) {
        enriched.push({ ...e, replicatePredictionId: null, replicatePredictionUrl: null, candidateId: null, artStyle: null, species: null, petPhotoId: null });
        continue;
      }
      let artStyle: string | null = null;
      let species: string | null = null;
      try {
        const [c] = await db
          .select({ artStyle: designCandidates.artStyle, species: designCandidates.species })
          .from(designCandidates)
          .where(eq(designCandidates.id, row.candidateId));
        artStyle = c?.artStyle ?? null;
        species = c?.species ?? null;
      } catch { /* enrichment only */ }
      enriched.push({
        ...e,
        replicatePredictionId: row.replicatePredictionId,
        replicatePredictionUrl: row.replicatePredictionUrl,
        candidateId: row.candidateId,
        artStyle,
        species,
        petPhotoId: row.petPhotoId,
      });

      // Backfill the reverse lookup on the render row.
      if (orderId) {
        try {
          await db
            .update(myPetRenders)
            .set({ shopifyOrderId: orderId, shopifyOrderName: orderName })
            .where(eq(myPetRenders.id, row.id));
        } catch (err) {
          console.warn("[my-pet] backfill order on render failed:", (err as Error)?.message);
        }
        if (row.petPhotoId) {
          void markMyPetPhotoPurchased(row.petPhotoId, orderId);
        }
      }
    } catch (err) {
      console.warn("[my-pet] recordMyPetSaleForOrder enrichment failed:", (err as Error)?.message);
    }
  }

  // Write the order metafield so merchants see the audit summary in Shopify.
  // Failure here is non-fatal (warning only) — the DB row was already updated.
  let metafieldWritten = false;
  if (orderGid) {
    try {
      const installation = await storage.getShopifyInstallationByShop(shop);
      const accessToken = installation?.accessToken;
      if (accessToken) {
        const payload = {
          version: 1,
          orderName: orderName || null,
          renders: enriched.map((e) => ({
            renderId: e.renderId,
            lineItemId: e.lineItemId,
            mockupUrl: e.mockupUrl,
            jobId: e.jobId,
            replicatePredictionId: e.replicatePredictionId,
            replicatePredictionUrl: e.replicatePredictionUrl,
            candidateId: e.candidateId,
            artStyle: e.artStyle,
            species: e.species,
          })),
        };
        const mutation = `mutation setMetafield($metafields: [MetafieldsSetInput!]!) {
          metafieldsSet(metafields: $metafields) { userErrors { field message } }
        }`;
        const res = await fetch(`https://${shop}/admin/api/2025-10/graphql.json`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": accessToken },
          body: JSON.stringify({
            query: mutation,
            variables: {
              metafields: [{
                ownerId: orderGid,
                namespace: "ai_art_studio",
                key: "my_pet_render_id",
                type: "json",
                value: JSON.stringify(payload),
              }],
            },
          }),
        });
        const json: any = await res.json().catch(() => ({}));
        const userErrors = json?.data?.metafieldsSet?.userErrors || [];
        if (userErrors.length) {
          console.warn(`[my-pet] metafieldsSet userErrors for order ${orderName || orderId}:`, JSON.stringify(userErrors));
        } else {
          metafieldWritten = true;
        }
      } else {
        console.warn(`[my-pet] no OAuth token for ${shop} — order metafield not written`);
      }
    } catch (err) {
      console.warn("[my-pet] metafieldsSet failed:", (err as Error)?.message);
    }
  }

  console.log(
    `[my-pet] recorded sale shop=${shop} order=${orderName || orderId} ` +
      `lines=${enriched.length} metafield=${metafieldWritten ? "written" : "skipped"}`,
  );
  return { matched: enriched.length, metafieldWritten };
}

/**
 * Admin audit lookup: given a Shopify order id or order name (e.g. "#1234"),
 * return every My Pet render tied to that order with its preview URL (freshly
 * signed), Replicate prediction URL, candidate style, and Supabase paths.
 * Backs the "Order lookup" card in the My Pet settings admin page.
 */
export async function getMyPetOrderDetails(args: { shop: string; orderId?: string | null; orderName?: string | null }): Promise<{
  found: boolean;
  orderId: string | null;
  orderName: string | null;
  renders: Array<{
    renderId: string;
    createdAt: Date;
    previewUrl: string | null;
    previewPath: string;
    candidateId: string;
    artStyle: string | null;
    species: string | null;
    colorName: string | null;
    sizeId: string | null;
    replicatePredictionId: string | null;
    replicatePredictionUrl: string | null;
    petPhotoId: string | null;
    jobId: string | null;
    durationMs: number | null;
    estimatedCostUsd: string | null;
  }>;
}> {
  const rows = args.orderId
    ? await db.select().from(myPetRenders).where(and(eq(myPetRenders.shopDomain, args.shop), eq(myPetRenders.shopifyOrderId, args.orderId)))
    : args.orderName
      ? await db.select().from(myPetRenders).where(and(eq(myPetRenders.shopDomain, args.shop), eq(myPetRenders.shopifyOrderName, args.orderName)))
      : [];
  if (rows.length === 0) return { found: false, orderId: args.orderId ?? null, orderName: args.orderName ?? null, renders: [] };

  const renders = await Promise.all(
    rows.map(async (row) => {
      let previewUrl: string | null = null;
      try { previewUrl = await signedMyPetUrl(row.previewPath); } catch { previewUrl = null; }
      let artStyle: string | null = null;
      let species: string | null = null;
      try {
        const [c] = await db
          .select({ artStyle: designCandidates.artStyle, species: designCandidates.species })
          .from(designCandidates)
          .where(eq(designCandidates.id, row.candidateId));
        artStyle = c?.artStyle ?? null;
        species = c?.species ?? null;
      } catch { /* enrichment only */ }
      return {
        renderId: row.id,
        createdAt: row.createdAt,
        previewUrl,
        previewPath: row.previewPath,
        candidateId: row.candidateId,
        artStyle,
        species,
        colorName: row.colorId,
        sizeId: row.sizeId,
        replicatePredictionId: row.replicatePredictionId,
        replicatePredictionUrl: row.replicatePredictionUrl,
        petPhotoId: row.petPhotoId,
        jobId: row.jobId,
        durationMs: row.durationMs,
        estimatedCostUsd: row.estimatedCostUsd,
      };
    }),
  );
  return {
    found: true,
    orderId: rows[0].shopifyOrderId,
    orderName: rows[0].shopifyOrderName,
    renders,
  };
}
