import { describe, expect, it } from "vitest";
import {
  describeDivergence,
  describeProductTypeBinding,
  findDivergentProductTypes,
  type BindingProductType,
} from "./productTypeBinding";

const tee = "Men's Lightweight Fashion Tee";
const types: BindingProductType[] = [
  { productTypeId: 5, title: tee, productId: "8703976636650", printifyBlueprintId: 26, printifyProviderId: 99 },
  { productTypeId: 14, title: tee, productId: null, printifyBlueprintId: 26, printifyProviderId: 29 },
  { productTypeId: 15, title: tee, productId: "8704471498986", printifyBlueprintId: 26, printifyProviderId: 217 },
  { productTypeId: 30, title: tee, productId: "8772967039210", printifyBlueprintId: 26, printifyProviderId: 99 },
  { productTypeId: 13, title: "Unisex Cotton Crew Tee", productId: "1", printifyBlueprintId: 5, printifyProviderId: 99 },
];
const pages = [
  { handle: "petposterous-tee", productTypeId: 15 },
  { handle: "men-s-lightweight-fashion-tee", productTypeId: 30 },
];

describe("productTypeBinding", () => {
  it("formats the binding line", () => {
    expect(describeProductTypeBinding({ productTypeId: 30, title: tee, providerId: 99 })).toBe(
      "pt 30 — Men's Lightweight Fashion Tee, Printify provider 99",
    );
  });

  it("flags configured types for the same blueprint only", () => {
    const out = findDivergentProductTypes(30, 26, types, pages);
    expect(out.map((d) => d.productTypeId)).toEqual([5, 15]);
    expect(out.find((d) => d.productTypeId === 15)?.pageHandles).toEqual(["petposterous-tee"]);
  });

  it("names both types in the warning", () => {
    const [, pt15] = findDivergentProductTypes(30, 26, types, pages);
    const msg = describeDivergence({ productTypeId: 30 }, pt15);
    expect(msg).toContain("pt 15");
    expect(msg).toContain("Printify provider 217");
    expect(msg).toContain("/pages/petposterous-tee");
    expect(msg).toContain("pt 30");
  });

  it("is empty when the type is the only one set up", () => {
    expect(findDivergentProductTypes(13, 5, types, pages)).toEqual([]);
  });
});
