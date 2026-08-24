import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  buildSizeDownsell,
  canonicalSizeToken,
  evaluateSizeCountryCoverage,
  filterCatalogSizesForCountry,
  findSizeCoverageRow,
  formatUsdCents,
  listSizeCoverageFromMatrix,
  resolveVariantGroupForSelection,
  shippingGenerateBlockResponse,
  spendStudioCreditIfCoverageAllows,
  type SizeColorMapping,
  type SizeCoverageRate,
} from "./shipping-size-coverage";

type Fixture493 = {
  classKey: string;
  productTypeId: number;
  mappings: SizeColorMapping[];
  rates: SizeCoverageRate[];
};

type Fixture540 = {
  rates: Array<{
    zone: string;
    group: string;
    first: number;
    additional: number;
    tier: string;
    shippable: boolean;
  }>;
};

function loadJson<T>(slug: string): T {
  return JSON.parse(
    readFileSync(path.join(__dirname, "__fixtures__", "shipping", `${slug}.json`), "utf8"),
  ) as T;
}

const framedH = loadJson<Fixture493>("framed-horizontal-493-36");
const framedV = loadJson<Fixture540>("framed-vertical-540-99");

const framedVMappings: SizeColorMapping[] = [
  { sizeColorKey: "11-x-14:black", variantGroup: "g1" },
  { sizeColorKey: "12-x-16:black", variantGroup: "g2" },
  { sizeColorKey: "16-x-16:black", variantGroup: "g2" },
  { sizeColorKey: "16-x-20:black", variantGroup: "g3" },
  { sizeColorKey: "12-x-36:black", variantGroup: "g4" },
  { sizeColorKey: "20-x-30:black", variantGroup: "g4" },
  { sizeColorKey: "20-x-30:white", variantGroup: "g4" },
];

const framedVRates: SizeCoverageRate[] = framedV.rates.map((r) => ({
  countryCode: r.zone,
  variantGroup: r.group,
  firstItemCents: r.first,
  additionalCents: r.additional,
  shippable: r.shippable,
  tier: r.tier,
}));

describe("canonicalSizeToken (shared normalizer)", () => {
  it("collapses live 493:36 11×8 spellings to one token", () => {
    expect(canonicalSizeToken("11-x-8")).toBe("11x8");
    expect(canonicalSizeToken("11x8")).toBe("11x8");
    expect(canonicalSizeToken('11" x 8"')).toBe("11x8");
    expect(canonicalSizeToken("11″ x 8″")).toBe("11x8");
  });
});

describe("resolveVariantGroupForSelection — 493:36 live key", () => {
  it("pins 11×8 to g1 from ingest (label 11-x-8, keys 11-x-8:black|white)", () => {
    for (const size of ["11-x-8", "11x8", '11" x 8"', "11″ x 8″"]) {
      const hit = resolveVariantGroupForSelection({
        mappings: framedH.mappings,
        size,
        color: "black",
      });
      expect(hit, size).toEqual({
        ok: true,
        variantGroup: "g1",
        sizeId: "11-x-8",
        colorId: "black",
      });
    }
  });

  it("fail-closes when size is present but colour is not in the map", () => {
    const hit = resolveVariantGroupForSelection({
      mappings: framedH.mappings,
      size: "11-x-8",
      color: "oak",
    });
    expect(hit).toMatchObject({
      ok: false,
      reason: "color_unmapped",
      sizePresent: true,
      sizeId: "11-x-8",
    });
  });

  it("fail-closes when the product has no mappings", () => {
    const hit = resolveVariantGroupForSelection({
      mappings: [],
      size: "11-x-8",
      color: "black",
    });
    expect(hit).toMatchObject({ ok: false, reason: "no_matrix" });
  });
});

describe("493:36 11×8 AU (live ingest)", () => {
  it("AU has no exact zone — falls to ROW g1 warned (allowed, not excluded)", () => {
    const verdict = evaluateSizeCountryCoverage({
      mappings: framedH.mappings,
      rates: framedH.rates,
      size: "11-x-8",
      color: "black",
      country: "AU",
    });
    expect(verdict.variantGroup).toBe("g1");
    expect(verdict.matchedZone).toBe("ROW");
    expect(verdict.tier).toBe("warned");
    expect(verdict.allowed).toBe(true);
    expect(verdict.firstItemCents).toBe(4999);
    expect(shippingGenerateBlockResponse(verdict, framedH.productTypeId)).toBeNull();
  });

  it("409s if AU/g1 is excluded (the per-size cell the gate must honor)", () => {
    const verdict = evaluateSizeCountryCoverage({
      mappings: framedH.mappings,
      rates: [
        ...framedH.rates,
        {
          countryCode: "AU",
          variantGroup: "g1",
          firstItemCents: 19759,
          additionalCents: 18999,
          shippable: false,
          tier: "excluded",
        },
      ],
      size: "11x8",
      color: "white",
      country: "AU",
    });
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toBe("excluded");
    expect(verdict.variantGroup).toBe("g1");
    const body = shippingGenerateBlockResponse(verdict, framedH.productTypeId);
    expect(body).toMatchObject({
      error: "SHIPPING_EXCLUDED",
      code: "SHIPPING_EXCLUDED",
      country: "AU",
      sizeId: "11-x-8",
      productTypeId: 20,
      variantGroup: "g1",
      suggestedSizeId: expect.any(String),
    });
    expect(body?.shipsToSizes.some((s) => s.sizeId === "24-x-18")).toBe(true);
    expect(body?.shipsToSizes.some((s) => s.sizeId === "11-x-8")).toBe(false);
  });
});

describe("540:99 g4 AU (excluded)", () => {
  it("20×30 and 12×36 resolve to g4 and refuse AU before generate", () => {
    for (const size of ["20-x-30", "20x30", '20" x 30"', "12-x-36", "12x36"]) {
      const verdict = evaluateSizeCountryCoverage({
        mappings: framedVMappings,
        rates: framedVRates,
        size,
        color: "black",
        country: "AU",
      });
      expect(verdict.variantGroup, size).toBe("g4");
      expect(verdict.allowed, size).toBe(false);
      expect(verdict.reason, size).toBe("excluded");
      expect(verdict.matchedZone, size).toBe("AU");
      expect(verdict.tier, size).toBe("excluded");
      const body = shippingGenerateBlockResponse(verdict, 540);
      expect(body?.error, size).toBe("SHIPPING_EXCLUDED");
      expect(body?.shipsToSizes.some((s) => s.sizeId === "11-x-14"), size).toBe(true);
    }
  });

  it("fail-closes when there is no matrix/rate row", () => {
    const verdict = evaluateSizeCountryCoverage({
      mappings: framedVMappings,
      rates: [],
      size: "20-x-30",
      color: "black",
      country: "AU",
    });
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toBe("no_rate");
    expect(shippingGenerateBlockResponse(verdict, 540)?.error).toBe("SHIPPING_UNMAPPED");
  });
});

describe("409 payload shape", () => {
  it("returns the Slice A contract fields for 540:99 g4 AU", () => {
    const verdict = evaluateSizeCountryCoverage({
      mappings: framedVMappings,
      rates: framedVRates,
      size: "20-x-30",
      color: "black",
      country: "AU",
    });
    const body = shippingGenerateBlockResponse(verdict, 540);
    expect(body).toEqual({
      error: "SHIPPING_EXCLUDED",
      code: "SHIPPING_EXCLUDED",
      message: "This size cannot ship to AU. Choose a size that does, or change your shipping country.",
      country: "AU",
      productTypeId: 540,
      sizeId: "20-x-30",
      colorId: "black",
      variantGroup: "g4",
      matchedZone: "AU",
      tier: "excluded",
      reason: "excluded",
      firstItemCents: 19759,
      shipsToSizes: expect.arrayContaining([
        expect.objectContaining({ sizeId: "11-x-14", shippable: true }),
      ]),
      suggestedSizeId: "11-x-14",
    });
    expect(body?.shipsToSizes.every((s) => s.shippable)).toBe(true);
    expect(Object.keys(body || {}).sort()).toEqual([
      "code",
      "colorId",
      "country",
      "error",
      "firstItemCents",
      "matchedZone",
      "message",
      "productTypeId",
      "reason",
      "shipsToSizes",
      "sizeId",
      "suggestedSizeId",
      "tier",
      "variantGroup",
    ]);
  });
});

describe("Slice B: selector country feeds the generate gate", () => {
  it("AU cookie resolution blocks 540:99 g4 and does not spend", async () => {
    const { resolveShipCountryDecision } = await import("./ship-country");
    const decided = resolveShipCountryDecision({ cookieCountry: "au", ipCountry: "US" });
    expect(decided).toEqual({ country: "AU", source: "cookie" });
    const verdict = evaluateSizeCountryCoverage({
      mappings: framedVMappings,
      rates: framedVRates,
      size: "20-x-30",
      color: "black",
      country: decided.country,
    });
    const result = await spendStudioCreditIfCoverageAllows({
      verdict,
      productTypeId: 540,
      spend: async () => {
        throw new Error("spend must not run");
      },
    });
    expect(result.spent).toBe(false);
    expect(result.blocked?.code).toBe("SHIPPING_EXCLUDED");
    expect(result.blocked?.country).toBe("AU");
    expect(result.blocked?.variantGroup).toBe("g4");
  });
});

describe("Slice C: dropdown + downsell + warned estimate", () => {
  const framedVCatalog = [
    { id: "11-x-14", name: "11×14" },
    { id: "12-x-16", name: "12×16" },
    { id: "16-x-16", name: "16×16" },
    { id: "16-x-20", name: "16×20" },
    { id: "12-x-36", name: "12×36" },
    { id: "20-x-30", name: "20×30" },
  ];

  it("AU dropdown on 540 omits g4 sizes (12×36, 20×30)", () => {
    const rows = listSizeCoverageFromMatrix({
      mappings: framedVMappings,
      rates: framedVRates,
      country: "AU",
    });
    const visible = filterCatalogSizesForCountry(framedVCatalog, rows);
    expect(visible.map((s) => s.id)).toEqual(["11-x-14", "12-x-16", "16-x-16", "16-x-20"]);
    expect(visible.some((s) => s.id === "12-x-36" || s.id === "20-x-30")).toBe(false);
    expect(rows.filter((r) => r.variantGroup === "g4").every((r) => !r.shippable)).toBe(true);
  });

  it("deep-linked 540 g4 AU lands in a downsell, not a dead end", () => {
    const rows = listSizeCoverageFromMatrix({
      mappings: framedVMappings,
      rates: framedVRates,
      country: "AU",
    });
    const downsell = buildSizeDownsell({
      requestedSizeId: "20-x-30",
      country: "AU",
      rows,
    });
    expect(downsell).not.toBeNull();
    expect(downsell?.requestedSizeId).toBe("20-x-30");
    expect(downsell?.shipsToSizes.length).toBeGreaterThan(0);
    expect(downsell?.shipsToSizes.every((s) => s.shippable)).toBe(true);
    expect(downsell?.shipsToSizes.some((s) => s.sizeId === "20-x-30")).toBe(false);
    expect(downsell?.suggestedSizeId).toBeTruthy();
  });

  it("11×8 → AU warned estimate is ROW $49.99", () => {
    const rows = listSizeCoverageFromMatrix({
      mappings: framedH.mappings,
      rates: framedH.rates,
      country: "AU",
    });
    const row = findSizeCoverageRow("11-x-8", rows);
    expect(row).toMatchObject({
      shippable: true,
      tier: "warned",
      firstItemCents: 4999,
      matchedZone: "ROW",
    });
    expect(formatUsdCents(row?.firstItemCents)).toBe("$49.99");
    expect(buildSizeDownsell({ requestedSizeId: "11-x-8", country: "AU", rows })).toBeNull();
  });
});

describe("blocked generate does not spend a credit", () => {
  it("spendStudioCreditIfCoverageAllows skips spend on 540:99 g4 AU", async () => {
    const verdict = evaluateSizeCountryCoverage({
      mappings: framedVMappings,
      rates: framedVRates,
      size: "20-x-30",
      color: "black",
      country: "AU",
    });
    let spendCalls = 0;
    const result = await spendStudioCreditIfCoverageAllows({
      verdict,
      productTypeId: 540,
      spend: async () => {
        spendCalls += 1;
        return { spent: true };
      },
    });
    expect(result.spent).toBe(false);
    expect(spendCalls).toBe(0);
    expect(result.blocked?.code).toBe("SHIPPING_EXCLUDED");
  });
});
