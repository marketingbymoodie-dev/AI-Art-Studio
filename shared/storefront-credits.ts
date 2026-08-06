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
 * Premade Studio Credits packs (merchant-mediated Shopify products in Phase 2).
 * Wholesale to merchant is $0.08/credit via usage billing at grant time.
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
