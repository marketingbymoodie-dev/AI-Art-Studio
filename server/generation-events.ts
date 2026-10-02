/**
 * Generation telemetry (generation_events). Best-effort: never throws into a
 * generation. Rows carry identifiers, provider/model/cost and outcome only —
 * no prompts, punchlines, pet names, reference URLs, emails or credentials.
 */
import type { InsertGenerationEvent } from "@shared/schema";
import type { GenerationPlan } from "./generation-providers";
import { ProviderCredentialUnavailableError } from "./generation-providers";
import type { GenerationMeta } from "./replit_integrations/image/client";
import { GptImage2OpaqueOutputError } from "./replit_integrations/image/client";
import { ProviderRequestError } from "./openai-image-client";

export type GenerationEventContext = {
  kind: "image" | "concepts";
  route: string;
  jobId?: string | null;
  merchantId?: string | null;
  shopDomain?: string | null;
  experienceProfile?: string | null;
  stylePack?: string | null;
  styleSlug?: string | null;
  productFamily?: string | null;
  visualSystem?: string | null;
  conceptFramework?: string | null;
  plan?: GenerationPlan | null;
  /** Legacy (Replicate) model label when no meta is returned. */
  legacyModel?: string | null;
  legacyQuality?: string | null;
  endUserHash?: string | null;
};

export type GenerationOutcome = {
  success: boolean;
  durationMs: number;
  meta?: GenerationMeta | null;
  error?: unknown;
};

export function generationErrorCategory(err: unknown): string {
  if (err instanceof ProviderCredentialUnavailableError) return "credential_missing";
  if (err instanceof ProviderRequestError) return err.category;
  if (err instanceof GptImage2OpaqueOutputError) return "transparency_failed";
  const msg = String((err as Error)?.message ?? err ?? "");
  if (/timed out/i.test(msg)) return "timeout";
  if (/replicate/i.test(msg)) return "provider_replicate";
  return "unknown";
}

/**
 * Message stored on the job and shown to the customer. Direct-provider
 * generations never surface provider text; legacy generations keep their
 * existing message unchanged.
 */
export function customerSafeGenerationError(err: unknown, plan?: GenerationPlan | null): string {
  if (err instanceof ProviderCredentialUnavailableError) return err.message;
  const legacy = !plan || plan.imagePath === "legacy";
  if (legacy) return (err as Error)?.message ?? "Unknown generation error";
  const category = generationErrorCategory(err);
  if (category === "moderation") return "This idea couldn't be illustrated. Please try a different story or photo.";
  if (category === "reference_unavailable") return "We couldn't read your photo. Please upload it again.";
  if (category === "rate_limit") return "We're creating a lot of artwork right now. Please try again in a minute.";
  return "We couldn't create this artwork right now. Please try again.";
}

export function buildGenerationEventRow(ctx: GenerationEventContext, outcome: GenerationOutcome): InsertGenerationEvent {
  const meta = outcome.meta ?? null;
  const direct = ctx.plan && ctx.plan.imagePath !== "legacy" ? ctx.plan.imagePath : null;
  const legacyProvider = ctx.kind === "concepts" ? "anthropic" : "replicate";
  return {
    kind: ctx.kind,
    route: ctx.route,
    jobId: ctx.jobId ?? null,
    merchantId: ctx.merchantId ?? null,
    shopDomain: ctx.shopDomain ?? null,
    experienceProfile: ctx.experienceProfile ?? null,
    stylePack: ctx.stylePack ?? null,
    styleSlug: ctx.styleSlug ?? null,
    productFamily: ctx.productFamily ?? null,
    visualSystem: ctx.visualSystem ?? null,
    conceptFramework: ctx.conceptFramework ?? null,
    provider: meta?.provider ?? (direct ? direct.credential.provider : legacyProvider),
    credentialScope: meta?.credentialScope ?? direct?.credential.scope ?? (ctx.kind === "image" ? "shared" : null),
    credentialRef: meta?.credentialRefId ?? direct?.credential.id ?? (ctx.kind === "image" ? "replicate:shared" : null),
    model: meta?.model ?? direct?.renderer.model ?? ctx.legacyModel ?? null,
    quality:
      meta?.quality ??
      (direct ? (direct.kind === "direct-openai" ? direct.renderer.quality : direct.imageSize) : null) ??
      ctx.legacyQuality ??
      null,
    size: meta?.size ?? null,
    transparent: meta?.transparent ?? null,
    transparentFraction: meta?.transparentFraction != null ? meta.transparentFraction.toFixed(4) : null,
    attempts: meta?.attempts ?? null,
    durationMs: Math.round(outcome.durationMs),
    usage: meta?.usage ?? null,
    estimatedCostUsd: meta?.estimatedCostUsd != null ? meta.estimatedCostUsd.toFixed(6) : null,
    providerRequestId: meta?.providerRequestId ?? null,
    success: outcome.success,
    errorCategory: outcome.success ? null : generationErrorCategory(outcome.error),
    endUserHash: ctx.endUserHash ?? null,
  };
}

/** Times `run`, records the event (success or failure) and returns/rethrows unchanged. */
export async function withGenerationEvent<T extends { data?: string; meta?: GenerationMeta }>(
  ctx: GenerationEventContext,
  run: () => Promise<T>,
): Promise<T> {
  const started = Date.now();
  try {
    const result = await run();
    void recordGenerationEvent(ctx, {
      success: !!result.data,
      durationMs: Date.now() - started,
      meta: result.meta,
      error: result.data ? undefined : new Error("no image data"),
    });
    return result;
  } catch (err) {
    void recordGenerationEvent(ctx, { success: false, durationMs: Date.now() - started, error: err });
    throw err;
  }
}

export async function recordGenerationEvent(ctx: GenerationEventContext, outcome: GenerationOutcome): Promise<void> {
  try {
    const row = buildGenerationEventRow(ctx, outcome);
    const [{ db }, { generationEvents }] = await Promise.all([import("./db"), import("@shared/schema")]);
    await db.insert(generationEvents).values(row);
  } catch (err) {
    console.warn("[generation-events] failed to write:", (err as Error)?.message);
  }
}
