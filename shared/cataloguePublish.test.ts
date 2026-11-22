import { describe, expect, it } from "vitest";
import { promoteRefusals } from "./flywheelPromote";
import { catalogueJobHeartbeatIsStale, catalogueJobLabel, CATALOGUE_PUBLISH_STALE_MS, formatCatalogueSpend, mergeCatalogueExternalIds, myPetMetafieldValue, publishColorTickPatch, publishColourNames, publishPreflightMessages, publishWork, readCatalogueExternalId, readPublishColorTicks } from "./cataloguePublish";

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

describe("publish colour ticks", () => {
  it("ticks every offered colour until that type has been saved", () => {
    expect(publishColourNames(undefined, ["Black", "Natural"])).toEqual(["Black", "Natural"]);
  });

  it("keeps an explicit empty list and drops a colour that is no longer offered", () => {
    expect(publishColourNames([], ["Black", "Natural"])).toEqual([]);
    expect(publishColourNames(["Natural", "Navy"], ["Black", "Natural"])).toEqual(["Natural"]);
  });

  it("stores one type without replacing the other", () => {
    const patch = publishColorTickPatch(58, ["Black", "black", ""]);
    expect(patch).toEqual({ "58": ["Black"] });
    expect(readPublishColorTicks({ "56": ["Natural"], ...patch })).toEqual({
      "56": ["Natural"],
      "58": ["Black"],
    });
  });
});

describe("publish resume", () => {
  it("leaves a fresh heartbeat alone and reclaims a stale one", () => {
    const now = Date.parse("2026-11-22T00:00:45.000Z");
    expect(catalogueJobHeartbeatIsStale(now - CATALOGUE_PUBLISH_STALE_MS + 1, now)).toBe(false);
    expect(catalogueJobHeartbeatIsStale(now - CATALOGUE_PUBLISH_STALE_MS, now)).toBe(true);
  });

  it("keeps the other garment's product ids when one id is saved", () => {
    const saved = mergeCatalogueExternalIds({ "56": { printifyProductId: "p56" } }, 58, { shopifyProductId: "s58" });
    expect(saved).toEqual({ "56": { printifyProductId: "p56" }, "58": { shopifyProductId: "s58" } });
    expect(readCatalogueExternalId(mergeCatalogueExternalIds(saved, 58, { printifyProductId: "p58" }), 58)).toEqual({
      shopifyProductId: "s58",
      printifyProductId: "p58",
    });
  });
});

describe("catalogue job labels", () => {
  it("names each queue state, and keeps the failure reason", () => {
    expect(catalogueJobLabel("queued")).toBe("Queued");
    expect(catalogueJobLabel("print")).toBe("Preparing print file");
    expect(catalogueJobLabel("listing")).toBe("Writing listing");
    expect(catalogueJobLabel("mockups")).toBe("Compositing mockups");
    expect(catalogueJobLabel("shopify")).toBe("Creating Shopify product");
    expect(catalogueJobLabel("done")).toBe("Done");
    expect(catalogueJobLabel("failed", "Printify rejected the product")).toBe("Failed: Printify rejected the product");
  });
});

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

  it("writes My Pet on unless the publish tick is off", () => {
    expect(myPetMetafieldValue(undefined)).toBe("true");
    expect(myPetMetafieldValue(true)).toBe("true");
    expect(myPetMetafieldValue(false)).toBe("false");
  });

  it("formats a small listing charge", () => {
    expect(formatCatalogueSpend(0)).toBe("$0.00");
    expect(formatCatalogueSpend(0.006)).toBe("$0.0060");
    expect(formatCatalogueSpend(0.0123)).toBe("$0.01");
  });
});
