import { describe, expect, it } from "vitest";
import {
  flatViewPaintsPrintLayer,
  parsePrintCanvasFillHex,
  printCanvasFillForView,
} from "./flatRender";

describe("parsePrintCanvasFillHex", () => {
  it("accepts #RRGGBB and rejects none / empty", () => {
    expect(parsePrintCanvasFillHex("#112233")).toBe("#112233");
    expect(parsePrintCanvasFillHex("  #AABBCC  ")).toBe("#AABBCC");
    expect(parsePrintCanvasFillHex("none")).toBeNull();
    expect(parsePrintCanvasFillHex(null)).toBeNull();
    expect(parsePrintCanvasFillHex("")).toBeNull();
  });
});

describe("flatViewPaintsPrintLayer", () => {
  it("paints fill on a face with no artwork (print-on-back off)", () => {
    expect(flatViewPaintsPrintLayer(null, "#FF8800")).toBe(true);
  });

  it("skips the print layer when neither fill nor artwork is set", () => {
    expect(flatViewPaintsPrintLayer(null, null)).toBe(false);
    expect(flatViewPaintsPrintLayer(null, "none")).toBe(false);
  });

  it("paints when artwork is present even without a fill", () => {
    const art = { naturalWidth: 64, naturalHeight: 64, width: 64, height: 64 } as HTMLImageElement;
    expect(flatViewPaintsPrintLayer(art, null)).toBe(true);
  });
});

describe("printCanvasFillForView", () => {
  it("drops apparel fill when the face has no artwork", () => {
    expect(
      printCanvasFillForView({
        backgroundColor: "#FF8800",
        enabled: false,
      }),
    ).toBeNull();
  });

  it("keeps apparel fill when the face is enabled", () => {
    expect(
      printCanvasFillForView({
        backgroundColor: "#FF8800",
        enabled: true,
      }),
    ).toBe("#FF8800");
  });

  it("keeps tote / pillow fill on a disabled face", () => {
    expect(
      printCanvasFillForView({
        backgroundColor: "#FF8800",
        enabled: false,
        decorMode: true,
      }),
    ).toBe("#FF8800");
  });

  it("keeps phone-case fill on a disabled face", () => {
    expect(
      printCanvasFillForView({
        backgroundColor: "#FF8800",
        enabled: false,
        edgeWrapMode: true,
      }),
    ).toBe("#FF8800");
  });
});
