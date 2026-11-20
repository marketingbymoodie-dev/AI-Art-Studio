import { describe, expect, it } from "vitest";
import {
  comparePublishTiming,
  listingBody,
  listingHandle,
  listingTitle,
  normaliseHandleSuffix,
  openPublishTypeIds,
  suggestListingCopy,
} from "./listingCopy";

describe("listing copy", () => {
  it("defaults a Softstyle blueprint to the tee word, suffix, and style label", () => {
    expect(suggestListingCopy("Unisex Softstyle T-Shirt")).toEqual({
      garmentWord: "T-Shirt",
      handleSuffix: "-softstyle",
      styleLabel: "Lighter Softstyle Tee",
    });
  });

  it("defaults a garment-dyed tee with no handle suffix", () => {
    expect(suggestListingCopy("Unisex Garment-Dyed T-shirt")).toEqual({
      garmentWord: "T-Shirt",
      handleSuffix: "",
      styleLabel: "Garment-Dyed Tee",
    });
  });

  it("names longer garments from the blueprint", () => {
    expect(suggestListingCopy("Unisex Long Sleeve Shirt").garmentWord).toBe("Long Sleeve Shirt");
    expect(suggestListingCopy("Unisex Crewneck Sweatshirt").garmentWord).toBe("Sweatshirt");
  });

  it("shares the tee title and keeps the handles distinct", () => {
    expect(listingTitle("Husky -Collector's Card", "T-Shirt")).toBe("Husky -Collector's Card T-Shirt");
    expect(listingTitle("Husky -Collector's Card T-Shirt", "T-Shirt")).toBe("Husky -Collector's Card T-Shirt");
    expect(listingHandle("Husky -Collector's Card T-Shirt", "")).toBe("husky-collector-s-card-t-shirt");
    expect(listingHandle("Husky -Collector's Card T-Shirt", "-softstyle")).toBe("husky-collector-s-card-t-shirt-softstyle");
    expect(normaliseHandleSuffix("-1")).toBeNull();
    expect(normaliseHandleSuffix("1")).toBeNull();
    expect(normaliseHandleSuffix("softstyle")).toBe("-softstyle");
    expect(normaliseHandleSuffix("")).toBe("");
  });

  it("puts the style label ahead of the shared description and the garment details", () => {
    expect(listingBody({
      styleLabel: "Lighter Softstyle Tee",
      designDescription: "A husky on a card.",
      garmentDetails: "<p>100% cotton</p>",
    })).toBe("<p><strong>Lighter Softstyle Tee</strong></p>\n<p>A husky on a card.</p>\n<p>100% cotton</p>");
  });

  it("leaves a published type closed and keeps a type created later open", () => {
    expect(openPublishTypeIds([56, 58, 70], [58])).toEqual([56, 70]);
  });

  it("counts parallel artwork against sequential listings", () => {
    const timing = comparePublishTiming({
      listingWriteMs: 1000,
      types: [
        { printMs: 8000, mockupMs: 12000, storeMs: 5000 },
        { printMs: 9000, mockupMs: 11000, storeMs: 5000 },
      ],
    });
    expect(timing.togetherMs).toBe(22000);
    expect(timing.separateMs).toBe(51000);
  });
});
