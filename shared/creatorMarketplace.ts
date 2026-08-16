/**
 * Creator Marketplace / Creator Beta — shared constants and helpers.
 * Feature is env-gated via CREATOR_MARKETPLACE_ENABLED (see server/creator-config.ts).
 */

/** Platform accounting cost per completed AI generation (USD). Admin-overridable via platform_config. */
export const DEFAULT_AI_GENERATION_COST_USD = 0.05;

export const PLATFORM_CONFIG_KEYS = {
  AI_GENERATION_COST_USD: "AI_GENERATION_COST_USD",
  CREATOR_TRANSACTION_FEE_PCT: "CREATOR_TRANSACTION_FEE_PCT",
  CREATOR_TRANSACTION_FEE_FIXED_CENTS: "CREATOR_TRANSACTION_FEE_FIXED_CENTS",
  CREATOR_STYLE_ASSIGNMENT_BACKFILL_AT: "CREATOR_STYLE_ASSIGNMENT_BACKFILL_AT",
  LANDING_CONTENT: "LANDING_CONTENT",
  TERMS_CONTENT: "TERMS_CONTENT",
  CREATOR_MONTHLY_REPORT_SENT: "CREATOR_MONTHLY_REPORT_SENT",
} as const;

export const CREATOR_APPLY_TRACKS = ["creator", "shopify"] as const;
export type CreatorApplyTrack = (typeof CREATOR_APPLY_TRACKS)[number];

export const CREATOR_PAYOUT_METHODS = ["paypal", "bank", "stripe"] as const;
export type CreatorPayoutMethod = (typeof CREATOR_PAYOUT_METHODS)[number];

/** Default Shopify Payments-style fee (percent of charged amount). */
export const DEFAULT_CREATOR_TRANSACTION_FEE_PCT = 2.9;

/** Default fixed fee per order (cents), e.g. Shopify Payments $0.30. */
export const DEFAULT_CREATOR_TRANSACTION_FEE_FIXED_CENTS = 30;

/** Attribution event types (Phase 4). */
export const CREATOR_EVENT_TYPES = [
  "page_view",
  "customizer_open",
  "generation",
  "atc",
  "checkout_started",
] as const;
export type CreatorEventType = (typeof CREATOR_EVENT_TYPES)[number];

/** Default free gens each unique customer gets on a creator storefront. */
export const DEFAULT_CREATOR_FREE_GENS_PER_CUSTOMER = 2;

/** Default monthly generation budget for a new creator beta. */
export const DEFAULT_CREATOR_MONTHLY_GENERATION_ALLOWANCE = 250;

export const CREATOR_STATUSES = [
  "application",
  "under_review",
  "accepted",
  "rejected",
  "waitlisted",
  "onboarding",
  "active_beta",
  "beta_completed",
  "partner",
  "paused",
  "suspended",
  "archived",
] as const;
export type CreatorStatus = (typeof CREATOR_STATUSES)[number];

export const CREATOR_APPLICATION_STATUSES = [
  "submitted",
  "under_review",
  "accepted",
  "rejected",
  "waitlisted",
] as const;
export type CreatorApplicationStatus = (typeof CREATOR_APPLICATION_STATUSES)[number];

/** Creator statuses that mean the application was accepted and should not stay waitlisted. */
export const CREATOR_STATUSES_THAT_ACCEPT_APPLICATION = [
  "accepted",
  "onboarding",
  "active_beta",
  "beta_completed",
  "partner",
  "paused",
  "suspended",
  "archived",
] as const;

/** Map a live creator status back onto the application queue. */
export function applicationStatusForCreatorStatus(
  status: string | null | undefined,
): CreatorApplicationStatus | null {
  const s = String(status || "");
  if ((CREATOR_STATUSES_THAT_ACCEPT_APPLICATION as readonly string[]).includes(s)) {
    return "accepted";
  }
  if (s === "rejected") return "rejected";
  if (s === "waitlisted") return "waitlisted";
  if (s === "under_review" || s === "application") return "under_review";
  return null;
}

export const CREATOR_TYPES = ["creator", "shopify_merchant"] as const;
export type CreatorType = (typeof CREATOR_TYPES)[number];

export const CREATOR_SHARE_BASES = ["product_profit", "net_contribution"] as const;
export type CreatorShareBasis = (typeof CREATOR_SHARE_BASES)[number];

/** Statuses allowed to sign into Creator Portal (Phase 6). */
export const CREATOR_PORTAL_LOGIN_STATUSES = [
  "onboarding",
  "active_beta",
  "partner",
  "paused",
  "beta_completed",
] as const;
export type CreatorPortalLoginStatus = (typeof CREATOR_PORTAL_LOGIN_STATUSES)[number];

export function canCreatorAccessPortal(status: string | null | undefined): boolean {
  return (CREATOR_PORTAL_LOGIN_STATUSES as readonly string[]).includes(String(status || ""));
}

/** Rank periods (Phase 7). */
export const CREATOR_RANK_PERIOD_TYPES = ["daily", "weekly", "monthly", "lifetime"] as const;
export type CreatorRankPeriodType = (typeof CREATOR_RANK_PERIOD_TYPES)[number];

/** V1 leaderboard metric — Net Creator Contribution (cents). */
export const CREATOR_RANK_METRIC_NET_CONTRIBUTION = "net_contribution";

/** Who may be assigned a style on the creator platform (not merchant create path). */
export const CREATOR_STYLE_SCOPES = ["merchant", "global", "custom"] as const;
export type CreatorStyleScope = (typeof CREATOR_STYLE_SCOPES)[number];
export const CREATOR_ASSIGNABLE_STYLE_SCOPES = ["global", "custom"] as const;

export function isAssignableCreatorScope(scope: string | null | undefined): boolean {
  return (CREATOR_ASSIGNABLE_STYLE_SCOPES as readonly string[]).includes(String(scope || ""));
}

/** Customer-facing label — hide the internal Graphics twin suffix. Keep "(custom)". */
export function displayCreatorStyleName(name: string | null | undefined): string {
  return String(name || "").replace(/\s*\(graphics\)\s*$/i, "").trim();
}

/** Strip " (Graphics)" / " (custom)" so apparel + graphics twins collapse in the assign catalog. */
export function canonicalCreatorStyleName(name: string | null | undefined): string {
  return String(name || "")
    .replace(/\s*\((?:graphics|custom)\)\s*$/i, "")
    .trim()
    .toLowerCase();
}

export function dedupeCreatorCatalogStyles<
  T extends { id?: number | string; name: string; category?: string | null; creatorScope?: string | null },
>(styles: T[]): T[] {
  const rank = (s: T) => {
    const isGraphicsTwin = /\(graphics\)\s*$/i.test(s.name) || s.category === "graphics";
    if ((s.creatorScope || "") === "custom") return 0;
    if (!isGraphicsTwin) return 1;
    return 2;
  };
  const best = new Map<string, T>();
  for (const s of styles) {
    const key = canonicalCreatorStyleName(s.name);
    if (!key) continue;
    const prev = best.get(key);
    if (!prev || rank(s) < rank(prev)) best.set(key, s);
  }
  return styles.filter((s) => best.get(canonicalCreatorStyleName(s.name)) === s);
}

/** Assignment-row visibility. No row means the style is not in any creator list. */
export function computeStyleVisibility(input: {
  enabled: boolean;
  available: boolean;
  isActive: boolean;
}): {
  enabled: boolean;
  available: boolean;
  currentlyAvailable: boolean;
  storefrontVisible: boolean;
  portalUnavailable: boolean;
} {
  const enabled = !!input.enabled;
  const available = !!input.available;
  const currentlyAvailable = available && !!input.isActive;
  return {
    enabled,
    available,
    currentlyAvailable,
    storefrontVisible: currentlyAvailable && enabled,
    portalUnavailable: !currentlyAvailable,
  };
}

/** Admin lifecycle actions (Phase 9 Partner Program). */
export const CREATOR_BETA_ACTIONS = [
  "end_beta",
  "extend_beta",
  "promote_partner",
  "pause",
  "archive",
  "reactivate_beta",
] as const;
export type CreatorBetaAction = (typeof CREATOR_BETA_ACTIONS)[number];

/** Email template keys — logged always; auto-send only when globally enabled + per-creator toggle. */
export const CREATOR_EMAIL_TEMPLATE_KEYS = [
  "beta_ending_7d",
  "beta_ending_3d",
  "beta_ending_1d",
  "beta_ended",
  "partner_welcome",
  "application_accepted",
] as const;
export type CreatorEmailTemplateKey = (typeof CREATOR_EMAIL_TEMPLATE_KEYS)[number];

export const CREATOR_PAYOUT_STATUSES = ["pending", "paid", "cancelled"] as const;
export type CreatorPayoutStatus = (typeof CREATOR_PAYOUT_STATUSES)[number];

/** Default beta length when starting active_beta without an end date. */
export const DEFAULT_CREATOR_BETA_DAYS = 30;

export type CreatorRankRowInput = { creatorId: string; valueCents: number };

export type CreatorRankComputed = {
  creatorId: string;
  valueCents: number;
  rank: number;
  ofCount: number;
  percentile: number;
  sharePct: number;
  title: string;
};

/**
 * Dense rank (ties share rank; next rank skips).
 * `percentile` is stored as “top X%” (rank 1 of 100 → 1; rank 7 of 43 → ~16.3).
 * Share = value / total network value.
 */
export function computeCreatorRanks(
  rows: CreatorRankRowInput[],
  periodType: CreatorRankPeriodType,
): CreatorRankComputed[] {
  const sorted = [...rows].sort((a, b) => b.valueCents - a.valueCents);
  const ofCount = sorted.length;
  if (ofCount === 0) return [];

  const total = sorted.reduce((s, r) => s + Math.max(0, r.valueCents), 0);
  const out: CreatorRankComputed[] = [];
  let i = 0;
  while (i < sorted.length) {
    const valueCents = sorted[i]!.valueCents;
    let j = i;
    while (j < sorted.length && sorted[j]!.valueCents === valueCents) j++;
    const rank = i + 1;
    const percentile =
      ofCount <= 1 ? 100 : Math.max(0.0001, Math.min(100, (rank / ofCount) * 100));
    const sharePct = total > 0 ? (Math.max(0, valueCents) / total) * 100 : 0;
    for (let k = i; k < j; k++) {
      const row = sorted[k]!;
      out.push({
        creatorId: row.creatorId,
        valueCents: row.valueCents,
        rank,
        ofCount,
        percentile: +percentile.toFixed(4),
        sharePct: +sharePct.toFixed(4),
        title: titleForRank(rank, ofCount, periodType),
      });
    }
    i = j;
  }
  return out;
}

export function titleForRank(
  rank: number,
  ofCount: number,
  periodType: CreatorRankPeriodType,
): string {
  if (ofCount <= 0) return "Unranked";
  if (rank === 1) {
    if (periodType === "lifetime") return "Lifetime Leader";
    if (periodType === "daily") return "Daily Top Creator";
    if (periodType === "weekly") return "Weekly Top Creator";
    return "Monthly Top Creator";
  }
  if (rank <= 3) return "Top 3 Creator";
  const topPct = ofCount <= 1 ? 100 : (rank / ofCount) * 100;
  if (topPct <= 10) return "Top 10%";
  if (topPct <= 25) return "Top Quartile";
  return "Active Creator";
}

/** ISO week key YYYY-Www (UTC). */
export function isoWeekPeriodKey(d = new Date()): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  // Thursday in current week decides the year.
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

export function monthPeriodKey(d = new Date()): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function dayPeriodKey(d = new Date()): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** Pure P&L helpers (Phase 5) — unit-tested; no DB. */
export type CreatorOrderPnlInput = {
  grossCents: number;
  discountCents: number;
  fulfilmentCostCents: number;
  transactionFeeCents: number;
  aiGenCostCents: number;
  refundCents?: number;
  shareBasis: CreatorShareBasis;
  revenueShareCreatorPct: number;
  revenueShareAasPct: number;
};

export type CreatorOrderPnlResult = {
  productProfitCents: number;
  netContributionCents: number;
  creatorShareCents: number;
  aasShareCents: number;
};

export function computeTransactionFeeCents(params: {
  amountCents: number;
  feePct?: number;
  feeFixedCents?: number;
}): number {
  const amount = Math.max(0, Math.round(params.amountCents || 0));
  const pct =
    params.feePct != null && Number.isFinite(params.feePct)
      ? Math.max(0, params.feePct)
      : DEFAULT_CREATOR_TRANSACTION_FEE_PCT;
  const fixed =
    params.feeFixedCents != null && Number.isFinite(params.feeFixedCents)
      ? Math.max(0, Math.round(params.feeFixedCents))
      : DEFAULT_CREATOR_TRANSACTION_FEE_FIXED_CENTS;
  if (amount <= 0) return 0;
  return Math.round((amount * pct) / 100) + fixed;
}

/**
 * Product Profit = gross − discounts − fulfilment/COGS − txn fees − refunds.
 * Net Creator Contribution = Product Profit − AI generation costs.
 * Shares apply to the chosen basis (`product_profit` | `net_contribution`).
 */
export function computeCreatorOrderPnl(input: CreatorOrderPnlInput): CreatorOrderPnlResult {
  const gross = Math.max(0, Math.round(input.grossCents || 0));
  const discount = Math.max(0, Math.round(input.discountCents || 0));
  const fulfilment = Math.max(0, Math.round(input.fulfilmentCostCents || 0));
  const fee = Math.max(0, Math.round(input.transactionFeeCents || 0));
  const ai = Math.max(0, Math.round(input.aiGenCostCents || 0));
  const refund = Math.max(0, Math.round(input.refundCents || 0));

  const productProfitCents = gross - discount - fulfilment - fee - refund;
  const netContributionCents = productProfitCents - ai;

  const creatorPct = Math.min(
    100,
    Math.max(0, Math.round(input.revenueShareCreatorPct || 0)),
  );
  const aasPct = Math.min(
    100,
    Math.max(0, Math.round(input.revenueShareAasPct || 0)),
  );
  const basis =
    input.shareBasis === "product_profit" ? productProfitCents : netContributionCents;
  const creatorShareCents = Math.round((basis * creatorPct) / 100);
  const aasShareCents =
    aasPct > 0 && creatorPct + aasPct === 100
      ? basis - creatorShareCents
      : Math.round((basis * aasPct) / 100);

  return {
    productProfitCents,
    netContributionCents,
    creatorShareCents,
    aasShareCents,
  };
}

export const SOCIAL_PLATFORMS = [
  "instagram",
  "tiktok",
  "youtube",
  "x",
  "facebook",
  "twitch",
  "other",
] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

export const MAX_CREATOR_SOCIALS = 4;

export type CreatorSocialLink = {
  platform: SocialPlatform;
  username: string;
  url: string | null;
};

export const CREATOR_SOCIAL_HANDLE_INVALID_MESSAGE =
  "Enter a social handle without @ — letters, numbers, periods, underscores, or hyphens only.";

/** Strip leading @ / whitespace while the user is typing (`@@name` → `name`). */
export function stripLeadingAtSigns(raw: unknown): string {
  return String(raw ?? "").replace(/^[\s@]+/, "");
}

export function isSocialPlatform(raw: unknown): raw is SocialPlatform {
  return (SOCIAL_PLATFORMS as readonly string[]).includes(String(raw || "").trim().toLowerCase());
}

export function socialPlatformLabel(platform: string | null | undefined): string {
  const p = String(platform || "").trim().toLowerCase();
  if (p === "x") return "X";
  if (!p) return "Social";
  return p.charAt(0).toUpperCase() + p.slice(1);
}

/**
 * Normalize a social handle. Strips every leading @, and if the value is a
 * profile URL, keeps only the last path segment.
 */
export function normalizeSocialHandle(raw: unknown): string | null {
  let s = stripLeadingAtSigns(raw);
  if (!s) return null;

  if (/^https?:\/\//i.test(s) || /^[a-z0-9.-]+\.[a-z]{2,}\//i.test(s) || s.includes("/")) {
    try {
      const url = /^https?:\/\//i.test(s) ? new URL(s) : new URL(`https://${s.replace(/^\/+/, "")}`);
      const parts = url.pathname.split("/").filter(Boolean);
      const skip = new Set(["c", "user", "users", "channel", "u"]);
      let last = parts[parts.length - 1] || "";
      if (skip.has(last.toLowerCase()) && parts.length > 1) {
        last = parts[parts.length - 2] || last;
      }
      s = stripLeadingAtSigns(last);
    } catch {
      const parts = s.split("/").filter(Boolean);
      s = stripLeadingAtSigns(parts[parts.length - 1] || s);
    }
  }

  s = s.replace(/^@+/, "").trim();
  if (!s || s.includes("@")) return null;
  if (s.length > 64) return null;
  if (!/^[a-zA-Z0-9._-]+$/.test(s)) return null;
  return s;
}

export function socialProfileUrl(
  platform: string | null | undefined,
  username: string | null | undefined,
): string | null {
  const handle = normalizeSocialHandle(username);
  if (!handle) return null;
  switch (String(platform || "").trim().toLowerCase()) {
    case "instagram":
      return `https://www.instagram.com/${handle}`;
    case "tiktok":
      return `https://www.tiktok.com/@${handle}`;
    case "youtube":
      return `https://www.youtube.com/@${handle}`;
    case "x":
      return `https://x.com/${handle}`;
    case "facebook":
      return `https://www.facebook.com/${handle}`;
    case "twitch":
      return `https://www.twitch.tv/${handle}`;
    default:
      return null;
  }
}

export function formatSocialHandle(username: string | null | undefined): string {
  const handle = normalizeSocialHandle(username);
  return handle ? `@${handle}` : "";
}

function pushCreatorSocial(
  out: CreatorSocialLink[],
  seen: Set<string>,
  platformRaw: unknown,
  usernameRaw: unknown,
  urlRaw?: unknown,
): void {
  if (out.length >= MAX_CREATOR_SOCIALS) return;
  const platform = String(platformRaw || "").trim().toLowerCase();
  if (!isSocialPlatform(platform)) return;
  const username = normalizeSocialHandle(usernameRaw);
  if (!username) return;
  const key = `${platform}:${username.toLowerCase()}`;
  if (seen.has(key)) return;
  seen.add(key);
  const explicit =
    typeof urlRaw === "string" && /^https:\/\//i.test(urlRaw.trim()) ? urlRaw.trim().slice(0, 500) : null;
  out.push({
    platform,
    username,
    url: explicit || socialProfileUrl(platform, username),
  });
}

/** Parse up to 4 socials from JSON, falling back to the legacy single handle. */
export function parseCreatorSocials(
  raw: unknown,
  fallback?: {
    platform?: string | null;
    username?: string | null;
    url?: string | null;
  },
): CreatorSocialLink[] {
  const out: CreatorSocialLink[] = [];
  const seen = new Set<string>();
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!item || typeof item !== "object") continue;
      const rec = item as Record<string, unknown>;
      pushCreatorSocial(out, seen, rec.platform, rec.username ?? rec.handle, rec.url);
    }
  }
  if (out.length === 0 && fallback) {
    pushCreatorSocial(out, seen, fallback.platform, fallback.username, fallback.url);
  }
  return out;
}

export function sanitizeCreatorSocials(raw: unknown): CreatorSocialLink[] {
  return parseCreatorSocials(raw);
}

/** Reserved subdomains that must never map to a creator. */
export const RESERVED_CREATOR_SUBDOMAINS = new Set([
  "www",
  "app",
  "api",
  "admin",
  "staging",
  "prod",
  "production",
  "cdn",
  "static",
  "assets",
  "mail",
  "email",
  "support",
  "help",
  "status",
  "docs",
  "blog",
  "shop",
  "store",
  "creators",
  "beta",
  "creator",
  "dashboard",
  "login",
  "auth",
  "s",
  "apps",
  "c",
]);

const USERNAME_RE = /^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])?$/;

/** Normalize + validate a creator username / subdomain. */
export function normalizeCreatorUsername(raw: string): string | null {
  const u = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (!u || u.length < 2 || u.length > 32) return null;
  if (!USERNAME_RE.test(u)) return null;
  if (RESERVED_CREATOR_SUBDOMAINS.has(u)) return null;
  return u;
}

/** Public shop name as shown on the storefront (not the legal / application name). */
export function sanitizeCreatorShopName(raw: unknown): string | null {
  const name = String(raw ?? "").trim().replace(/\s+/g, " ").slice(0, 120);
  return name || null;
}

/**
 * Turn a shop name into the URL handle / subdomain.
 * "Mad Clown Core" → mad-clown-core. Never appends digits.
 */
export function shopNameToHandle(raw: string): string | null {
  const spaced = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-");
  return normalizeCreatorUsername(spaced);
}

export const CREATOR_HANDLE_HOLDING_APPLICATION_STATUSES = [
  "submitted",
  "under_review",
  "accepted",
  "waitlisted",
] as const;

export const CREATOR_HANDLE_INVALID_MESSAGE =
  "Shop name must become a 2–32 character URL (letters, numbers, hyphens). Reserved words like www or admin cannot be used.";

/** Apply-form shop names: letters and spaces only. Spaces become hyphens in the URL. */
const APPLY_SHOP_NAME_RE = /^[A-Za-z]+(?:[ ][A-Za-z]+)*$/;

export const APPLY_SHOP_NAME_INVALID_MESSAGE =
  "Use letters and spaces only — no numbers or special characters. This becomes your store URL.";

export function isApplyShopNameAllowed(raw: string): boolean {
  const name = String(raw ?? "").trim().replace(/\s+/g, " ");
  if (!name || !APPLY_SHOP_NAME_RE.test(name)) return false;
  return shopNameToHandle(name) != null;
}

export function sanitizeApplyShopNameInput(raw: string): string {
  return String(raw ?? "").replace(/[^A-Za-z ]/g, "");
}

export const CREATOR_HANDLE_TAKEN_MESSAGE =
  "That shop name is already taken. Choose a different name — we will not add numbers to make it unique.";

export const CREATOR_HANDLE_NUMBERED_VARIANT_MESSAGE =
  "That name is the same as an existing shop with numbers added. Choose a different shop name.";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** True when candidate is exactly base, or base plus optional hyphen + digits (max2, max-2). */
export function isNumberedHandleVariant(candidate: string, base: string): boolean {
  if (!candidate || !base) return false;
  if (candidate === base) return true;
  return new RegExp(`^${escapeRegExp(base)}-?\\d+$`).test(candidate);
}

/**
 * If `candidate` collides with a taken handle — exact or numbered suffix — return the taken handle.
 * Used so we never mint max2 when max is taken.
 */
export function findConflictingHandle(
  candidate: string,
  takenHandles: Iterable<string>,
): string | null {
  const handle = shopNameToHandle(candidate);
  if (!handle) return null;
  const taken = new Set<string>();
  for (const raw of takenHandles) {
    const t = shopNameToHandle(raw);
    if (t) taken.add(t);
  }
  for (const t of taken) {
    if (isNumberedHandleVariant(handle, t) || isNumberedHandleVariant(t, handle)) {
      return t;
    }
  }
  return null;
}

export function clampFreeGensPerCustomer(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_CREATOR_FREE_GENS_PER_CUSTOMER;
  return Math.min(10, Math.max(0, Math.floor(n)));
}

export function clampMonthlyGenerationAllowance(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_CREATOR_MONTHLY_GENERATION_ALLOWANCE;
  return Math.min(1_000_000, Math.max(0, Math.floor(n)));
}

/** Parse creator subdomain from Host header (max.aiartstudio.app → max). */
export function extractSubdomainFromHost(hostHeader: string | undefined): string | null {
  if (!hostHeader) return null;
  const host = hostHeader.split(":")[0]?.toLowerCase() || "";
  if (!host || host === "localhost" || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return null;

  // Staging first — otherwise max.staging.aiartstudio.app is read as "max.staging".
  if (host.endsWith(".staging.aiartstudio.app")) {
    const sub = host.slice(0, -".staging.aiartstudio.app".length);
    if (!sub || sub.includes(".")) return null;
    return sub;
  }

  if (host.endsWith(".aiartstudio.app")) {
    const sub = host.slice(0, -".aiartstudio.app".length);
    if (!sub || sub.includes(".")) return null;
    return sub;
  }

  return null;
}

/** Parse /c/:username path fallback. */
export function extractUsernameFromPath(pathname: string): string | null {
  const m = pathname.match(/^\/c\/([a-z0-9-]+)(?:\/|$)/i);
  if (!m) return null;
  return normalizeCreatorUsername(m[1]!);
}

/** Public storefront name: shop handle, never the legal / application name. */
export function creatorPublicName(opts: {
  username: string;
  branding?: Record<string, unknown> | null;
}): string {
  const headline =
    opts.branding && typeof opts.branding.headline === "string"
      ? opts.branding.headline.trim()
      : "";
  return headline || opts.username;
}

/** Allow only our app hosts so checkout “Back to shop” cannot open an arbitrary URL. */
export function isSafeCreatorReturnUrl(
  raw: string,
  allowedOrigins: Iterable<string> = [],
): boolean {
  try {
    const parsed = new URL(String(raw || "").trim());
    const host = parsed.hostname.toLowerCase();
    const local = host === "localhost" || host === "127.0.0.1";
    if (parsed.protocol === "https:") {
      /* ok */
    } else if (parsed.protocol === "http:" && local) {
      /* ok */
    } else {
      return false;
    }
    if (host === "aiartstudio.app" || host.endsWith(".aiartstudio.app")) return true;
    if (local) return true;
    if (host.endsWith(".up.railway.app")) return true;
    for (const origin of allowedOrigins) {
      try {
        if (new URL(String(origin)).hostname.toLowerCase() === host) return true;
      } catch {
        /* skip */
      }
    }
    return false;
  } catch {
    return false;
  }
}

export function creatorStorefrontHomeUrl(opts: {
  username: string;
  origin?: string;
  hostname?: string;
}): string {
  const handle = normalizeCreatorUsername(opts.username) || "";
  const origin = String(opts.origin || "https://aiartstudio.app").replace(/\/$/, "");
  const hostname = String(opts.hostname || "").toLowerCase();
  if (hostname.endsWith(".staging.aiartstudio.app")) {
    const sub = hostname.slice(0, -".staging.aiartstudio.app".length);
    if (sub && !sub.includes(".") && (!handle || sub === handle)) {
      return `${origin}/`;
    }
  }
  if (hostname.endsWith(".aiartstudio.app")) {
    const sub = hostname.slice(0, -".aiartstudio.app".length);
    if (sub && !sub.includes(".") && (!handle || sub === handle)) {
      return `${origin}/`;
    }
  }
  return handle ? `${origin}/c/${handle}` : origin;
}

export function sanitizeCreatorReturnUrl(
  raw: unknown,
  fallback: string,
  allowedOrigins: Iterable<string> = [],
): string {
  const url = String(raw ?? "").trim().slice(0, 255);
  if (url && isSafeCreatorReturnUrl(url, allowedOrigins)) return url;
  return String(fallback || "").trim().slice(0, 255);
}

export function isSafeCreatorImageUrl(url: string): boolean {
  if (!url) return true;
  if (url.startsWith("/objects/")) return !url.includes("..");
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function sanitizeCreatorImageUrl(raw: unknown): string | null {
  const url = String(raw ?? "").trim().slice(0, 2000);
  if (!url) return null;
  return isSafeCreatorImageUrl(url) ? url : null;
}

export function creatorBrandingImageUrl(
  branding: Record<string, unknown> | null | undefined,
  key: string,
): string | null {
  if (!branding || typeof branding[key] !== "string") return null;
  return sanitizeCreatorImageUrl(branding[key]);
}

export const CREATOR_HEADING_FONTS = [
  { id: "default", label: "Default", cssFamily: "", googleFamily: null },
  {
    id: "impact",
    label: "Impact",
    cssFamily: 'Impact, Anton, "Arial Black", sans-serif',
    googleFamily: "Anton",
  },
  {
    id: "bebas",
    label: "Bebas Neue",
    cssFamily: '"Bebas Neue", Impact, sans-serif',
    googleFamily: "Bebas Neue",
  },
  {
    id: "marker",
    label: "Permanent Marker",
    cssFamily: '"Permanent Marker", cursive',
    googleFamily: "Permanent Marker",
  },
  {
    id: "oswald",
    label: "Oswald",
    cssFamily: "Oswald, sans-serif",
    googleFamily: "Oswald",
  },
  {
    id: "playfair",
    label: "Playfair Display",
    cssFamily: '"Playfair Display", Georgia, serif',
    googleFamily: "Playfair Display",
  },
  {
    id: "grotesk",
    label: "Space Grotesk",
    cssFamily: '"Space Grotesk", sans-serif',
    googleFamily: "Space Grotesk",
  },
  {
    id: "bangers",
    label: "Bangers",
    cssFamily: "Bangers, Impact, sans-serif",
    googleFamily: "Bangers",
  },
] as const;

export type CreatorHeadingFontId = (typeof CREATOR_HEADING_FONTS)[number]["id"];

export function parseCreatorHeadingFontId(raw: unknown): CreatorHeadingFontId {
  const id = String(raw || "").trim().toLowerCase();
  return CREATOR_HEADING_FONTS.some((f) => f.id === id)
    ? (id as CreatorHeadingFontId)
    : "default";
}

export function resolveCreatorHeadingFont(
  branding: Record<string, unknown> | null | undefined,
): (typeof CREATOR_HEADING_FONTS)[number] {
  const id = parseCreatorHeadingFontId(branding?.headingFont);
  return CREATOR_HEADING_FONTS.find((f) => f.id === id) || CREATOR_HEADING_FONTS[0];
}

/** Combined stylesheet so admin previews and the storefront can load faces. */
export const CREATOR_HEADING_FONTS_STYLESHEET =
  "https://fonts.googleapis.com/css2?family=Anton&family=Bangers&family=Bebas+Neue&family=Oswald:wght@400;700&family=Permanent+Marker&family=Playfair+Display:wght@400;700&family=Space+Grotesk:wght@400;700&display=swap";

export type CreatorProfileBrandingPatch = {
  shopName?: string | null;
  shopDescription?: string | null;
  backgroundImageUrl?: string | null;
  headingFont?: string | null;
};

/** Merge shop-facing branding JSON (headline, description, background). */
export function mergeCreatorBranding(
  prev: Record<string, unknown> | null | undefined,
  patch: CreatorProfileBrandingPatch,
): Record<string, unknown> {
  const next = prev && typeof prev === "object" ? { ...prev } : {};
  if (patch.shopName !== undefined) {
    const headline = String(patch.shopName || "").trim().slice(0, 120);
    if (headline) next.headline = headline;
    else delete next.headline;
  }
  if (patch.shopDescription !== undefined) {
    const description = String(patch.shopDescription || "").trim().slice(0, 500);
    if (description) next.description = description;
    else delete next.description;
  }
  if (patch.backgroundImageUrl !== undefined) {
    const url = sanitizeCreatorImageUrl(patch.backgroundImageUrl);
    if (url) next.backgroundImageUrl = url;
    else delete next.backgroundImageUrl;
  }
  if (patch.headingFont !== undefined) {
    const id = parseCreatorHeadingFontId(patch.headingFont);
    if (id === "default") delete next.headingFont;
    else next.headingFont = id;
  }
  return next;
}

export function sanitizeCreatorBio(raw: unknown): string | null {
  const bio = String(raw ?? "").trim().slice(0, 2000);
  return bio || null;
}
