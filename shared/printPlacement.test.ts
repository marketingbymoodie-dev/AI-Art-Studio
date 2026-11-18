import { describe, expect, it } from "vitest";
import { inkOrigin, placementForProductType, verticalPrintAnchorOf } from "./printPlacement";

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

  it("applies the chest placement only to types 56 and 58", () => {
    expect(placementForProductType(56)).toEqual({ anchor: "top", mockupScale: 1 });
    expect(placementForProductType(58)).toEqual({ anchor: "top", mockupScale: 1 });
    expect(placementForProductType(54)).toEqual({ anchor: "center", mockupScale: 0.85 });
    expect(placementForProductType(12)).toEqual({ anchor: "center", mockupScale: 0.85 });
  });
});
