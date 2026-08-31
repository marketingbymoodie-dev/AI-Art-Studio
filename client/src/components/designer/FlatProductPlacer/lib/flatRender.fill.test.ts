import { describe, expect, it } from "vitest";
import {
  flatViewPaintsPrintLayer,
  parsePrintCanvasFillHex,
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
