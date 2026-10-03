import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyPrintSidesToRestProduct,
  bothTierPriceUpdates,
  printSidesActiveForProductType,
  printSidesFactorForProductType,
} from "./print-sides";

const bothCosts = JSON.stringify({ front: { "100": 1000, "101": 1100 }, both: { "100": 1500, "101": 1600 } });

const pt = {
  printifyCosts: bothCosts,
  defaultMarkupPercent: 100,
  variantMap: JSON.stringify({ "s:black": { printifyVariantId: 100 }, "m:black": { printifyVariantId: 101 } }),
  sizes: JSON.stringify([
    { id: "s", name: "S" },
    { id: "m", name: "M" },
  ]),
  frameColors: JSON.stringify([{ id: "black", name: "Black" }]),
};

let prevFlag: string | undefined;
beforeEach(() => {
  prevFlag = process.env.PRINT_SIDES_OPTION_ENABLED;
});
afterEach(() => {
  if (prevFlag === undefined) delete process.env.PRINT_SIDES_OPTION_ENABLED;
  else process.env.PRINT_SIDES_OPTION_ENABLED = prevFlag;
});

function restBody() {
  return {
    variants: [
      { option1: "S", option2: "Black", price: "20.00", sku: "SKU-S" },
      { option1: "M", option2: "Black", price: "22.00", sku: "SKU-M" },
    ] as any[],
    options: [
      { name: "Size", values: ["S", "M"] },
      { name: "Color", values: ["Black"] },
    ],
  };
}

describe("env gate", () => {
  it("is off unless PRINT_SIDES_OPTION_ENABLED=true", () => {
    delete process.env.PRINT_SIDES_OPTION_ENABLED;
    expect(printSidesActiveForProductType(pt)).toBe(false);
    expect(printSidesFactorForProductType(pt)).toBe(1);
    process.env.PRINT_SIDES_OPTION_ENABLED = "true";
    expect(printSidesActiveForProductType(pt)).toBe(true);
    expect(printSidesFactorForProductType(pt)).toBe(2);
    expect(printSidesFactorForProductType({ ...pt, printSidesEnabled: false })).toBe(1);
  });
});

describe("applyPrintSidesToRestProduct", () => {
  it("is a no-op with the flag off (legacy products unchanged)", () => {
    delete process.env.PRINT_SIDES_OPTION_ENABLED;
    const { variants, options } = restBody();
    expect(applyPrintSidesToRestProduct(pt, variants, options)).toBe(2);
    expect(options).toHaveLength(2);
    expect(variants.every((v) => v.option3 === undefined)).toBe(true);
  });

  it("adds option3 and one Front + Back twin per blank, priced above Front", () => {
    process.env.PRINT_SIDES_OPTION_ENABLED = "true";
    const { variants, options } = restBody();
    expect(applyPrintSidesToRestProduct(pt, variants, options)).toBe(4);
    expect(options[2]).toEqual({ name: "Print sides", values: ["Front", "Front + Back"] });
    expect(variants.map((v) => v.option3)).toEqual(["Front", "Front", "Front + Back", "Front + Back"]);
    expect(variants[2].sku).toBe("SKU-S-FB");
    expect(parseFloat(variants[2].price)).toBeGreaterThan(20);
    expect(parseFloat(variants[3].price)).toBeGreaterThan(22);
  });

  it("uses option2 for size-only products", () => {
    process.env.PRINT_SIDES_OPTION_ENABLED = "true";
    const variants: any[] = [{ option1: "11oz", price: "15.00" }];
    const options = [{ name: "Size", values: ["11oz"] }];
    applyPrintSidesToRestProduct(pt, variants, options);
    expect(variants.map((v) => v.option2)).toEqual(["Front", "Front + Back"]);
  });

  it("skips product types without both-side costs", () => {
    process.env.PRINT_SIDES_OPTION_ENABLED = "true";
    const { variants, options } = restBody();
    const frontOnly = { ...pt, printifyCosts: JSON.stringify({ front: { "100": 1000 }, both: {} }) };
    expect(applyPrintSidesToRestProduct(frontOnly, variants, options)).toBe(2);
  });
});

describe("bothTierPriceUpdates", () => {
  const live = [
    { id: 1, option1: "S", option2: "Black", option3: "Front", price: "20.00" },
    { id: 2, option1: "M", option2: "Black", option3: "Front", price: "22.00" },
    { id: 11, option1: "S", option2: "Black", option3: "Front + Back", price: "20.00" },
    { id: 12, option1: "M", option2: "Black", option3: "Front + Back", price: "22.00" },
  ];

  it("returns nothing for legacy products", () => {
    const legacy = live.slice(0, 2).map(({ option3, ...v }) => v);
    expect(bothTierPriceUpdates({ productType: pt, liveVariants: legacy }).size).toBe(0);
  });

  it("prices only Front + Back variants, above their Front twin", () => {
    const out = bothTierPriceUpdates({ productType: pt, liveVariants: live });
    expect([...out.keys()].sort()).toEqual([11, 12]);
    expect(parseFloat(out.get(11)!)).toBeGreaterThan(20);
    expect(parseFloat(out.get(12)!)).toBeGreaterThan(22);
  });

  it("follows a pending Front price change", () => {
    const out = bothTierPriceUpdates({
      productType: { ...pt, printifyCosts: "{}" },
      liveVariants: live,
      pendingFrontPrices: new Map([[1, "40.00"]]),
    });
    expect(parseFloat(out.get(11)!)).toBeGreaterThan(40);
  });

  it("uses an explicit both map from the request", () => {
    const out = bothTierPriceUpdates({
      productType: pt,
      liveVariants: live,
      variantPricesBoth: { "S:Black": "31.95", "M:Black": "33.95" },
    });
    expect(out.get(11)).toBe("31.95");
    expect(out.get(12)).toBe("33.95");
  });

  it("never prices a Front + Back variant without its Front twin", () => {
    const orphan = [live[0], live[3]];
    expect(bothTierPriceUpdates({ productType: pt, liveVariants: orphan }).size).toBe(0);
  });
});
