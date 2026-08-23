/**
 * Phase 2 golden + property tests for the weight-band engine.
 * Fixtures are real staging snapshots (Printify ceiling tables + the tier
 * verdicts materialised by Phase 1) — see shared/__fixtures__/shipping/.
 */
import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_BAND_CONFIG,
  DEFAULT_TOLERANCE,
  allowedOvershootCents,
  buildClassRateTable,
  computePseudoWeights,
  effectiveCell,
  generateProfileZoneBands,
  isExcluded,
  planClassProfiles,
  referenceZone,
  roundBandPrice,
  simulateCart,
  type BandConfig,
  type CartItem,
  type ClassRateTable,
  type ExclusionSet,
  type SimOk,
} from "./shipping-bands";
import {
  DEFAULT_TIER_CONFIG,
  deriveVariantGroups,
  evaluateTier,
} from "../server/shipping-tables";

// ── Fixture loading ───────────────────────────────────────────────────────────

type FixtureRate = {
  zone: string;
  group: string;
  first: number;
  additional: number;
  tier: string;
  shippable: boolean;
  tierReason: string;
};

type Fixture = {
  classKey: string;
  name: string;
  groups: Array<{ group: string; label: string; printifyVariantIds: string[] }>;
  byVariant: Record<string, Record<string, { first: number; additional: number }>>;
  rates: FixtureRate[];
};

function loadFixture(slug: string): Fixture {
  const file = path.join(__dirname, "__fixtures__", "shipping", `${slug}.json`);
  return JSON.parse(readFileSync(file, "utf8")) as Fixture;
}

const framed = loadFixture("framed-vertical-540-99");
const pillow = loadFixture("faux-suede-pillow-223-10");
const tee = loadFixture("heavy-cotton-tee-6-99");
const FIXTURES = [framed, pillow, tee];

function tableOf(f: Fixture): ClassRateTable {
  return buildClassRateTable(f.classKey, f.byVariant, f.groups);
}

/** Exclusions exactly as Phase 1 materialised them on staging. */
function exclusionsOf(f: Fixture): ExclusionSet {
  return new Set(f.rates.filter((r) => !r.shippable).map((r) => `${r.zone}::${r.group}`));
}

const framedTable = tableOf(framed);
const pillowTable = tableOf(pillow);
const teeTable = tableOf(tee);
const tables: Record<string, ClassRateTable> = {
  [framed.classKey]: framedTable,
  [pillow.classKey]: pillowTable,
  [tee.classKey]: teeTable,
};
const exclusions: Record<string, ExclusionSet> = {
  [framed.classKey]: exclusionsOf(framed),
  [pillow.classKey]: exclusionsOf(pillow),
  [tee.classKey]: exclusionsOf(tee),
};

const NONE: BandConfig = { ...DEFAULT_BAND_CONFIG, rounding: "none" };

/** Independent oracle: fixture rate row with ROW fallthrough. */
function fixtureRate(f: Fixture, zone: string, group: string): FixtureRate | null {
  return (
    f.rates.find((r) => r.zone === zone && r.group === group) ??
    f.rates.find((r) => r.zone === "ROW" && r.group === group) ??
    null
  );
}

// ── Rounding ──────────────────────────────────────────────────────────────────

describe("roundBandPrice", () => {
  it("up95 never rounds down and lands on .95", () => {
    expect(roundBandPrice(1189, "up95")).toBe(1195);
    expect(roundBandPrice(1195, "up95")).toBe(1195);
    expect(roundBandPrice(1196, "up95")).toBe(1295);
    expect(roundBandPrice(5, "up95")).toBe(95);
    for (let cents = 1; cents < 3000; cents += 7) {
      const r = roundBandPrice(cents, "up95");
      expect(r).toBeGreaterThanOrEqual(cents);
      expect(r - cents).toBeLessThanOrEqual(99);
      expect(r % 100).toBe(95);
    }
  });
  it("nearest95 picks the closest .95", () => {
    expect(roundBandPrice(1140, "nearest95")).toBe(1095);
    expect(roundBandPrice(1150, "nearest95")).toBe(1195);
    expect(roundBandPrice(1195, "nearest95")).toBe(1195);
  });
  it("none is identity", () => {
    expect(roundBandPrice(1234, "none")).toBe(1234);
  });
});

// ── Golden: bp540 / provider 99 (Framed Vertical Poster, Printify Choice) ────

describe("golden bp540:99 framed vertical (Choice)", () => {
  it("derives exactly the 4 accepted variant groups from the raw table", () => {
    const { groups } = deriveVariantGroups({ method: "standard", byVariant: framed.byVariant });
    expect(groups.map((g) => g.group)).toEqual(["g1", "g2", "g3", "g4"]);
    // Same membership as the accepted Phase 1 export.
    const fixtureIds = framed.groups.map((g) => [...g.printifyVariantIds].sort());
    const derivedIds = groups.map((g) => [...g.printifyVariantIds].sort());
    expect(derivedIds).toEqual(fixtureIds);
  });

  it("has the accepted US / CA rates per group", () => {
    const us = framedTable.groups.map((g) => framedTable.rates["US"][g.group].first);
    expect(us).toEqual([1189, 1189, 1639, 2079]);
    const ca = framedTable.groups.map((g) => framedTable.rates["CA"][g.group].first);
    expect(ca).toEqual([4589, 4679, 4879, 6719]);
  });

  it("tiers CA warned for all groups and excludes AU/ROW g4 (retail $89.95, cap $150)", () => {
    const retail = 8995; // staging typicalRetailCentsOverride on class 40
    for (const g of framedTable.groups) {
      const verdict = evaluateTier({
        firstItemCents: framedTable.rates["CA"][g.group].first,
        typicalRetailCents: retail,
        config: DEFAULT_TIER_CONFIG,
        absoluteCapCents: DEFAULT_TIER_CONFIG.absoluteCapCents,
        manualRule: null,
      });
      expect(verdict.tier).toBe("warned");
    }
    for (const zone of ["AU", "ROW"]) {
      const verdict = evaluateTier({
        firstItemCents: framedTable.rates[zone]["g4"].first,
        typicalRetailCents: retail,
        config: DEFAULT_TIER_CONFIG,
        absoluteCapCents: DEFAULT_TIER_CONFIG.absoluteCapCents,
        manualRule: null,
      });
      expect(verdict).toMatchObject({ tier: "excluded", shippable: false, tierReason: "absolute_cap" });
    }
    // And the staging materialisation agrees.
    expect(exclusionsOf(framed)).toEqual(new Set(["AU::g4", "ROW::g4"]));
    expect(framed.rates.filter((r) => r.zone === "CA").every((r) => r.tier === "warned")).toBe(true);
  });

  it("splits into per-group profiles (delta spread $4.90 > $2 AND mixed AU/ROW exclusion)", () => {
    const profiles = planClassProfiles(framedTable, exclusions[framed.classKey]);
    expect(profiles.map((p) => p.key)).toEqual([
      "540:99#g1",
      "540:99#g2",
      "540:99#g3",
      "540:99#g4",
    ]);
  });

  it("AU small sizes fall through to ROW pricing; AU g4 is hard-blocked", () => {
    // The table has an AU row only for g4 — g1..g3 resolve via REST_OF_THE_WORLD.
    expect(framedTable.rates["AU"]).toEqual({ g4: { first: 19759, additional: 18999 } });
    const hit = effectiveCell(framedTable, "AU", "g1");
    expect(hit?.matchedZone).toBe("ROW");
    expect(hit?.cell).toEqual({ first: 5439, additional: 5229 });
    expect(isExcluded(exclusions[framed.classKey], framedTable, "AU", "g1")).toBe(false);
    expect(isExcluded(exclusions[framed.classKey], framedTable, "AU", "g4")).toBe(true);

    const small = simulateCart(
      [{ classKey: framed.classKey, group: "g1", quantity: 1 }],
      "AU",
      tables,
      NONE,
      exclusions,
    );
    expect(small.status).toBe("ok");
    expect((small as SimOk).trueCents).toBe(5439); // ROW first-item rate
    expect((small as SimOk).chargedCents).toBe(5439); // single-group profile is exact

    const big = simulateCart(
      [{ classKey: framed.classKey, group: "g4", quantity: 1 }],
      "AU",
      tables,
      NONE,
      exclusions,
    );
    expect(big.status).toBe("blocked");
  });

  it("is penny-exact for same-group carts (per-group profiles)", () => {
    // 3 × g3 to Canada: 48.79 + 2 × 24.99 = 98.77
    const sim = simulateCart(
      [{ classKey: framed.classKey, group: "g3", quantity: 3 }],
      "CA",
      tables,
      NONE,
      exclusions,
    ) as SimOk;
    expect(sim.status).toBe("ok");
    expect(sim.trueCents).toBe(9877);
    expect(sim.chargedCents).toBe(9877);
  });

  it("rounds a single US g1 up to 11.95 with up95", () => {
    const sim = simulateCart(
      [{ classKey: framed.classKey, group: "g1", quantity: 1 }],
      "US",
      tables,
      DEFAULT_BAND_CONFIG,
      exclusions,
    ) as SimOk;
    expect(sim.trueCents).toBe(1189);
    expect(sim.chargedCents).toBe(1195);
  });

  it("cross-group mix overcharges by exactly the extra profile deltas", () => {
    // g1 + g4 to US: true = 20.79 + 5.99; charged = 11.89 + 20.79.
    const sim = simulateCart(
      [
        { classKey: framed.classKey, group: "g1", quantity: 1 },
        { classKey: framed.classKey, group: "g4", quantity: 1 },
      ],
      "US",
      tables,
      NONE,
      exclusions,
    ) as SimOk;
    expect(sim.trueCents).toBe(2678);
    expect(sim.chargedCents).toBe(3268);
    expect(sim.overshootCents).toBe(590); // = g1 delta (11.89 − 5.99)
    expect(sim.crossProfilePenaltyCents).toBe(590);
    expect(sim.overshootCents).toBeLessThanOrEqual(allowedOvershootCents(sim, NONE));
  });

  it("caps runaway carts in the open band, still ≥ true cost", () => {
    // Quantity pinned above maxBands so this stays the deterministic open-band
    // coverage regardless of the configured band count (maxBands=20 post-probe).
    const qty = DEFAULT_BAND_CONFIG.maxBands + 3;
    const sim = simulateCart(
      [{ classKey: framed.classKey, group: "g1", quantity: qty }],
      "US",
      tables,
      NONE,
      exclusions,
    ) as SimOk;
    expect(sim.hitOpenBand).toBe(true);
    expect(sim.trueCents).toBe(1189 + (qty - 1) * 599);
    expect(sim.chargedCents).toBeGreaterThanOrEqual(sim.trueCents);
  });
});

// ── Golden: other classes ─────────────────────────────────────────────────────

describe("golden pillow 223:10 and tee 6:99", () => {
  it("tee is a single group → one shared profile, penny-exact for any quantity", () => {
    expect(teeTable.groups.map((g) => g.group)).toEqual(["g1"]);
    const profiles = planClassProfiles(teeTable, exclusions[tee.classKey]);
    expect(profiles.map((p) => p.key)).toEqual(["6:99#all"]);
    const cell = teeTable.rates["US"]["g1"];
    for (const qty of [1, 2, 5, 9]) {
      const sim = simulateCart(
        [{ classKey: tee.classKey, group: "g1", quantity: qty }],
        "US",
        tables,
        NONE,
        exclusions,
      ) as SimOk;
      expect(sim.status).toBe("ok");
      expect(sim.trueCents).toBe(cell.first + (qty - 1) * cell.additional);
      expect(sim.chargedCents).toBe(sim.trueCents);
    }
  });

  it("pillow has 4 groups and 29 zones incl ROW", () => {
    expect(pillowTable.groups).toHaveLength(4);
    expect(Object.keys(pillowTable.rates)).toContain("ROW");
    expect(Object.keys(pillowTable.rates).length).toBeGreaterThanOrEqual(20);
  });

  it("cross-class US cart (framed g1 + pillow + tee) sums three profiles within tolerance", () => {
    const cart: CartItem[] = [
      { classKey: framed.classKey, group: "g1", quantity: 1 },
      { classKey: pillow.classKey, group: pillowTable.groups[0].group, quantity: 1 },
      { classKey: tee.classKey, group: "g1", quantity: 2 },
    ];
    const sim = simulateCart(cart, "US", tables, DEFAULT_BAND_CONFIG, exclusions) as SimOk;
    expect(sim.status).toBe("ok");
    // Cross-class stacking mirrors Printify billing — no cross-profile penalty.
    expect(sim.crossProfilePenaltyCents).toBe(0);
    expect(sim.overshootCents).toBeGreaterThanOrEqual(0);
    expect(sim.overshootCents).toBeLessThanOrEqual(allowedOvershootCents(sim, DEFAULT_BAND_CONFIG));
  });
});

// ── Engine invariants ─────────────────────────────────────────────────────────

describe("band generation invariants", () => {
  it("pseudo-weights equal reference-zone additional cents", () => {
    expect(referenceZone(framedTable)).toBe("US");
    expect(computePseudoWeights(framedTable)).toEqual({ g1: 599, g2: 599, g3: 589, g4: 999 });
  });

  it("band prices are monotonically non-decreasing in weight", () => {
    for (const table of Object.values(tables)) {
      const excluded = exclusions[table.classKey];
      for (const profile of planClassProfiles(table, excluded)) {
        for (const zone of Object.keys(table.rates)) {
          const zb = generateProfileZoneBands(table, profile, zone, excluded, NONE);
          if (!zb) continue;
          for (let i = 1; i < zb.bands.length; i++) {
            expect(zb.bands[i].priceCents).toBeGreaterThanOrEqual(zb.bands[i - 1].priceCents);
          }
          // Contiguous coverage from 0 grams upward, open-ended tail.
          expect(zb.bands[0].lowerGrams).toBe(0);
          expect(zb.bands[zb.bands.length - 1].upperGrams).toBeNull();
        }
      }
    }
  });

  it("omits zones where every group is excluded", () => {
    const g4Profile = planClassProfiles(framedTable, exclusions[framed.classKey]).find(
      (p) => p.key === "540:99#g4",
    )!;
    expect(
      generateProfileZoneBands(framedTable, g4Profile, "AU", exclusions[framed.classKey], NONE),
    ).toBeNull();
    expect(
      generateProfileZoneBands(framedTable, g4Profile, "US", exclusions[framed.classKey], NONE),
    ).not.toBeNull();
  });
});

// ── Property harness (seeded, deterministic) ─────────────────────────────────

const SEED = 20260823;
const ITERATIONS = 5000;

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function pick<T>(rng: () => number, arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

describe(`property harness (seed ${SEED}, ${ITERATIONS} carts)`, () => {
  const zoneUniverse = Array.from(
    new Set([
      ...FIXTURES.flatMap((f) => f.rates.map((r) => r.zone)),
      // Fallthrough-only destinations (no explicit row anywhere or somewhere).
      "AU",
      "JP",
      "BR",
      "NZ",
      "SG",
      "ZA",
    ]),
  );

  function randomCart(rng: () => number): CartItem[] {
    const classCount = 1 + Math.floor(rng() * 3);
    const chosen = new Set<string>();
    const cart: CartItem[] = [];
    for (let i = 0; i < classCount; i++) {
      const f = pick(rng, FIXTURES);
      if (chosen.has(f.classKey)) continue;
      chosen.add(f.classKey);
      const groupCount = 1 + Math.floor(rng() * Math.min(3, f.groups.length));
      const groups = new Set<string>();
      for (let j = 0; j < groupCount; j++) groups.add(pick(rng, f.groups).group);
      for (const group of Array.from(groups)) {
        cart.push({ classKey: f.classKey, group, quantity: 1 + Math.floor(rng() * 14) });
      }
    }
    // Keep total ≤ 15 units per the spec's cart profile.
    let total = cart.reduce((s, i) => s + i.quantity, 0);
    for (const item of cart) {
      if (total <= 15) break;
      const trim = Math.min(item.quantity - 1, total - 15);
      item.quantity -= trim;
      total -= trim;
    }
    return cart;
  }

  it("charged ≥ true always; overshoot within tolerance off the open band", () => {
    const rng = makeRng(SEED);
    let ok = 0;
    let blocked = 0;
    let openBand = 0;
    for (let i = 0; i < ITERATIONS; i++) {
      const cart = randomCart(rng);
      const zone = pick(rng, zoneUniverse);

      const expectBlocked = cart.some((item) => {
        const f = FIXTURES.find((x) => x.classKey === item.classKey)!;
        const row = fixtureRate(f, zone, item.group);
        return !row || !row.shippable;
      });

      const simNone = simulateCart(cart, zone, tables, NONE, exclusions);
      const sim95 = simulateCart(cart, zone, tables, DEFAULT_BAND_CONFIG, exclusions);

      // Blocking must match the independent fixture-rate oracle exactly.
      expect(simNone.status).toBe(expectBlocked ? "blocked" : "ok");
      expect(sim95.status).toBe(simNone.status);
      if (simNone.status !== "ok" || sim95.status !== "ok") {
        blocked++;
        continue;
      }
      ok++;

      // Hard floor: never undercharge, with or without cosmetic rounding.
      expect(simNone.chargedCents).toBeGreaterThanOrEqual(simNone.trueCents);
      expect(sim95.chargedCents).toBeGreaterThanOrEqual(simNone.chargedCents);
      expect(sim95.chargedCents - simNone.chargedCents).toBeLessThanOrEqual(
        99 * simNone.profilesUsed,
      );

      if (simNone.hitOpenBand) {
        openBand++;
        continue; // generous cap by design — reported, not tolerance-checked
      }
      expect(simNone.overshootCents).toBeLessThanOrEqual(allowedOvershootCents(simNone, NONE));
      expect(sim95.overshootCents).toBeLessThanOrEqual(
        allowedOvershootCents(sim95, DEFAULT_BAND_CONFIG),
      );
    }
    // The harness must exercise ok and blocked. With maxBands=20 (post-probe)
    // the spec cart profile (≤15 units) rarely reaches the open band — heavy
    // groups on shared profiles can still hit it, so it is tracked but not
    // required; deterministic open-band coverage lives in the runaway golden.
    expect(ok).toBeGreaterThan(ITERATIONS / 2);
    expect(blocked).toBeGreaterThan(0);
    expect(openBand).toBeGreaterThanOrEqual(0);
  });

  it("same-group carts on single-group profiles are penny-exact (rounding none)", () => {
    const rng = makeRng(SEED + 1);
    let checked = 0;
    for (let i = 0; i < 1500; i++) {
      const f = pick(rng, FIXTURES);
      const table = tables[f.classKey];
      const excluded = exclusions[f.classKey];
      const group = pick(rng, f.groups).group;
      const profiles = planClassProfiles(table, excluded);
      const profile = profiles.find((p) => p.groups.some((g) => g.group === group))!;
      if (profile.groups.length !== 1) continue; // shared profiles may approximate
      const qty = 1 + Math.floor(rng() * DEFAULT_BAND_CONFIG.maxBands);
      const zone = pick(rng, zoneUniverse);
      const sim = simulateCart(
        [{ classKey: f.classKey, group, quantity: qty }],
        zone,
        tables,
        NONE,
        exclusions,
      );
      if (sim.status !== "ok" || sim.hitOpenBand) continue;
      expect(sim.chargedCents).toBe(sim.trueCents);
      checked++;
    }
    expect(checked).toBeGreaterThan(300);
  });
});
