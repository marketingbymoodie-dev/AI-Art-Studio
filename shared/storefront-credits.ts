/** Default free AI generations per storefront visitor/customer (merchant can raise up to MAX). */
export const STOREFRONT_FREE_GENERATION_DEFAULT = 2;
/** Hard ceiling for merchant-configured free gens per visitor. */
export const STOREFRONT_FREE_GENERATION_MAX = 10;
/** Floor for merchant-configured free gens per visitor. */
export const STOREFRONT_FREE_GENERATION_MIN = 1;

/**
 * @deprecated Prefer STOREFRONT_FREE_GENERATION_DEFAULT — kept as alias for older imports.
 */
export const STOREFRONT_FREE_GENERATION_LIMIT = STOREFRONT_FREE_GENERATION_DEFAULT;

/**
 * Premade Studio Credits packs sold on merchant stores (and the platform shop for creators).
 * Wholesale to the merchant is STUDIO_CREDIT_WHOLESALE_CENTS per credit via usage billing at grant time.
 */
export type CreditPackDefinition = {
  packId: string;
  credits: number;
  /** Customer-facing price on the merchant's store (cents). */
  priceInCents: number;
  label: string;
};

export const CREDIT_PACK_CATALOG: CreditPackDefinition[] = [
  {
    packId: "5",
    credits: 5,
    priceInCents: 100,
    label: "5 Studio Credits for $1",
  },
  {
    packId: "10",
    credits: 10,
    priceInCents: 200,
    label: "10 Studio Credits for $2",
  },
  {
    packId: "20",
    credits: 20,
    priceInCents: 300,
    label: "20 Studio Credits for $3",
  },
];

/** Default pack when merchant has not customized. */
export const CREDIT_PACK_ID = "5";
export const CREDIT_PACK_CREDITS = 5;
export const CREDIT_PACK_PRICE_CENTS = 100;

/** Wholesale cost per Studio Credit billed to the merchant at pack grant (USD cents). */
export const STUDIO_CREDIT_WHOLESALE_CENTS = 8;

export function clampStorefrontFreeGens(n: unknown): number {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return STOREFRONT_FREE_GENERATION_DEFAULT;
  return Math.min(
    STOREFRONT_FREE_GENERATION_MAX,
    Math.max(STOREFRONT_FREE_GENERATION_MIN, Math.round(v)),
  );
}

export type StorefrontCreditBreakdown = {
  shopFreeRemaining: number;
  shopEarned: number;
  pack: number;
  paidTotal: number;
  total: number;
};

export type StorefrontGenerationSpend = "customer_free" | "customer_paid" | "exhausted";

function nonNegInt(n: unknown): number {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.floor(v));
}

/**
 * Shop-local free gens remaining. Allows a 0 limit (creator shops can disable
 * free gens). When `shopFreeRemaining` is supplied, that value wins.
 */
export function storefrontShopFreeRemaining(args: {
  shopFreeRemaining?: number;
  freeGenerationsUsed?: number;
  freeGenerationLimit?: number;
}): number {
  if (args.shopFreeRemaining != null && Number.isFinite(args.shopFreeRemaining)) {
    return nonNegInt(args.shopFreeRemaining);
  }
  const raw = args.freeGenerationLimit;
  const limit =
    raw == null || (typeof raw === "number" && !Number.isFinite(raw))
      ? STOREFRONT_FREE_GENERATION_DEFAULT
      : Math.min(
          STOREFRONT_FREE_GENERATION_MAX,
          Math.max(0, Math.round(Number(raw))),
        );
  return Math.max(0, limit - nonNegInt(args.freeGenerationsUsed));
}

/**
 * Split a wallet so the customer can see this-shop free vs rewards vs packs.
 * If bucket fields are missing, paid credits are treated as shop rewards.
 */
export function storefrontCreditBreakdown(args: {
  shopFreeRemaining?: number;
  freeGenerationsUsed?: number;
  freeGenerationLimit?: number;
  earnedCredits?: number | null;
  packCredits?: number | null;
  paidCredits?: number;
}): StorefrontCreditBreakdown {
  const shopFreeRemaining = storefrontShopFreeRemaining(args);
  const paidTotal = nonNegInt(args.paidCredits);
  const hasBuckets = args.earnedCredits != null || args.packCredits != null;
  let shopEarned = nonNegInt(args.earnedCredits);
  let pack = nonNegInt(args.packCredits);
  if (!hasBuckets) {
    shopEarned = paidTotal;
    pack = 0;
  } else if (shopEarned + pack === 0 && paidTotal > 0) {
    shopEarned = paidTotal;
  }
  return {
    shopFreeRemaining,
    shopEarned,
    pack,
    paidTotal,
    total: shopFreeRemaining + paidTotal,
  };
}

/** Shop free first, then paid (earned then pack at spend time). */
export function pickStorefrontGenerationSpend(args: {
  shopFreeRemaining: number;
  paidCredits: number;
}): StorefrontGenerationSpend {
  if (nonNegInt(args.shopFreeRemaining) > 0) return "customer_free";
  if (nonNegInt(args.paidCredits) > 0) return "customer_paid";
  return "exhausted";
}

export function formatStorefrontCreditsSplit(b: StorefrontCreditBreakdown): string {
  const parts: string[] = [];
  if (b.shopFreeRemaining > 0) {
    parts.push(`${b.shopFreeRemaining} free on this shop`);
  }
  if (b.shopEarned > 0) {
    parts.push(`${b.shopEarned} shop reward${b.shopEarned === 1 ? "" : "s"}`);
  }
  if (b.pack > 0) {
    parts.push(`${b.pack} pack`);
  }
  if (parts.length === 0) return "0 artworks remaining";
  return `${parts.join(" · ")} remaining`;
}

export function storefrontArtworksRemaining(args: {
  shopFreeRemaining?: number;
  freeGenerationsUsed?: number;
  paidCredits?: number;
  freeGenerationLimit?: number;
}): number {
  return storefrontCreditBreakdown(args).total;
}

export function getCreditPackDefinition(packId: string | null | undefined): CreditPackDefinition | null {
  const id = String(packId || CREDIT_PACK_ID).trim();
  return CREDIT_PACK_CATALOG.find((p) => p.packId === id) || null;
}

export function parseEnabledCreditPackIds(raw: unknown): string[] {
  let list: string[] = [];
  if (Array.isArray(raw)) {
    list = raw.map((x) => String(x).trim()).filter(Boolean);
  } else if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) list = parsed.map((x) => String(x).trim()).filter(Boolean);
    } catch {
      list = raw.split(",").map((x) => x.trim()).filter(Boolean);
    }
  }
  const allowed = new Set(CREDIT_PACK_CATALOG.map((p) => p.packId));
  const filtered = [...new Set(list.filter((id) => allowed.has(id)))];
  return filtered.length > 0 ? filtered : [CREDIT_PACK_ID];
}

export function resolveCreditPack(
  packageId: string | null | undefined,
  enabledPackIds?: string[] | null,
): CreditPackDefinition | null {
  const enabled = parseEnabledCreditPackIds(enabledPackIds ?? [CREDIT_PACK_ID]);
  let id = String(packageId || enabled[0] || CREDIT_PACK_ID).trim();
  if (id === "10" && !enabled.includes("10") && enabled.includes("5")) {
    id = "5";
  }
  if (!enabled.includes(id)) return null;
  return getCreditPackDefinition(id);
}
