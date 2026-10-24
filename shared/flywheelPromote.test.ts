import { describe, expect, it } from "vitest";
import { inheritCatalogueMemberships } from "./shipping-desired-state";
import {
  PRINTIFY_FULL_BLEED,
  capRefusal,
  catalogueTags,
  catalogueVisibility,
  mockupAlt,
  mockupFileName,
  promoteRefusals,
} from "./flywheelPromote";

const ready = {
  printFilePath: "candidates/bed/print.png",
  panelId: "Mockup_01",
  productTypeName: "Unisex Softstyle T-Shirt",
  tickedColours: ["Sage"],
  panelColours: ["Sage", "Black"],
  storedMockupColours: ["Sage"],
  title: "Bed Etiquette",
  description: "A pug and a rule.",
  artStyle: "woodcut",
  species: "pug",
  humourOperator: "pp-owner-vs-pet",
  shippingRefusal: null,
  publishNow: true,
  capMessage: null,
  missingPrices: [] as string[],
};

describe("flywheel promote decisions", () => {
  it("publishes by default and can hold a draft, and never uses the unlisted status", () => {
    expect(catalogueVisibility(true)).toBe("active");
    expect(catalogueVisibility(false)).toBe("draft");
    expect(catalogueVisibility(true)).not.toBe("unlisted");
  });

  it("puts style, species and humour on the product as tags", () => {
    expect(catalogueTags({ artStyle: "woodcut", species: "pug", humourOperator: "pp-owner-vs-pet" })).toEqual([
      "woodcut",
      "pug",
      "pp-owner-vs-pet",
    ]);
  });

  it("names the design and the colour in the image file", () => {
    expect(mockupFileName("bed-etiquette", "Light grey")).toBe("bed-etiquette-light-grey-front.jpg");
    expect(mockupAlt("Bed Etiquette", "Sage")).toBe("Bed Etiquette on Sage");
  });

  it("lays the print file on full bleed", () => {
    expect(PRINTIFY_FULL_BLEED).toEqual({ x: 0.5, y: 0.5, scale: 1 });
  });

  it("refuses the cap by naming the designs that hold the slots", () => {
    expect(capRefusal(2, [{ title: "One", promotedAt: "2026-10-01" }])).toBeNull();
    expect(capRefusal(1, [{ title: "Bed Etiquette", promotedAt: "2026-10-20" }])).toBe(
      "Active design-product cap is 1. Holding the slots: Bed Etiquette (2026-10-20)",
    );
  });

  it("names every gap before anything is created", () => {
    const reasons = promoteRefusals({
      ...ready,
      printFilePath: null,
      tickedColours: ["Pink"],
      storedMockupColours: [],
      panelColours: ["Sage"],
      description: "",
      artStyle: "",
      publishNow: true,
      capMessage: "Active design-product cap is 1. Holding the slots: Other (2026-10-01)",
      missingPrices: ["3XL"],
    });
    expect(reasons.join(" ")).toContain("No print file");
    expect(reasons.join(" ")).toContain("No mockup panel for Pink");
    expect(reasons.join(" ")).toContain("No stored mockup for Pink");
    expect(reasons.join(" ")).toContain("Description is not stored");
    expect(reasons.join(" ")).toContain("missing style");
    expect(reasons.join(" ")).toContain("No front price for 3XL");
    expect(reasons.join(" ")).toContain("Holding the slots");
  });

  it("does not spend a cap slot when the product is held as a draft", () => {
    const reasons = promoteRefusals({
      ...ready,
      publishNow: false,
      capMessage: "Active design-product cap is 1. Holding the slots: Other (2026-10-01)",
    });
    expect(reasons).toEqual([]);
  });

  it("keeps a catalogue variant on the studio variant's shipping profile", () => {
    const next = inheritCatalogueMemberships(
      [{ classKey: "145:99", group: "g1", shopifyVariantId: "10", source: "base" }],
      [{ shopifyVariantId: "gid://shopify/ProductVariant/77", studioVariantId: "10" }],
    );
    expect(next).toContainEqual({ classKey: "145:99", group: "g1", shopifyVariantId: "77", source: "base" });
  });
});
