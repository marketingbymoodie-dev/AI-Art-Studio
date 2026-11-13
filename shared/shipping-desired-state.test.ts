/**
 * Phase 3 — desired-state generator tests (same staging fixtures as Phase 2).
 * Verifies demand-driven profiles (amendment A), zone collapsing, ROW
 * handling, blocked-zone emission for exclusions, FX conversion and hash
 * stability.
 */
import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_BAND_CONFIG,
  buildClassRateTable,
  type ClassRateTable,
  type ExclusionSet,
} from "./shipping-bands";
import {
  applyFreeShippingToZones,
  buildShopDesiredState,
  deliveryMethodDefinitionInputs,
  FREE_SHIPPING_RATE_NAME,
  maxRatesPerZone,
  stableHash,
  type DesiredClassInput,
  type DesiredZone,
  type MembershipVariant,
} from "./shipping-desired-state";

type Fixture = {
  classKey: string;
  name: string;
  groups: Array<{ group: string; label: string; printifyVariantIds: string[] }>;
  byVariant: Record<string, Record<string, { first: number; additional: number }>>;
  rates: Array<{ zone: string; group: string; shippable: boolean }>;
};

function loadFixture(slug: string): Fixture {
  const file = path.join(__dirname, "__fixtures__", "shipping", `${slug}.json`);
  return JSON.parse(readFileSync(file, "utf8")) as Fixture;
}

const framed = loadFixture("framed-vertical-540-99");
const tee = loadFixture("heavy-cotton-tee-6-99");

function classInput(f: Fixture, shippingClassId: number): DesiredClassInput {
  const table: ClassRateTable = buildClassRateTable(f.classKey, f.byVariant, f.groups);
  const excluded: ExclusionSet = new Set(
    f.rates.filter((r) => !r.shippable).map((r) => `${r.zone}::${r.group}`),
  );
  return { shippingClassId, className: f.name, table, excluded, config: DEFAULT_BAND_CONFIG };
}

const framedInput = classInput(framed, 40);
const teeInput = classInput(tee, 7);

function member(
  classKey: string,
  group: string,
  vid: string,
  source: "base" | "shadow" = "base",
): MembershipVariant {
  return { classKey, group, shopifyVariantId: vid, source };
}

describe("buildShopDesiredState", () => {
  it("is demand-driven: no members → no profiles at all", () => {
    const state = buildShopDesiredState({
      classes: [framedInput, teeInput],
      memberships: [],
      shopCurrency: "USD",
      usdPerShopUnit: 1,
    });
    expect(state.profiles).toEqual([]);
  });

  it("emits only the profiles whose class/group has members (amendment A)", () => {
    const state = buildShopDesiredState({
      classes: [framedInput, teeInput],
      memberships: [
        member(framed.classKey, "g1", "111"),
        member(framed.classKey, "g1", "112", "shadow"),
        member(tee.classKey, "g1", "222"),
      ],
      shopCurrency: "USD",
      usdPerShopUnit: 1,
    });
    // Framed splits per group (4 groups) but only g1 has members; tee is #all.
    expect(state.profiles.map((p) => p.profileKey).sort()).toEqual([
      `${framed.classKey}#g1`,
      `${tee.classKey}#all`,
    ]);
    const framedProfile = state.profiles.find((p) => p.profileKey === `${framed.classKey}#g1`)!;
    expect(framedProfile.variants.map((v) => v.shopifyVariantId).sort()).toEqual(["111", "112"]);
    expect(framedProfile.variants.every((v) => v.pseudoWeightGrams > 0)).toBe(true);
  });

  it("membership for an unknown class is surfaced, not silently dropped", () => {
    const state = buildShopDesiredState({
      classes: [teeInput],
      memberships: [member("999:1", "g1", "333"), member(tee.classKey, "g1", "222")],
      shopCurrency: "USD",
      usdPerShopUnit: 1,
    });
    expect(state.profiles).toHaveLength(1);
    expect(state.unresolvedVariants).toHaveLength(1);
    expect(state.unresolvedVariants[0].shopifyVariantId).toBe("333");
  });

  it("collapses countries with identical band vectors into one zone", () => {
    const state = buildShopDesiredState({
      classes: [teeInput],
      memberships: [member(tee.classKey, "g1", "222")],
      shopCurrency: "USD",
      usdPerShopUnit: 1,
    });
    const [profile] = state.profiles;
    // No zone may repeat another zone's country, and collapsed zones must
    // cover every explicitly-priced non-ROW country exactly once (except those
    // identical to ROW, which the ROW zone absorbs).
    const seen = new Set<string>();
    for (const z of profile.zones) {
      for (const c of z.countries) {
        expect(seen.has(c)).toBe(false);
        seen.add(c);
      }
    }
    const rowZone = profile.zones.find((z) => z.restOfWorld);
    expect(rowZone).toBeTruthy();
    expect(rowZone!.rates.length).toBe(DEFAULT_BAND_CONFIG.maxBands + 1);
    // The tee table has distinct US pricing → US must be an explicit zone.
    expect(profile.zones.some((z) => z.countries.includes("US"))).toBe(true);
  });

  it("framed g4 (AU + ROW excluded): no ROW zone, AU covered by nothing", () => {
    // Fixture excludes both AU::g4 and ROW::g4 — the g4 profile must ship only
    // US/CA. With no restOfWorld zone, AU (and everywhere else) has no rates,
    // which is exactly how Shopify blocks checkout for those destinations.
    const state = buildShopDesiredState({
      classes: [framedInput],
      memberships: [member(framed.classKey, "g4", "444")],
      shopCurrency: "USD",
      usdPerShopUnit: 1,
    });
    const profile = state.profiles.find((p) => p.profileKey === `${framed.classKey}#g4`)!;
    expect(profile.zones.some((z) => z.restOfWorld)).toBe(false);
    expect(profile.zones.some((z) => z.blocked)).toBe(false);
    for (const z of profile.zones) expect(z.countries).not.toContain("AU");
    const covered = profile.zones.flatMap((z) => z.countries).sort();
    expect(covered).toEqual(["CA", "US"]);
  });

  it("emits a BLOCKED zone when ROW exists and a specific country is excluded", () => {
    // Synthetic: exclude CA for framed g1. ROW::g1 stays shippable, so without
    // a blocked zone Shopify's restOfWorld would swallow CA and price it.
    const withCaExcluded: DesiredClassInput = {
      ...framedInput,
      excluded: new Set([...Array.from(framedInput.excluded), "CA::g1"]),
    };
    const state = buildShopDesiredState({
      classes: [withCaExcluded],
      memberships: [member(framed.classKey, "g1", "111")],
      shopCurrency: "USD",
      usdPerShopUnit: 1,
    });
    const profile = state.profiles.find((p) => p.profileKey === `${framed.classKey}#g1`)!;
    expect(profile.zones.some((z) => z.restOfWorld)).toBe(true);
    const blocked = profile.zones.find((z) => z.blocked);
    expect(blocked).toBeTruthy();
    expect(blocked!.countries).toContain("CA");
    expect(blocked!.rates).toEqual([]);
    for (const z of profile.zones.filter((x) => !x.blocked)) {
      expect(z.countries).not.toContain("CA");
    }
  });

  it("framed g1 (AU falls through to ROW): AU is NOT blocked and not explicit", () => {
    const state = buildShopDesiredState({
      classes: [framedInput],
      memberships: [member(framed.classKey, "g1", "111")],
      shopCurrency: "USD",
      usdPerShopUnit: 1,
    });
    const profile = state.profiles.find((p) => p.profileKey === `${framed.classKey}#g1`)!;
    const blocked = profile.zones.find((z) => z.blocked);
    if (blocked) expect(blocked.countries).not.toContain("AU");
    // AU has no explicit row for g1 in the fixture → covered by restOfWorld.
    expect(profile.zones.some((z) => z.restOfWorld)).toBe(true);
  });

  it("applies the FX rate to every band price", () => {
    const usd = buildShopDesiredState({
      classes: [teeInput],
      memberships: [member(tee.classKey, "g1", "222")],
      shopCurrency: "USD",
      usdPerShopUnit: 1,
    });
    const aud = buildShopDesiredState({
      classes: [teeInput],
      memberships: [member(tee.classKey, "g1", "222")],
      shopCurrency: "AUD",
      usdPerShopUnit: 1.6,
    });
    const usdZone = usd.profiles[0].zones.find((z) => z.countries.includes("US"))!;
    const audZone = aud.profiles[0].zones.find((z) => z.countries.includes("US"))!;
    for (let i = 0; i < usdZone.rates.length; i++) {
      expect(audZone.rates[i].priceCents).toBe(Math.round(usdZone.rates[i].priceCents * 1.6));
    }
    // FX must change the hash (rates differ).
    expect(usd.profiles[0].hash).not.toBe(aud.profiles[0].hash);
  });

  it("hashes are stable across runs and change when rates change", () => {
    const run = () =>
      buildShopDesiredState({
        classes: [framedInput, teeInput],
        memberships: [member(framed.classKey, "g1", "111"), member(tee.classKey, "g1", "222")],
        shopCurrency: "USD",
        usdPerShopUnit: 1,
      });
    const a = run();
    const b = run();
    expect(a.profiles.map((p) => p.hash)).toEqual(b.profiles.map((p) => p.hash));
    // Membership changes must NOT change the hash (variants associate separately).
    const c = buildShopDesiredState({
      classes: [framedInput, teeInput],
      memberships: [
        member(framed.classKey, "g1", "111"),
        member(framed.classKey, "g1", "119", "shadow"),
        member(tee.classKey, "g1", "222"),
      ],
      shopCurrency: "USD",
      usdPerShopUnit: 1,
    });
    expect(c.profiles.find((p) => p.profileKey === `${framed.classKey}#g1`)!.hash).toBe(
      a.profiles.find((p) => p.profileKey === `${framed.classKey}#g1`)!.hash,
    );
  });

  it("every zone stays within maxBands+1 rates (R2 pre-flight input)", () => {
    const state = buildShopDesiredState({
      classes: [framedInput, teeInput],
      memberships: [
        member(framed.classKey, "g1", "111"),
        member(framed.classKey, "g2", "112"),
        member(framed.classKey, "g3", "113"),
        member(framed.classKey, "g4", "114"),
        member(tee.classKey, "g1", "222"),
      ],
      shopCurrency: "USD",
      usdPerShopUnit: 1,
    });
    expect(maxRatesPerZone(state)).toBe(DEFAULT_BAND_CONFIG.maxBands + 1);
  });

  it("leaves desired state identical when free shipping is off", () => {
    const args = {
      classes: [teeInput],
      memberships: [member(tee.classKey, "g1", "222")],
      shopCurrency: "USD",
      usdPerShopUnit: 1,
    };
    const plain = buildShopDesiredState(args);
    const off = buildShopDesiredState({
      ...args,
      freeShipping: { enabled: false, thresholdCents: 7500, flatCents: 495, countries: ["US"] },
    });
    expect(off.profiles.map((p) => p.hash)).toEqual(plain.profiles.map((p) => p.hash));
    expect(JSON.stringify(off.profiles)).toBe(JSON.stringify(plain.profiles));
    for (const zone of plain.profiles[0].zones) {
      for (const rate of zone.rates) {
        expect(rate.maxSubtotalCents).toBeUndefined();
        expect(rate.name).toBeUndefined();
      }
    }
  });

  it("replaces listed zones with two mutually exclusive flat rates", () => {
    const args = {
      classes: [teeInput],
      memberships: [member(tee.classKey, "g1", "222")],
      shopCurrency: "USD",
      usdPerShopUnit: 1,
    };
    const plain = buildShopDesiredState(args);
    const on = buildShopDesiredState({
      ...args,
      freeShipping: { enabled: true, thresholdCents: 7500, flatCents: 495, countries: ["US"] },
    });
    const plainProfile = plain.profiles[0];
    const onProfile = on.profiles[0];
    expect(onProfile.hash).not.toBe(plainProfile.hash);

    const onUs = onProfile.zones.find((z) => z.countries.join() === "US")!;
    expect(onUs.rates).toHaveLength(2);
    expect(onUs.rates[0]).toMatchObject({
      priceCents: 495,
      minSubtotalCents: 0,
      maxSubtotalCents: 7499,
      weightConditions: false,
    });
    expect(onUs.rates[0].name).toBeUndefined();
    expect(onUs.rates[1]).toMatchObject({
      priceCents: 0,
      minSubtotalCents: 7500,
      name: FREE_SHIPPING_RATE_NAME,
      weightConditions: false,
    });
    expect(onUs.rates[1].maxSubtotalCents).toBeUndefined();

    const others = (zones: typeof plainProfile.zones) =>
      zones.filter((z) => !z.countries.includes("US"));
    expect(JSON.stringify(others(onProfile.zones))).toBe(JSON.stringify(others(plainProfile.zones)));
    expect(maxRatesPerZone(on)).toBeLessThanOrEqual(DEFAULT_BAND_CONFIG.maxBands + 1);
    expect(onUs.rates.length).toBeLessThan(21);

    const methods = deliveryMethodDefinitionInputs(onUs, "USD", "Standard Shipping");
    expect(methods).toHaveLength(2);
    expect(methods[0].name).toBe("Standard Shipping");
    expect(methods[0].weightConditionsToCreate).toBeUndefined();
    expect(methods[0].rateDefinition).toEqual({
      price: { amount: "4.95", currencyCode: "USD" },
    });
    expect(methods[0].priceConditionsToCreate).toEqual([
      {
        criteria: { amount: "0.00", currencyCode: "USD" },
        operator: "GREATER_THAN_OR_EQUAL_TO",
      },
      {
        criteria: { amount: "74.99", currencyCode: "USD" },
        operator: "LESS_THAN_OR_EQUAL_TO",
      },
    ]);
    expect(methods[1].name).toBe("Free Shipping");
    expect(methods[1].weightConditionsToCreate).toBeUndefined();
    expect(methods[1].rateDefinition).toEqual({
      price: { amount: "0.00", currencyCode: "USD" },
    });
    expect(methods[1].priceConditionsToCreate).toEqual([
      {
        criteria: { amount: "75.00", currencyCode: "USD" },
        operator: "GREATER_THAN_OR_EQUAL_TO",
      },
    ]);
  });

  it("splits a mixed zone so an unlisted country keeps uncapped bands", () => {
    const zones: DesiredZone[] = [
      {
        zoneKey: stableHash(["CA", "US"].join(",")),
        name: "CA +1",
        countries: ["CA", "US"],
        restOfWorld: false,
        blocked: false,
        rates: [{ bandIndex: 0, lowerGrams: 0, upperGrams: 240, priceCents: 495 }],
      },
      {
        zoneKey: "ROW",
        name: "Rest of world",
        countries: [],
        restOfWorld: true,
        blocked: false,
        rates: [{ bandIndex: 0, lowerGrams: 0, upperGrams: null, priceCents: 1095 }],
      },
    ];
    const next = applyFreeShippingToZones(zones, {
      enabled: true,
      thresholdCents: 7500,
      flatCents: 495,
      countries: ["US"],
    });
    const us = next.find((z) => z.countries.join() === "US")!;
    const ca = next.find((z) => z.countries.join() === "CA")!;
    const row = next.find((z) => z.restOfWorld)!;
    expect(us.rates).toHaveLength(2);
    expect(us.rates[0].priceCents).toBe(495);
    expect(us.rates[0].maxSubtotalCents).toBe(7499);
    expect(us.rates[0].weightConditions).toBe(false);
    expect(ca.rates).toHaveLength(1);
    expect(ca.rates[0].maxSubtotalCents).toBeUndefined();
    expect(ca.rates[0].priceCents).toBe(495);
    expect(ca.rates[0].upperGrams).toBe(240);
    expect(row.rates[0].maxSubtotalCents).toBeUndefined();
    expect(row.rates).toHaveLength(1);
    expect(applyFreeShippingToZones(zones, { enabled: true, thresholdCents: 0, countries: ["US"] })).toBe(
      zones,
    );
  });
});
