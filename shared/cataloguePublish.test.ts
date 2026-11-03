import { describe, expect, it } from "vitest";
import { promoteRefusals } from "./flywheelPromote";
import { formatCatalogueSpend, publishPreflightMessages, publishWork } from "./cataloguePublish";

const ready = {
  printFilePath: "print.png",
  panelId: "Mockup_01",
  productTypeName: "Unisex Softstyle T-Shirt",
  tickedColours: ["White"],
  panelColours: ["White"],
  storedMockupColours: ["White"],
  title: "Title",
  description: "Description",
  artStyle: "vintage-engraving",
  species: "cat",
  humourOperator: "pp-illustrated-character",
  shippingRefusal: null,
  metaobjectRefusal: null,
  publishNow: true,
  capMessage: null,
  missingPrices: [] as string[],
};

describe("catalogue publish phases", () => {
  it("runs the full chain for a pending import", () => {
    expect(publishWork({ hasPrint: false, hasListing: false, hasMockups: false, hasProduct: false })).toEqual([
      "print",
      "listing",
      "mockups",
      "shopify",
    ]);
  });

  it("skips to the product when approval already stored the files", () => {
    expect(publishWork({ hasPrint: true, hasListing: true, hasMockups: true, hasProduct: false })).toEqual(["shopify"]);
  });

  it("does nothing once a Shopify product exists", () => {
    expect(publishWork({ hasPrint: true, hasListing: true, hasMockups: true, hasProduct: true })).toEqual([]);
  });

  it("does not refuse a pending design for the files the button is about to build", () => {
    const reasons = promoteRefusals({
      ...ready,
      printFilePath: null,
      title: "",
      description: "",
      storedMockupColours: [],
      deferApprovalArtifacts: true,
      missingPrices: ["3XL"],
    });
    const text = reasons.join(" ");
    expect(text).not.toContain("No print file");
    expect(text).not.toContain("Title is not stored");
    expect(text).not.toContain("Description is not stored");
    expect(text).not.toContain("No stored mockup");
    expect(text).toContain("No front price for 3XL");
  });

  it("keeps one colour message", () => {
    expect(publishPreflightMessages(
      ["No colours selected.", "Truth is not stored."],
      ["No colours are ticked."],
    )).toEqual(["Truth is not stored.", "No colours are ticked."]);
  });

  it("formats a small listing charge", () => {
    expect(formatCatalogueSpend(0)).toBe("$0.00");
    expect(formatCatalogueSpend(0.006)).toBe("$0.0060");
    expect(formatCatalogueSpend(0.0123)).toBe("$0.01");
  });
});
