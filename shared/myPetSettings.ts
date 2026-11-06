/**
 * My Pet — storefront pet-swap on a published Petposterous catalogue design.
 *
 * One base prompt for every design, editable on the admin settings page with
 * no redeploy. Per-style tweak lines are blank by default and only appended
 * when that design's own artStyle matches. The print-rule suffix is fixed —
 * shown read-only on the settings page — and always appended last.
 *
 * Style ids must match `PRINT_PATHS` in server/flywheel-print-file.ts. Kept
 * as a separate literal list here (not imported) so this module stays usable
 * from the client bundle without pulling in server-only (sharp/Replicate) code.
 */

export const MY_PET_ART_STYLES = [
  "woodcut",
  "folk-graphic",
  "bold-type",
  "pen-ink",
  "vintage-engraving",
  "retro-character",
] as const;
export type MyPetArtStyle = (typeof MY_PET_ART_STYLES)[number];

export function isMyPetArtStyle(value: unknown): value is MyPetArtStyle {
  return MY_PET_ART_STYLES.includes(String(value) as MyPetArtStyle);
}

export const MY_PET_DEFAULT_BASE_PROMPT =
  "Replace the animal in this design with the pet in the photo, matching its markings and features. " +
  "Keep the art style, composition, pose, props and lettering exactly as they are.";

/** Always appended last. Read-only on the settings page — not stored per shop. */
export const MY_PET_LOCKED_PRINT_RULES =
  "Transparent background. No outline or stroke around text. No added text or watermarks. " +
  "Artwork centred with nothing cropped.";

export type MyPetCaps = {
  /** Generations per shopper on one product listing (first go plus retries). */
  perListing: number;
  /** Generations per shopper per day, across the whole store. */
  perDay: number;
  /** Extra attempts on that product once the shopper gives an email. */
  emailBonus: number;
};

export const MY_PET_DEFAULT_CAPS: MyPetCaps = {
  perListing: 2,
  perDay: 20,
  emailBonus: 2,
};

export type MyPetStyleTweaks = Partial<Record<MyPetArtStyle, string>>;

/**
 * Per-call Replicate parameters for the pet-swap image edit, surfaced on the
 * admin settings page so we can tune cost/quality without a redeploy.
 *
 * Defaults are the measured ones for Sunburst via Replicate: medium quality,
 * 1024×1536 PNG transparent at compression 90, moderation low — roughly $0.05
 * and 20–25s per call. Changing size/quality moves both numbers. See
 * server/my-pet.ts for the model-slug binding and provider plumbing.
 */
export type MyPetRenderParams = {
  quality: "low" | "medium" | "high";
  background: "transparent" | "opaque";
  /** Supported size strings: "1024x1024" | "1024x1536" | "1536x1024" | "auto". */
  size: string;
  outputFormat: "png" | "jpeg" | "webp";
  /** 0–100. Only meaningful for png/webp. */
  outputCompression: number;
  moderation: "low" | "auto";
};

export const MY_PET_DEFAULT_RENDER_PARAMS: MyPetRenderParams = {
  quality: "medium",
  background: "transparent",
  size: "1024x1536",
  outputFormat: "png",
  outputCompression: 90,
  moderation: "low",
};

/**
 * Flat per-call cost used to populate `my_pet_renders.estimated_cost_usd` and
 * `generation_events.estimated_cost_usd` for Sunburst via Replicate. Replicate's
 * API does not return per-prediction token usage, so we record the measured
 * number. Update if you change `MY_PET_DEFAULT_RENDER_PARAMS` and re-measure.
 */
export const MY_PET_SUNBURST_ESTIMATED_COST_USD = 0.05;

export type MyPetSettings = {
  shopDomain: string;
  basePrompt: string;
  styleTweaks: MyPetStyleTweaks;
  caps: MyPetCaps;
  renderParams: MyPetRenderParams;
};

export function defaultMyPetSettings(shopDomain: string): MyPetSettings {
  return {
    shopDomain,
    basePrompt: MY_PET_DEFAULT_BASE_PROMPT,
    styleTweaks: {},
    caps: { ...MY_PET_DEFAULT_CAPS },
    renderParams: { ...MY_PET_DEFAULT_RENDER_PARAMS },
  };
}

function clampCapNumber(value: unknown, fallback: number): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(500, Math.max(0, n));
}

/** Clamp/sanitize a caps payload from the settings page. Unknown/invalid fields fall back to current values. */
export function sanitizeMyPetCaps(raw: unknown, fallback: MyPetCaps): MyPetCaps {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    perListing: clampCapNumber(r.perListing, fallback.perListing),
    perDay: clampCapNumber(r.perDay, fallback.perDay),
    emailBonus: clampCapNumber(r.emailBonus, fallback.emailBonus),
  };
}

export function sanitizeMyPetStyleTweaks(raw: unknown): MyPetStyleTweaks {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out: MyPetStyleTweaks = {};
  for (const style of MY_PET_ART_STYLES) {
    const v = r[style];
    if (typeof v === "string" && v.trim()) out[style] = v.trim().slice(0, 600);
  }
  return out;
}

const RENDER_QUALITIES: MyPetRenderParams["quality"][] = ["low", "medium", "high"];
const RENDER_BACKGROUNDS: MyPetRenderParams["background"][] = ["transparent", "opaque"];
const RENDER_FORMATS: MyPetRenderParams["outputFormat"][] = ["png", "jpeg", "webp"];
const RENDER_MODERATIONS: MyPetRenderParams["moderation"][] = ["low", "auto"];
const RENDER_SIZES_ALLOWED = new Set(["1024x1024", "1024x1536", "1536x1024", "auto"]);

/** Clamp/sanitize a renderParams payload. Unknown/invalid fields fall back to current values. */
export function sanitizeMyPetRenderParams(raw: unknown, fallback: MyPetRenderParams): MyPetRenderParams {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const pickEnum = <T extends string>(value: unknown, allowed: readonly T[], current: T): T =>
    typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : current;
  const sizeRaw = typeof r.size === "string" ? r.size.trim() : "";
  const size = RENDER_SIZES_ALLOWED.has(sizeRaw) ? sizeRaw : fallback.size;
  const compressionNum = Math.round(Number(r.outputCompression));
  const outputCompression = Number.isFinite(compressionNum)
    ? Math.min(100, Math.max(0, compressionNum))
    : fallback.outputCompression;
  return {
    quality: pickEnum(r.quality, RENDER_QUALITIES, fallback.quality),
    background: pickEnum(r.background, RENDER_BACKGROUNDS, fallback.background),
    size,
    outputFormat: pickEnum(r.outputFormat, RENDER_FORMATS, fallback.outputFormat),
    outputCompression,
    moderation: pickEnum(r.moderation, RENDER_MODERATIONS, fallback.moderation),
  };
}

export type CandidateDetailsForPrompt = {
  species: string;
  artStyle: string;
  /** The design's exact wording/lettering, if any. Empty = no punchline. */
  punchline: string;
};

/**
 * Assemble the My Pet edit prompt for one design: base, then that design's
 * style tweak (if any and if it is non-blank), then the design's own stored
 * details, then the locked print rules last. Image 1 is named as the
 * finished design, Image 2 as the shopper's pet photo — this is an image
 * edit of two inputs, not a from-scratch generation.
 */
export function buildMyPetPrompt(
  settings: Pick<MyPetSettings, "basePrompt" | "styleTweaks">,
  candidate: CandidateDetailsForPrompt,
): string {
  const lines: string[] = [];
  lines.push("Image 1 is the finished design. Image 2 is the shopper's pet.");
  const base = (settings.basePrompt || "").trim() || MY_PET_DEFAULT_BASE_PROMPT;
  lines.push(base);
  const tweak = isMyPetArtStyle(candidate.artStyle) ? settings.styleTweaks?.[candidate.artStyle] : undefined;
  if (tweak && tweak.trim()) lines.push(tweak.trim());
  const details: string[] = [];
  if (candidate.species?.trim()) details.push(`Species: ${candidate.species.trim()}.`);
  if (candidate.artStyle?.trim()) details.push(`Style: ${candidate.artStyle.trim()}.`);
  if (candidate.punchline?.trim()) details.push(`Wording stays exactly: "${candidate.punchline.trim()}".`);
  if (details.length) lines.push(details.join(" "));
  lines.push(MY_PET_LOCKED_PRINT_RULES);
  return lines.join(" ");
}

/**
 * Shops where the My Pet settings page is visible. Petposterous only today;
 * opening it to a merchant later is adding a domain here (or
 * MY_PET_SETTINGS_SHOP_DOMAINS), not a rewrite.
 */
// Staging store that Petposterous catalogue products publish into (matches
// STAGING_SHOP in server/catalogue-{bulk-import,publish,colour-order}.ts and
// STAGING_STORE_HANDLE in shared/themeEditorUrl.ts).
const BUILTIN_MY_PET_SETTINGS_SHOPS = ["ai-art-studio-staging.myshopify.com"] as const;

export function collectMyPetSettingsShopDomains(env: Record<string, string | undefined> = process.env): Set<string> {
  const domains = new Set<string>(BUILTIN_MY_PET_SETTINGS_SHOPS);
  for (const part of String(env.MY_PET_SETTINGS_SHOP_DOMAINS || "").split(",")) {
    const t = part.trim().toLowerCase();
    if (t.endsWith(".myshopify.com")) domains.add(t);
  }
  return domains;
}

export function isMyPetSettingsShop(
  shopDomain: string | null | undefined,
  env: Record<string, string | undefined> = process.env,
): boolean {
  const shop = String(shopDomain || "").trim().toLowerCase();
  if (!shop) return false;
  return collectMyPetSettingsShopDomains(env).has(shop);
}

export type MyPetCapCheckInput = {
  /** Generations already used by this shopper on this product (cookie-scoped). */
  perListingCount: number;
  /** Generations already used by this shopper today, across the store (cookie-scoped). */
  dailyCount: number;
  /** True once this shopper gave an email on this product. */
  hasEmailBonus: boolean;
  caps: MyPetCaps;
};

export type MyPetCapResult =
  | { allowed: true }
  | { allowed: false; reason: "listing_cap" | "daily_cap"; message: string };

/** Friendly, never an error state — shown in place of the generate button. */
export function evaluateMyPetCap(input: MyPetCapCheckInput): MyPetCapResult {
  const listingLimit = input.caps.perListing + (input.hasEmailBonus ? input.caps.emailBonus : 0);
  if (input.dailyCount >= input.caps.perDay) {
    return {
      allowed: false,
      reason: "daily_cap",
      message: "You've used up today's My Pet tries — come back tomorrow for more!",
    };
  }
  if (input.perListingCount >= listingLimit) {
    return {
      allowed: false,
      reason: "listing_cap",
      message: input.hasEmailBonus
        ? "You've used all your My Pet tries on this design."
        : "You've used your My Pet tries on this design — give us your email for two more.",
    };
  }
  return { allowed: true };
}
