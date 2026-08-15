import { describe, expect, it } from "vitest";
import {
  creatorMerchandiseMissingMessage,
  isCheckoutPublication,
  isMerchandiseMissingError,
  isPosPublication,
  partitionPublications,
} from "./shopify-publications";

describe("publication classification", () => {
  it("keeps Online Store and custom-app / Headless channels for checkout", () => {
    expect(isCheckoutPublication("Online Store")).toBe(true);
    expect(isCheckoutPublication("Headless")).toBe(true);
    expect(isCheckoutPublication("Hydrogen")).toBe(true);
    expect(isCheckoutPublication("AI Art Studio (Staging)")).toBe(true);
    expect(isCheckoutPublication("Storefront API")).toBe(true);
  });

  it("treats Point of Sale as POS-only", () => {
    expect(isPosPublication("Point of Sale")).toBe(true);
    expect(isCheckoutPublication("Point of Sale")).toBe(false);
    expect(isPosPublication("POS")).toBe(true);
  });

  it("partitions publications so custom apps are not unpublished", () => {
    const { checkout, pos } = partitionPublications([
      { id: "1", name: "Online Store" },
      { id: "2", name: "AI Art Studio (Staging)" },
      { id: "3", name: "Point of Sale" },
      { id: "4", name: "Headless" },
    ]);
    expect(checkout.map((c) => c.name)).toEqual([
      "Online Store",
      "AI Art Studio (Staging)",
      "Headless",
    ]);
    expect(pos.map((c) => c.name)).toEqual(["Point of Sale"]);
  });
});

describe("merchandise missing errors", () => {
  it("detects Storefront cartCreate userErrors", () => {
    expect(
      isMerchandiseMissingError(
        "The merchandise with id gid://shopify/ProductVariant/46172438888682 does not exist.",
      ),
    ).toBe(true);
    expect(isMerchandiseMissingError("Variant is out of stock")).toBe(false);
    expect(creatorMerchandiseMissingMessage()).toMatch(/try Add to cart again/i);
  });
});
