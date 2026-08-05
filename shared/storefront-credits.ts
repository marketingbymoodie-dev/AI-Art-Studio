/** Default free AI generations per storefront visitor/customer (merchant can raise up to MAX). */
export const STOREFRONT_FREE_GENERATION_DEFAULT = 1;
/** Hard ceiling for merchant-configured free gens per visitor. */
export const STOREFRONT_FREE_GENERATION_MAX = 10;
/** Floor for merchant-configured free gens per visitor. */
export const STOREFRONT_FREE_GENERATION_MIN = 1;

/**
 * @deprecated Prefer STOREFRONT_FREE_GENERATION_DEFAULT — kept as alias for older imports.
 */
export const STOREFRONT_FREE_GENERATION_LIMIT = STOREFRONT_FREE_GENERATION_DEFAULT;

/** Max checkout entitlement across all packs ($3). */
export const CREDIT_ENTITLEMENT_MAX_CENTS = 300;

export type CreditPackDefinition = {
  packId: string;
  credits: number;
  priceInCents: number;
  entitlementCents: number;
  label: string;
};

/** Premade customer top-up packs (Stripe Checkout). */
export const CREDIT_PACK_CATALOG: CreditPackDefinition[] = [
  {
    packId: "5",
    credits: 5,
    priceInCents: 100,
    entitlementCents: 100,
    label: "5 gens for $1",
  },
  {
    packId: "10",
    credits: 10,
    priceInCents: 200,
    entitlementCents: 200,
    label: "10 gens for $2",
  },
  {
    packId: "20",
    credits: 20,
    priceInCents: 300,
    entitlementCents: 300,
    label: "20 gens for $3",
  },
];

/** Default pack when merchant has not customized. */
export const CREDIT_PACK_ID = "5";
export const CREDIT_PACK_CREDITS = 5;
export const CREDIT_PACK_PRICE_CENTS = 100;
export const CREDIT_PACK_ENTITLEMENT_CENTS = 100;

export type CreditReimbursementMode = "appai_discount" | "merchant_handles";

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

/** Resolve Stripe credit package id → credits + price (respects shop enabled packs). */
export function resolveCreditPack(
  packageId: string | null | undefined,
  enabledPackIds?: string[] | null,
): {
  packId: string;
  credits: number;
  priceInCents: number;
  entitlementCents: number;
  label: string;
} | null {
  const enabled = parseEnabledCreditPackIds(enabledPackIds ?? [CREDIT_PACK_ID]);
  let id = String(packageId || enabled[0] || CREDIT_PACK_ID).trim();
  // Legacy: bare "10" with only pack "5" enabled → 5-pack.
  if (id === "10" && !enabled.includes("10") && enabled.includes("5")) {
    id = "5";
  }
  if (!enabled.includes(id)) return null;
  const def = getCreditPackDefinition(id);
  if (!def) return null;
  return { ...def };
}

export function clampEntitlementCents(n: unknown): number {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v) || v <= 0) return 0;
  return Math.min(CREDIT_ENTITLEMENT_MAX_CENTS, Math.max(0, Math.round(v)));
}
