import { describe, expect, it } from "vitest";
import {
  dedupeCreatePageBlanks,
  dedupeProductTypesForPicker,
} from "./productTypePicker";

describe("dedupeProductTypesForPicker", () => {
  it("keeps one row per blueprint+provider (newest id wins)", () => {
    const out = dedupeProductTypesForPicker([
      { id: 10, name: "Unisex Zip Hoodie (AOP)", printifyBlueprintId: 99, printifyProviderId: 1, sortOrder: 0 },
      { id: 25, name: "Unisex Zip Hoodie (AOP)", printifyBlueprintId: 99, printifyProviderId: 1, sortOrder: 0 },
      { id: 5, name: "Tumbler 20oz", printifyBlueprintId: 1, printifyProviderId: 2, sortOrder: 1 },
    ]);
    expect(out.map((p) => p.id)).toEqual([25, 5]);
  });

  it("does not merge different providers for the same blueprint", () => {
    const out = dedupeProductTypesForPicker([
      { id: 1, name: "Hoodie A", printifyBlueprintId: 99, printifyProviderId: 1 },
      { id: 2, name: "Hoodie B", printifyBlueprintId: 99, printifyProviderId: 2 },
    ]);
    expect(out).toHaveLength(2);
  });

  it("keeps rows without a blueprint distinct by id", () => {
    const out = dedupeProductTypesForPicker([
      { id: 1, name: "Custom", printifyBlueprintId: null },
      { id: 2, name: "Custom", printifyBlueprintId: null },
    ]);
    expect(out).toHaveLength(2);
  });
});

describe("dedupeCreatePageBlanks", () => {
  it("collapses synced + unsynced copies of the same blueprint", () => {
    const out = dedupeCreatePageBlanks(
      [
        {
          productTypeId: 10,
          title: "Comforter",
          printifyBlueprintId: 88,
          productId: null,
          needsShopifySync: true,
        },
        {
          productTypeId: 20,
          title: "Comforter",
          printifyBlueprintId: 88,
          productId: "gid://shopify/Product/1",
          needsShopifySync: false,
        },
      ],
      new Set(),
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.productTypeId).toBe(20);
  });

  it("keeps the Live page's product type when both copies exist", () => {
    const out = dedupeCreatePageBlanks(
      [
        {
          productTypeId: 10,
          title: "Bomber",
          printifyBlueprintId: 5,
          productId: "111",
          needsShopifySync: false,
        },
        {
          productTypeId: 11,
          title: "Bomber",
          printifyBlueprintId: 5,
          productId: null,
          needsShopifySync: true,
        },
      ],
      new Set([11]),
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.productTypeId).toBe(11);
  });

  it("does not merge different blueprints that share a similar name", () => {
    const out = dedupeCreatePageBlanks(
      [
        { productTypeId: 1, title: "Comforter", printifyBlueprintId: 88 },
        { productTypeId: 2, title: "Cotton Comforter", printifyBlueprintId: 99 },
      ],
      new Set(),
    );
    expect(out).toHaveLength(2);
  });
});
