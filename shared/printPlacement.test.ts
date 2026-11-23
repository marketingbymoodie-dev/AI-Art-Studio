import { describe, expect, it } from "vitest";
import { PETPOSTEROUS_CATALOGUE_SHOP, STAGING_CATALOGUE_SHOP } from "./operatorCatalogue";
import { chestZoneForCatalogueType, chestZoneRect, inkOrigin, placementForCatalogueType, verticalPrintAnchorOf } from "./printPlacement";

describe("print placement", () => {
  const area = { areaLeft: 100, areaTop: 200, areaWidth: 400, areaHeight: 500, inkWidth: 360, inkHeight: 180 };

  it("puts a chest graphic on the top of the print area and stays horizontally centred", () => {
    expect(verticalPrintAnchorOf("top")).toBe("top");
    expect(inkOrigin({ ...area, anchor: "top" })).toEqual({ left: 120, top: 200 });
  });

  it("keeps every other type centred", () => {
    expect(verticalPrintAnchorOf(undefined)).toBe("center");
    expect(verticalPrintAnchorOf("nope")).toBe("center");
    expect(inkOrigin({ ...area, anchor: "center" })).toEqual({ left: 120, top: 360 });
  });

  it("applies the chest placement to blueprint 145 and 706 on the catalogue shops", () => {
    expect(placementForCatalogueType({ shop: PETPOSTEROUS_CATALOGUE_SHOP, blueprintId: 145, providerId: 99 })).toEqual({ anchor: "top", mockupScale: 1 });
    expect(placementForCatalogueType({ shop: "petstage.myshopify.com", blueprintId: 145, providerId: 99 })).toEqual({ anchor: "top", mockupScale: 1 });
    expect(placementForCatalogueType({ shop: STAGING_CATALOGUE_SHOP, blueprintId: 706, providerId: 99 })).toEqual({ anchor: "top", mockupScale: 1 });
    expect(placementForCatalogueType({ shop: null, blueprintId: 145, providerId: 99 })).toEqual({ anchor: "center", mockupScale: 0.85 });
    expect(placementForCatalogueType({ shop: "other-merchant.myshopify.com", blueprintId: 706, providerId: 99 })).toEqual({ anchor: "center", mockupScale: 0.85 });
    expect(placementForCatalogueType({ shop: STAGING_CATALOGUE_SHOP, blueprintId: 145, providerId: 1 })).toEqual({ anchor: "center", mockupScale: 0.85 });
    expect(placementForCatalogueType()).toEqual({ anchor: "center", mockupScale: 0.85 });
  });

  it("uses the blueprint chest zone only for those shirts, and stored inches on any other row", () => {
    expect(chestZoneForCatalogueType({ shop: PETPOSTEROUS_CATALOGUE_SHOP, blueprintId: 706, providerId: 99 })).toEqual({ maxWidthIn: 14, maxHeightIn: 14 });
    expect(chestZoneForCatalogueType({ shop: STAGING_CATALOGUE_SHOP, blueprintId: 145, providerId: 99 })).toEqual({ maxWidthIn: 11, maxHeightIn: 14 });
    expect(chestZoneForCatalogueType({ shop: null, blueprintId: 145, providerId: 99 })).toBeNull();
    expect(chestZoneForCatalogueType({ shop: PETPOSTEROUS_CATALOGUE_SHOP, blueprintId: 706, providerId: 99, storedWidth: "14.00", storedHeight: "14.00" })).toEqual({ maxWidthIn: 14, maxHeightIn: 14 });
    expect(chestZoneForCatalogueType({ shop: null, blueprintId: 706, providerId: 99, storedWidth: "10", storedHeight: "12" })).toEqual({ maxWidthIn: 10, maxHeightIn: 12 });
    expect(chestZoneForCatalogueType({ shop: "other-merchant.myshopify.com", blueprintId: 145, providerId: 99 })).toBeNull();
    const zone = chestZoneRect({
      areaLeft: 0,
      areaTop: 100,
      areaWidth: 4494,
      areaHeight: 5097,
      printWidthIn: 14.98,
      printHeightIn: 16.99,
      zone: { maxWidthIn: 14, maxHeightIn: 14 },
    });
    expect(zone.top).toBe(100);
    expect(zone.width).toBe(Math.round(4494 * (14 / 14.98)));
    expect(zone.height).toBe(Math.round(5097 * (14 / 16.99)));
    expect(zone.left).toBe(Math.round((4494 - zone.width) / 2));
  });
});
