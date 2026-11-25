import { describe, expect, it } from "vitest";
import {
  comparePublishTiming,
  listingBody,
  catalogueBrandVendor,
  listingHandle,
  listingTitle,
  listingTitleCase,
  normaliseDesignName,
  normaliseHandleSuffix,
  openPublishTypeIds,
  suggestListingCopy,
} from "./listingCopy";

describe("catalogue brand vendor", () => {
  it("uses the shop name when the stored name is the myshopify domain", () => {
    expect(catalogueBrandVendor("Petposterous", "h7epay-gh.myshopify.com")).toBe("Petposterous");
  });

  it("keeps a real stored name when the shop name is missing", () => {
    expect(catalogueBrandVendor("", "Pet Stage")).toBe("Pet Stage");
  });

  it("returns nothing when both names are myshopify domains", () => {
    expect(catalogueBrandVendor("petstage.myshopify.com", "h7epay-gh.myshopify.com")).toBe("");
  });
});

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
    expect(listingTitle("Husky -Collector's Card", "T-Shirt")).toBe("Husky — Collector's Card T-Shirt");
    expect(listingTitle("Husky -Collector's Card", "Softstyle Tee")).toBe("Husky — Collector's Card Softstyle Tee");
    expect(listingTitle("Husky -Collector's Card T-Shirt", "T-Shirt")).toBe("Husky — Collector's Card T-Shirt");
    expect(listingTitle("Husky — Collector's Card Softstyle Tee", "Softstyle Tee")).toBe("Husky — Collector's Card Softstyle Tee");
    for (const raw of [
      "Husky -Collector's Card",
      "Husky - Collector's Card",
      "Husky-Collector's Card",
      "Husky —Collector's Card",
      "Husky — Collector's Card",
      "Husky – Collector's Card",
      "Husky − Collector's Card",
    ]) {
      expect(normaliseDesignName(raw)).toBe("Husky — Collector's Card");
    }
    expect(normaliseDesignName("T-Shirt")).toBe("T-Shirt");
    expect(listingTitle("Husky — Collector's Card", "T-Shirt")).toBe("Husky — Collector's Card T-Shirt");
    expect(listingTitle("throw me a frickin bone here", "T-Shirt")).toBe("Throw Me A Frickin Bone Here T-Shirt");
    expect(listingTitle("THROW ME A FRICKIN BONE HERE", "t-shirt")).toBe("Throw Me A Frickin Bone Here T-Shirt");
    expect(listingTitleCase("throw me a frickin bone here")).toBe("Throw Me A Frickin Bone Here");
    expect(listingHandle("Husky — Collector's Card T-Shirt", "")).toBe("husky-collector-s-card-t-shirt");
    expect(listingHandle("Husky -Collector's Card T-Shirt", "-softstyle")).toBe("husky-collector-s-card-t-shirt-softstyle");
    expect(normaliseHandleSuffix("-1")).toBeNull();
    expect(normaliseHandleSuffix("1")).toBeNull();
    expect(normaliseHandleSuffix("softstyle")).toBe("-softstyle");
    expect(normaliseHandleSuffix("")).toBe("");
  });

  it("puts only the design backstory in the description", () => {
    const blueprint = `<p>Comfort Colors introduces the “Comfort Colors 1717” garment-dyed t-shirt.</p><div>.:Heavyweight fabric</div><div>.:Relaxed fit</div><div>.:Pre-shrunk</div><div>.:Available in 62 colors</div><div>.:Sewn-in label</div>`;
    expect(listingBody({
      styleLabel: "Garment-Dyed Tee",
      designDescription: "A chihuahua lies on a therapist's chaise longue.",
      garmentDetails: blueprint,
    })).toBe("<p>A chihuahua lies on a therapist's chaise longue.</p>");
    expect(listingBody({
      styleLabel: "Lighter Softstyle Tee",
      designDescription: "A husky on a card.",
      garmentDetails: "<p>100% cotton</p>",
    })).toBe("<p>A husky on a card.</p>");
  });

  it("leaves a published type closed and keeps a type created later open", () => {
    expect(openPublishTypeIds([81, 82, 70], [82])).toEqual([81, 70]);
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
