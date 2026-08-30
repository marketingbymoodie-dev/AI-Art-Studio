import { describe, expect, it } from "vitest";
import {
  normalizeVariantLabelForCostMatch,
  resolveVariantCostCents,
  variantCostLabelsMatch,
} from "./printifyCostLabels";

describe("variantCostLabelsMatch", () => {
  it("matches size / colour in either order", () => {
    expect(variantCostLabelsMatch("XS / Solid Black", "Solid Black / XS")).toBe(true);
    expect(variantCostLabelsMatch("4XL / Solid White", "4XL / Solid White")).toBe(true);
  });

  it("does not treat 4XL as XL or 5XL as S", () => {
    expect(variantCostLabelsMatch("4XL / Solid Black", "XL / Solid Black")).toBe(false);
    expect(variantCostLabelsMatch("5XL / Solid Black", "S / Solid Black")).toBe(false);
    expect(variantCostLabelsMatch("2XL / Solid Black", "XL / Solid Black")).toBe(false);
    expect(variantCostLabelsMatch("XS / Solid Black", "S / Solid Black")).toBe(false);
  });

  it("treats Solid prefix and grey/gray as the same colour", () => {
    expect(variantCostLabelsMatch("M / Solid Black", "M / Black")).toBe(true);
    expect(variantCostLabelsMatch("L / Heather Grey", "L / Heather Gray")).toBe(true);
  });

  it("matches weekender-style One Size / colour to a colour-only Printify title", () => {
    expect(variantCostLabelsMatch("One Size / Black", "Black")).toBe(true);
    expect(variantCostLabelsMatch("One size / Navy", "Navy")).toBe(true);
    expect(variantCostLabelsMatch("Black", "One Size / Black")).toBe(true);
    expect(variantCostLabelsMatch("one_size / Black", "Black")).toBe(true);
  });

  it("does not treat a real apparel size as a colour-only Printify title", () => {
    expect(variantCostLabelsMatch("S / Black", "Black")).toBe(false);
    expect(variantCostLabelsMatch("4XL / Black", "Black")).toBe(false);
  });

  it("treats tote hyphen / x / spaced dimensions as the same size", () => {
    expect(normalizeVariantLabelForCostMatch("16-16")).toBe("16x16");
    expect(normalizeVariantLabelForCostMatch("16 x 16")).toBe("16x16");
    expect(normalizeVariantLabelForCostMatch('16" x 16"')).toBe("16x16");
    expect(variantCostLabelsMatch("16-16", "16 x 16")).toBe(true);
    expect(variantCostLabelsMatch('16" x 16"', "16-16")).toBe(true);
    expect(variantCostLabelsMatch("18-18", "18x18")).toBe(true);
    expect(variantCostLabelsMatch('16" x 16" / Natural', "16-16")).toBe(true);
    expect(variantCostLabelsMatch('16" x 16" / Natural', "16 x 16")).toBe(true);
  });

  it("does not treat apparel letter sizes as size-only matches", () => {
    expect(variantCostLabelsMatch("4XL / Solid Black", "4XL")).toBe(false);
    expect(variantCostLabelsMatch("S / Solid Black", "S")).toBe(false);
  });
});

describe("resolveVariantCostCents", () => {
  const labels = {
    "1": "S / Solid Black",
    "2": "XL / Solid Black",
    "3": "4XL / Solid Black",
    "4": "5XL / Solid Black",
  };
  const front = { "1": 1163, "2": 1409, "3": 1796, "4": 1930 };
  const both = { "1": 1762, "2": 2010, "3": 2400, "4": 2550 };

  it("does not assign XL front cost to a 4XL wizard row", () => {
    const cost = resolveVariantCostCents(
      { id: "size:4XL:black", title: "4XL / Solid Black" },
      { costs: front, printifyVariantLabels: labels },
    );
    expect(cost).toBe(1796);
  });

  it("uses the both-side map instead of front costs", () => {
    const cost = resolveVariantCostCents(
      { id: "size:S:black", title: "S / Solid Black" },
      { costs: both, printifyVariantLabels: labels },
    );
    expect(cost).toBe(1762);
  });

  it("reads the both-tier normalized label map when the caller passes it", () => {
    const cost = resolveVariantCostCents(
      { id: "size:S:black", title: "S / Solid Black" },
      { costsByNormalizedLabel: { "s / solid black": 1762 } },
    );
    expect(cost).toBe(1762);
  });

  it("matches reversed Printify labels", () => {
    const cost = resolveVariantCostCents(
      { id: "size:4XL:white", title: "4XL / Solid White" },
      {
        costs: { "9": 1796 },
        printifyVariantLabels: { "9": "Solid White / 4XL" },
      },
    );
    expect(cost).toBe(1796);
  });

  it("resolves weekender One Size rows against colour-only PI labels", () => {
    const cost = resolveVariantCostCents(
      { id: "size:one_size:black", title: "One Size / Black" },
      {
        costs: { "4411": 2499 },
        printifyVariantLabels: { "4411": "Black" },
      },
    );
    expect(cost).toBe(2499);
  });

  it("maps tote wizard rows to hyphenated variantKeyCosts / unnormalized labels", () => {
    const variantKeyCosts = { "16-16": 1888, "18-18": 2002 };
    const costsByNormalizedLabel = { "16 x 16": 1888, "18 x 18": 2002 };

    expect(
      resolveVariantCostCents(
        { id: "size:16x16", title: '16" x 16"' },
        { variantKeyCosts },
      ),
    ).toBe(1888);
    expect(
      resolveVariantCostCents(
        { id: "size:18x18", title: "18 x 18" },
        { costsByNormalizedLabel },
      ),
    ).toBe(2002);
    expect(
      resolveVariantCostCents(
        { id: "size:16-16", title: "16-16" },
        { costsByNormalizedLabel },
      ),
    ).toBe(1888);
    expect(
      resolveVariantCostCents(
        { id: "size:16x16:natural", title: '16" x 16" / Natural' },
        { variantKeyCosts, costsByNormalizedLabel },
      ),
    ).toBe(1888);
  });
});
