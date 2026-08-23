import { describe, expect, it } from "vitest";
import {
  computeTableHash,
  deriveVariantGroups,
  evaluateTier,
  pickStandardMethod,
  stableStringify,
  DEFAULT_TIER_CONFIG,
  type NormalizedTable,
} from "./shipping-tables";

describe("pickStandardMethod", () => {
  it("prefers exact standard over economy/express", () => {
    expect(pickStandardMethod(["economy", "standard", "express"])).toBe("standard");
  });
  it("falls back to ground, then economy, then first", () => {
    expect(pickStandardMethod(["economy", "ground"])).toBe("ground");
    expect(pickStandardMethod(["economy", "express"])).toBe("economy");
    expect(pickStandardMethod(["priority"])).toBe("priority");
    expect(pickStandardMethod([])).toBeNull();
  });
});

describe("stableStringify / computeTableHash", () => {
  it("is insensitive to key order", () => {
    const a: NormalizedTable = {
      method: "standard",
      byVariant: { "1": { US: { first: 100, additional: 50 }, CA: { first: 200, additional: 90 } } },
    };
    const b: NormalizedTable = {
      method: "standard",
      byVariant: { "1": { CA: { additional: 90, first: 200 }, US: { additional: 50, first: 100 } } },
    };
    expect(stableStringify(a)).toBe(stableStringify(b));
    expect(computeTableHash(a)).toBe(computeTableHash(b));
  });
  it("changes when any rate changes", () => {
    const a: NormalizedTable = {
      method: "standard",
      byVariant: { "1": { US: { first: 100, additional: 50 } } },
    };
    const b: NormalizedTable = {
      method: "standard",
      byVariant: { "1": { US: { first: 101, additional: 50 } } },
    };
    expect(computeTableHash(a)).not.toBe(computeTableHash(b));
  });
});

describe("deriveVariantGroups (cross-zone grouping)", () => {
  it("splits variants that match in US but differ in CA — framed print example", () => {
    // 11x14 and 12x16 share the US rate but Canada prices them differently,
    // so cross-zone grouping must yield separate groups (spec 1.3).
    const table: NormalizedTable = {
      method: "standard",
      byVariant: {
        "101": { US: { first: 1189, additional: 599 }, CA: { first: 4589, additional: 2399 } }, // 11x14
        "102": { US: { first: 1189, additional: 599 }, CA: { first: 4679, additional: 2499 } }, // 12x16
        "103": { US: { first: 1189, additional: 599 }, CA: { first: 4679, additional: 2499 } }, // 16x16
        "104": { US: { first: 1639, additional: 589 }, CA: { first: 4879, additional: 2499 } }, // 16x20
      },
    };
    const { groups, groupByVariant } = deriveVariantGroups(table);
    expect(groups.length).toBe(3);
    expect(groupByVariant["101"]).not.toBe(groupByVariant["102"]);
    expect(groupByVariant["102"]).toBe(groupByVariant["103"]);
    expect(groupByVariant["104"]).not.toBe(groupByVariant["102"]);
  });

  it("orders groups cheapest-first by US first-item rate", () => {
    const table: NormalizedTable = {
      method: "standard",
      byVariant: {
        "9": { US: { first: 2079, additional: 999 } },
        "1": { US: { first: 1189, additional: 599 } },
      },
    };
    const { groups } = deriveVariantGroups(table);
    expect(groups[0].printifyVariantIds).toEqual(["1"]);
    expect(groups[1].printifyVariantIds).toEqual(["9"]);
  });
});

describe("evaluateTier (spec 0.4)", () => {
  const config = DEFAULT_TIER_CONFIG; // offer 40%, exclude 80%, cap $150

  it("normal below the offer threshold — US framed print", () => {
    const v = evaluateTier({
      firstItemCents: 1189,
      typicalRetailCents: 8995,
      config,
      absoluteCapCents: config.absoluteCapCents,
      manualRule: null,
    });
    expect(v.tier).toBe("normal");
    expect(v.shippable).toBe(true);
  });

  it("warned between thresholds — CA framed print", () => {
    const v = evaluateTier({
      firstItemCents: 4589,
      typicalRetailCents: 8995,
      config,
      absoluteCapCents: config.absoluteCapCents,
      manualRule: null,
    });
    expect(v.tier).toBe("warned");
    expect(v.shippable).toBe(true);
  });

  it("excluded above the exclude threshold — AU framed print", () => {
    const v = evaluateTier({
      firstItemCents: 19759,
      typicalRetailCents: 8995,
      config,
      absoluteCapCents: config.absoluteCapCents,
      manualRule: null,
    });
    expect(v.tier).toBe("excluded");
    expect(v.shippable).toBe(false);
  });

  it("absolute cap excludes even without retail data", () => {
    const v = evaluateTier({
      firstItemCents: 19759,
      typicalRetailCents: null,
      config,
      absoluteCapCents: config.absoluteCapCents,
      manualRule: null,
    });
    expect(v.tier).toBe("excluded");
    expect(v.tierReason).toBe("absolute_cap");
  });

  it("no retail and under cap → normal with no_retail reason", () => {
    const v = evaluateTier({
      firstItemCents: 4589,
      typicalRetailCents: null,
      config,
      absoluteCapCents: config.absoluteCapCents,
      manualRule: null,
    });
    expect(v.tier).toBe("normal");
    expect(v.tierReason).toBe("no_retail");
  });

  it("manual rules override thresholds in both directions", () => {
    const blocked = evaluateTier({
      firstItemCents: 100,
      typicalRetailCents: 8995,
      config,
      absoluteCapCents: config.absoluteCapCents,
      manualRule: "block",
    });
    expect(blocked.tier).toBe("excluded");
    expect(blocked.shippable).toBe(false);
    const allowed = evaluateTier({
      firstItemCents: 19759,
      typicalRetailCents: 8995,
      config,
      absoluteCapCents: config.absoluteCapCents,
      manualRule: "allow",
    });
    expect(allowed.tier).toBe("normal");
    expect(allowed.shippable).toBe(true);
  });
});
