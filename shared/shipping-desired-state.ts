/**
 * Phase 3 — pure desired-state generator for Shopify delivery profiles.
 *
 * Given ingested class rate tables (Phase 1), the band engine (Phase 2) and
 * per-shop variant membership, produce the exact set of delivery profiles a
 * shop SHOULD have: demand-driven (a profile exists only when ≥1 app variant
 * on that shop belongs to its class/group — approved amendment A), with
 * countries collapsed into one Shopify zone per identical rate vector and the
 * final open band appended by the engine.
 *
 * Pure functions, no I/O — the reconciler (server/shipping-reconciler.ts)
 * loads inputs from the DB and applies diffs against Shopify.
 */
import {
  ROW_ZONE,
  computePseudoWeights,
  generateProfileZoneBands,
  planClassProfiles,
  type Band,
  type BandConfig,
  type ClassRateTable,
  type ExclusionSet,
} from "./shipping-bands";
import { convertUsdCentsToShop } from "./printify-shipping-quote";

// ── Types ─────────────────────────────────────────────────────────────────────

export type MembershipVariant = {
  classKey: string;
  /** Variant group within the class (Phase 1 grouping). */
  group: string;
  /** Numeric Shopify variant id (no gid prefix). */
  shopifyVariantId: string;
  source: "base" | "shadow";
};

export type DesiredClassInput = {
  shippingClassId: number;
  className: string;
  table: ClassRateTable;
  excluded: ExclusionSet;
  /** Per-class band config (per-class groupDeltaSplitThresholdCents override applied). */
  config: BandConfig;
};

/** Checkout name for the optional $0 rate. Distinct from the paid band name. */
export const FREE_SHIPPING_RATE_NAME = "Free Shipping";

export type FreeShippingOffer = {
  /** Off leaves every zone's rates untouched. */
  enabled: boolean;
  /** Shop-currency minor units. Paid bands in the listed countries cap at this minus one minor unit. */
  thresholdCents: number;
  /** ISO 3166-1 alpha-2. A zone is eligible only when every country in it is listed. */
  countries: string[];
};

export type DesiredRate = {
  bandIndex: number;
  lowerGrams: number;
  /** null = unbounded open band. */
  upperGrams: number | null;
  /** Shop-currency minor units (post-FX, post-rounding). */
  priceCents: number;
  /** Shop-currency minor units. Absent = no minimum subtotal. */
  minSubtotalCents?: number;
  /** Shop-currency minor units. Absent = no maximum subtotal. */
  maxSubtotalCents?: number;
  /** Absent = the reconciler's standard rate name. */
  name?: string;
  /** False = price condition only. Absent = weight conditions, as before. */
  weightConditions?: boolean;
};

export type DesiredZone = {
  /** "ROW", "BLOCKED", or a stable hash of the sorted country list. */
  zoneKey: string;
  name: string;
  countries: string[];
  restOfWorld: boolean;
  /**
   * Blocked zone: countries with an explicit Printify row where this profile
   * is excluded/unavailable. Emitted with NO rates so they do not fall into
   * the profile's restOfWorld zone (Shopify's ROW covers any country not
   * explicitly zoned — without this, excluded countries would get ROW rates).
   */
  blocked: boolean;
  rates: DesiredRate[];
};

export type DesiredProfile = {
  /** Phase 2 profile key, e.g. "540:99#g4" / "6:99#all". */
  profileKey: string;
  /** Shopify profile name, e.g. "AppAI · Framed Vertical Poster · 24″×36″". */
  name: string;
  shippingClassId: number;
  classKey: string;
  /** null for shared "#all" profiles. */
  variantGroup: string | null;
  variants: Array<MembershipVariant & { pseudoWeightGrams: number }>;
  zones: DesiredZone[];
  /** Stable hash of name+zones+rates — equal hash ⇒ zones/rates are a no-op. */
  hash: string;
};

export type DesiredShopState = {
  profiles: DesiredProfile[];
  /** Variants whose class/group has no ingested table (skipped, surfaced to operator). */
  unresolvedVariants: MembershipVariant[];
};

/**
 * ISO codes present in Printify shipping tables that Shopify's delivery-zone
 * country list rejects (deliveryProfileCreate: "BV is not a supported country
 * or region code"). They can be neither zoned nor blocked, so they are dropped
 * entirely and fall through to Rest-of-world pricing where a ROW zone exists.
 */
export const SHOPIFY_UNSUPPORTED_COUNTRY_CODES = new Set(["BV"]);

// ── Helpers ───────────────────────────────────────────────────────────────────

/** FNV-1a — stable, dependency-free hash for desired-state comparison. */
export function stableHash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function serializeBands(bands: Band[]): string {
  return bands.map((b) => `${b.lowerGrams}-${b.upperGrams ?? "inf"}:${b.priceCents}`).join("|");
}

/**
 * Weight-only rates keep the historical hash fragment. Subtotal bounds and a
 * custom name are appended only when present, so a shop with the offer off
 * hashes exactly as it did before the offer existed.
 */
export function rateHashPart(rate: DesiredRate): string {
  const base = `${rate.lowerGrams}-${rate.upperGrams ?? "inf"}:${rate.priceCents}`;
  if (
    rate.minSubtotalCents == null &&
    rate.maxSubtotalCents == null &&
    !rate.name &&
    rate.weightConditions !== false
  ) {
    return base;
  }
  return `${base}:min${rate.minSubtotalCents ?? ""}:max${rate.maxSubtotalCents ?? ""}:${rate.name ?? ""}:w${rate.weightConditions === false ? 0 : 1}`;
}

export function parseFreeShippingCountries(raw: string | null | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of String(raw || "").split(",")) {
    const code = part.trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(code) || seen.has(code)) continue;
    seen.add(code);
    out.push(code);
  }
  return out;
}

function offerCountries(offer: FreeShippingOffer): Set<string> {
  return new Set(parseFreeShippingCountries(offer.countries.join(",")));
}

function decorateZone(zone: DesiredZone, thresholdCents: number): DesiredZone {
  const maxSubtotalCents = thresholdCents - 1;
  const paid = zone.rates.map((rate) => ({ ...rate, maxSubtotalCents }));
  paid.push({
    bandIndex: paid.length,
    lowerGrams: 0,
    upperGrams: null,
    priceCents: 0,
    minSubtotalCents: thresholdCents,
    name: FREE_SHIPPING_RATE_NAME,
    weightConditions: false,
  });
  return { ...zone, rates: paid };
}

/**
 * Adds the $0 rate to zones whose countries are all in the offer, and caps
 * every paid band in those zones at one minor unit under the threshold.
 * A zone that mixes a listed country with any other country is split, so the
 * other country keeps today's weight bands with no subtotal condition.
 * ROW and blocked zones are never eligible.
 * Returns the same array when the offer is off or unusable.
 */
export function applyFreeShippingToZones(
  zones: DesiredZone[],
  offer: FreeShippingOffer | null | undefined,
): DesiredZone[] {
  if (!offer?.enabled) return zones;
  const thresholdCents = Math.round(offer.thresholdCents);
  if (!Number.isFinite(thresholdCents) || thresholdCents < 1) return zones;
  const allowed = offerCountries(offer);
  if (allowed.size === 0) return zones;

  const next: DesiredZone[] = [];
  for (const zone of zones) {
    if (zone.blocked || zone.restOfWorld || zone.countries.length === 0 || zone.rates.length === 0) {
      next.push(zone);
      continue;
    }
    const eligible = zone.countries.filter((code) => allowed.has(code));
    const rest = zone.countries.filter((code) => !allowed.has(code));
    if (eligible.length === 0) {
      next.push(zone);
      continue;
    }
    if (rest.length === 0) {
      next.push(decorateZone(zone, thresholdCents));
      continue;
    }
    const eligibleSorted = eligible.slice().sort();
    const restSorted = rest.slice().sort();
    next.push(
      decorateZone(
        {
          ...zone,
          zoneKey: stableHash(eligibleSorted.join(",")),
          name: zoneName(eligibleSorted, false, false),
          countries: eligibleSorted,
        },
        thresholdCents,
      ),
    );
    next.push({
      ...zone,
      zoneKey: stableHash(restSorted.join(",")),
      name: zoneName(restSorted, false, false),
      countries: restSorted,
      rates: zone.rates.map((rate) => ({ ...rate })),
    });
  }
  return next;
}

/** Shopify DeliveryMethodDefinitionInput list for one zone. */
export function deliveryMethodDefinitionInputs(
  zone: DesiredZone,
  currency: string,
  standardName: string,
): Array<Record<string, unknown>> {
  const amount = (cents: number) => (cents / 100).toFixed(2);
  return zone.rates.map((rate) => {
    const input: Record<string, unknown> = {
      name: rate.name || standardName,
      active: true,
      rateDefinition: { price: { amount: amount(rate.priceCents), currencyCode: currency } },
    };
    if (rate.weightConditions !== false) {
      const weight: Array<Record<string, unknown>> = [
        {
          criteria: { unit: "GRAMS", value: rate.lowerGrams },
          operator: "GREATER_THAN_OR_EQUAL_TO",
        },
      ];
      if (rate.upperGrams != null) {
        weight.push({
          criteria: { unit: "GRAMS", value: rate.upperGrams },
          operator: "LESS_THAN_OR_EQUAL_TO",
        });
      }
      input.weightConditionsToCreate = weight;
    }
    const price: Array<Record<string, unknown>> = [];
    if (rate.minSubtotalCents != null) {
      price.push({
        criteria: { amount: amount(rate.minSubtotalCents), currencyCode: currency },
        operator: "GREATER_THAN_OR_EQUAL_TO",
      });
    }
    if (rate.maxSubtotalCents != null) {
      price.push({
        criteria: { amount: amount(rate.maxSubtotalCents), currencyCode: currency },
        operator: "LESS_THAN_OR_EQUAL_TO",
      });
    }
    if (price.length) input.priceConditionsToCreate = price;
    return input;
  });
}

function toDesiredRates(
  bands: Band[],
  shopCurrency: string,
  usdPerShopUnit: number,
): DesiredRate[] {
  return bands.map((b, i) => ({
    bandIndex: i,
    lowerGrams: b.lowerGrams,
    upperGrams: b.upperGrams,
    priceCents: convertUsdCentsToShop(b.priceCents, shopCurrency, usdPerShopUnit).amountCents,
  }));
}

function zoneName(countries: string[], restOfWorld: boolean, blocked: boolean): string {
  if (restOfWorld) return "Rest of world";
  if (blocked) return "Not available";
  if (countries.length === 1) return countries[0];
  return `${countries[0]} +${countries.length - 1}`;
}

// ── Generator ─────────────────────────────────────────────────────────────────

export function buildShopDesiredState(params: {
  classes: DesiredClassInput[];
  memberships: MembershipVariant[];
  shopCurrency: string;
  /** Buffered/pinned USD→shop-unit FX rate (1 for USD shops). */
  usdPerShopUnit: number;
  /** Omitted or disabled: desired zones match the pre-offer generator. */
  freeShipping?: FreeShippingOffer | null;
}): DesiredShopState {
  const { classes, memberships, shopCurrency, usdPerShopUnit } = params;
  const byClassKey = new Map(classes.map((c) => [c.table.classKey, c]));

  const membersByClassGroup = new Map<string, MembershipVariant[]>();
  const unresolvedVariants: MembershipVariant[] = [];
  for (const m of memberships) {
    if (!byClassKey.has(m.classKey)) {
      unresolvedVariants.push(m);
      continue;
    }
    const key = `${m.classKey}::${m.group}`;
    const list = membersByClassGroup.get(key) || [];
    list.push(m);
    membersByClassGroup.set(key, list);
  }

  const profiles: DesiredProfile[] = [];
  for (const cls of classes) {
    const { table, excluded, config } = cls;
    const planned = planClassProfiles(table, excluded, config);
    const weights = computePseudoWeights(table);

    for (const profile of planned) {
      // Demand-driven (amendment A): skip profiles with no member variants.
      const variants: DesiredProfile["variants"] = [];
      for (const g of profile.groups) {
        const members = membersByClassGroup.get(`${table.classKey}::${g.group}`) || [];
        for (const m of members) {
          variants.push({ ...m, pseudoWeightGrams: weights[g.group] });
        }
      }
      if (variants.length === 0) continue;

      // Explicit table zones (minus ROW), each rendered through the band engine.
      const explicitCountries = Object.keys(table.rates)
        .filter((z) => z !== ROW_ZONE && !SHOPIFY_UNSUPPORTED_COUNTRY_CODES.has(z))
        .sort();
      const rowBands = table.rates[ROW_ZONE]
        ? generateProfileZoneBands(table, profile, ROW_ZONE, excluded, config)
        : null;
      const rowSerialized = rowBands ? serializeBands(rowBands.bands) : null;

      const byVector = new Map<string, { countries: string[]; bands: Band[] }>();
      const blockedCountries: string[] = [];
      for (const country of explicitCountries) {
        const zoneBands = generateProfileZoneBands(table, profile, country, excluded, config);
        if (!zoneBands) {
          // Not offered here. Only needs an explicit blocked zone when a
          // restOfWorld zone exists that would otherwise swallow the country.
          if (rowBands) blockedCountries.push(country);
          continue;
        }
        const serialized = serializeBands(zoneBands.bands);
        // Countries priced identically to ROW are covered by the ROW zone.
        if (rowSerialized !== null && serialized === rowSerialized) continue;
        const slot = byVector.get(serialized) || { countries: [], bands: zoneBands.bands };
        slot.countries.push(country);
        byVector.set(serialized, slot);
      }

      const zones: DesiredZone[] = [];
      for (const { countries, bands } of Array.from(byVector.values())) {
        countries.sort();
        zones.push({
          zoneKey: stableHash(countries.join(",")),
          name: zoneName(countries, false, false),
          countries,
          restOfWorld: false,
          blocked: false,
          rates: toDesiredRates(bands, shopCurrency, usdPerShopUnit),
        });
      }
      // Stable order: multi-country zones sorted by first country.
      zones.sort((a, b) => (a.countries[0] || "").localeCompare(b.countries[0] || ""));
      if (rowBands) {
        zones.push({
          zoneKey: "ROW",
          name: zoneName([], true, false),
          countries: [],
          restOfWorld: true,
          blocked: false,
          rates: toDesiredRates(rowBands.bands, shopCurrency, usdPerShopUnit),
        });
        if (blockedCountries.length > 0) {
          zones.push({
            zoneKey: "BLOCKED",
            name: zoneName(blockedCountries, false, true),
            countries: blockedCountries.sort(),
            restOfWorld: false,
            blocked: true,
            rates: [],
          });
        }
      }
      if (zones.filter((z) => !z.blocked).length === 0) continue; // nothing shippable

      const offeredZones = applyFreeShippingToZones(zones, params.freeShipping);

      const groupLabel =
        profile.groups.length === 1
          ? profile.groups[0].label || profile.groups[0].group
          : "All sizes";
      const name = `AppAI · ${cls.className} · ${groupLabel}`.slice(0, 250);

      const hashInput = JSON.stringify({
        name,
        zones: offeredZones.map((z) => ({
          k: z.zoneKey,
          c: z.countries,
          row: z.restOfWorld,
          b: z.blocked,
          r: z.rates.map((r) => rateHashPart(r)),
        })),
      });

      profiles.push({
        profileKey: profile.key,
        name,
        shippingClassId: cls.shippingClassId,
        classKey: table.classKey,
        variantGroup: profile.groups.length === 1 ? profile.groups[0].group : null,
        variants,
        zones: offeredZones,
        hash: stableHash(hashInput),
      });
    }
  }

  profiles.sort((a, b) => a.profileKey.localeCompare(b.profileKey));
  return { profiles, unresolvedVariants };
}

export type ShippingCoverageGaps = {
  /** Printify out of stock (or removed): storefront-locked, rejoins on restock. */
  unavailable: string[];
  /** Printify reports in stock (or no stock data) but the shipping table has no row. */
  missingInStock: string[];
};

/**
 * Printify's shipping table lists only currently-available variants, so a
 * blank missing from it is expected when Product Intelligence marks it out of
 * stock. Keys are blank keys (`size:color`), so every Shopify variant of one
 * blank (e.g. both print-sides tiers) lands in the same bucket.
 */
export function classifyShippingCoverageGaps(
  blankKeys: string[],
  coveredKeys: Set<string>,
  availability: Record<string, string>,
): ShippingCoverageGaps {
  const gaps: ShippingCoverageGaps = { unavailable: [], missingInStock: [] };
  for (const key of blankKeys) {
    if (coveredKeys.has(key)) continue;
    const status = availability[key];
    if (status === "out_of_stock" || status === "removed") gaps.unavailable.push(key);
    else gaps.missingInStock.push(key);
  }
  return gaps;
}

/**
 * Catalogue listings inherit the studio variant's class and group, so a later
 * reconcile keeps them on that profile. A variant with no studio parent is
 * left out — promote has already refused that case.
 */
export function inheritCatalogueMemberships(
  base: MembershipVariant[],
  additions: ReadonlyArray<{ shopifyVariantId: string; studioVariantId: string }>,
): MembershipVariant[] {
  const byId = new Map(base.map((row) => [row.shopifyVariantId, row]));
  const out = [...base];
  for (const add of additions) {
    const vid = String(add.shopifyVariantId || "").replace(/\D/g, "");
    const studioVid = String(add.studioVariantId || "").replace(/\D/g, "");
    if (!vid || byId.has(vid)) continue;
    const studio = byId.get(studioVid);
    if (!studio) continue;
    const row: MembershipVariant = { ...studio, shopifyVariantId: vid, source: "base" };
    byId.set(vid, row);
    out.push(row);
  }
  return out;
}

/** Max rates in any single zone of the desired state (pre-flight vs probed cap). */
export function maxRatesPerZone(state: DesiredShopState): number {
  let max = 0;
  for (const p of state.profiles) {
    for (const z of p.zones) max = Math.max(max, z.rates.length);
  }
  return max;
}
