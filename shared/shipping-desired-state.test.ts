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
  buildShopDesiredState,
  maxRatesPerZone,
  type DesiredClassInput,
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
});
