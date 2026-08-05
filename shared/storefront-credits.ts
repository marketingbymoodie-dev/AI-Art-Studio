/** Default free AI generations per storefront visitor/customer (merchant can raise up to MAX). */
export const STOREFRONT_FREE_GENERATION_DEFAULT = 5;
/** Hard ceiling for merchant-configured free gens per visitor. */
export const STOREFRONT_FREE_GENERATION_MAX = 10;
/** Floor for merchant-configured free gens per visitor. */
export const STOREFRONT_FREE_GENERATION_MIN = 1;

/**
 * @deprecated Prefer STOREFRONT_FREE_GENERATION_DEFAULT — kept as alias for older imports.
 */
export const STOREFRONT_FREE_GENERATION_LIMIT = STOREFRONT_FREE_GENERATION_DEFAULT;

/** Customer top-up pack: 5 gens for $1, with up to $1 checkout entitlement on physical order. */
export const CREDIT_PACK_ID = "5";
export const CREDIT_PACK_CREDITS = 5;
export const CREDIT_PACK_PRICE_CENTS = 100;
export const CREDIT_PACK_ENTITLEMENT_CENTS = 100;

export function clampStorefrontFreeGens(n: unknown): number {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return STOREFRONT_FREE_GENERATION_DEFAULT;
  return Math.min(
    STOREFRONT_FREE_GENERATION_MAX,
    Math.max(STOREFRONT_FREE_GENERATION_MIN, Math.round(v)),
  );
}

export function storefrontArtworksRemaining(args: {
  freeGenerationsUsed?: number;
  paidCredits?: number;
  freeGenerationLimit?: number;
}): number {
  const freeUsed = args.freeGenerationsUsed ?? 0;
  const paid = args.paidCredits ?? 0;
  const limit = clampStorefrontFreeGens(
    args.freeGenerationLimit ?? STOREFRONT_FREE_GENERATION_DEFAULT,
  );
  const freeRemaining = Math.max(0, limit - freeUsed);
  return freeRemaining + paid;
}

/** Resolve Stripe credit package id → credits + price (accepts legacy "10" as 5-pack). */
export function resolveCreditPack(packageId: string | null | undefined): {
  packId: string;
  credits: number;
  priceInCents: number;
  entitlementCents: number;
} | null {
  const id = String(packageId || CREDIT_PACK_ID).trim();
  if (id === "5" || id === "10") {
    // Legacy "10" maps to the current 5-for-$1 pack (Stripe fee math).
    return {
      packId: CREDIT_PACK_ID,
      credits: CREDIT_PACK_CREDITS,
      priceInCents: CREDIT_PACK_PRICE_CENTS,
      entitlementCents: CREDIT_PACK_ENTITLEMENT_CENTS,
    };
  }
  return null;
}
