import { describe, expect, it } from "vitest";
import { PETPOSTEROUS_CATALOGUE_SHOP, STAGING_CATALOGUE_SHOP } from "./operatorCatalogue";
import { chestZoneForProductType, chestZoneRect, inkOrigin, placementForProductType, verticalPrintAnchorOf } from "./printPlacement";

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

  it("applies the chest placement only to types 56 and 58 on the catalogue shops", () => {
    expect(placementForProductType(56, PETPOSTEROUS_CATALOGUE_SHOP)).toEqual({ anchor: "top", mockupScale: 1 });
    expect(placementForProductType(58, STAGING_CATALOGUE_SHOP)).toEqual({ anchor: "top", mockupScale: 1 });
    expect(placementForProductType(54, STAGING_CATALOGUE_SHOP)).toEqual({ anchor: "center", mockupScale: 0.85 });
    expect(placementForProductType(56, "other-merchant.myshopify.com")).toEqual({ anchor: "center", mockupScale: 0.85 });
    expect(placementForProductType(58)).toEqual({ anchor: "center", mockupScale: 0.85 });
    expect(placementForProductType(12)).toEqual({ anchor: "center", mockupScale: 0.85 });
  });

  it("keeps the approved chest zone on types 56 and 58 only on the catalogue shops", () => {
    expect(chestZoneForProductType(58, undefined, undefined, PETPOSTEROUS_CATALOGUE_SHOP)).toEqual({ maxWidthIn: 14, maxHeightIn: 14 });
    expect(chestZoneForProductType(56, undefined, undefined, STAGING_CATALOGUE_SHOP)).toEqual({ maxWidthIn: 11, maxHeightIn: 14 });
    expect(chestZoneForProductType(54, undefined, undefined, STAGING_CATALOGUE_SHOP)).toBeNull();
    expect(chestZoneForProductType(58, "14.00", "14.00", PETPOSTEROUS_CATALOGUE_SHOP)).toEqual({ maxWidthIn: 14, maxHeightIn: 14 });
    expect(chestZoneForProductType(58, "14.00", "14.00", "other-merchant.myshopify.com")).toBeNull();
    expect(chestZoneForProductType(54, null, null)).toBeNull();
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
