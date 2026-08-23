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

export type DesiredRate = {
  bandIndex: number;
  lowerGrams: number;
  /** null = unbounded open band. */
  upperGrams: number | null;
  /** Shop-currency minor units (post-FX, post-rounding). */
  priceCents: number;
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

      const groupLabel =
        profile.groups.length === 1
          ? profile.groups[0].label || profile.groups[0].group
          : "All sizes";
      const name = `AppAI · ${cls.className} · ${groupLabel}`.slice(0, 250);

      const hashInput = JSON.stringify({
        name,
        zones: zones.map((z) => ({
          k: z.zoneKey,
          c: z.countries,
          row: z.restOfWorld,
          b: z.blocked,
          r: z.rates.map((r) => `${r.lowerGrams}-${r.upperGrams ?? "inf"}:${r.priceCents}`),
        })),
      });

      profiles.push({
        profileKey: profile.key,
        name,
        shippingClassId: cls.shippingClassId,
        classKey: table.classKey,
        variantGroup: profile.groups.length === 1 ? profile.groups[0].group : null,
        variants,
        zones,
        hash: stableHash(hashInput),
      });
    }
  }

  profiles.sort((a, b) => a.profileKey.localeCompare(b.profileKey));
  return { profiles, unresolvedVariants };
}

/** Max rates in any single zone of the desired state (pre-flight vs probed cap). */
export function maxRatesPerZone(state: DesiredShopState): number {
  let max = 0;
  for (const p of state.profiles) {
    for (const z of p.zones) max = Math.max(max, z.rates.length);
  }
  return max;
}
