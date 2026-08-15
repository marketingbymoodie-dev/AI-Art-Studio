import { describe, expect, it } from "vitest";
import {
  isFlatPlacerGalleryReachable,
  snapUnreachablePlacerGalleryIndex,
  stepPostGenGalleryIndex,
  type PostGenGalleryNavItem,
} from "./postGenGalleryNav";

const items: PostGenGalleryNavItem[] = [
  { kind: "artwork", label: "Artwork" },
  { kind: "mockup", url: "https://x.example/front.png", label: "Front" },
  { kind: "mockup", url: "https://x.example/ctx.png", label: "Context" },
  { kind: "catalog", url: "https://x.example/blank.png", label: "Primary" },
];

describe("stepPostGenGalleryIndex", () => {
  it("wraps normally when flat placer is closed", () => {
    expect(stepPostGenGalleryIndex(3, 1, items, false)).toBe(0);
    expect(stepPostGenGalleryIndex(0, 1, items, false)).toBe(1);
  });

  it("from Artwork skips Front and lands on Context when placer is open", () => {
    expect(stepPostGenGalleryIndex(0, 1, items, true)).toBe(2);
  });

  it("does not treat flatlay front-side as lifestyle context", () => {
    expect(
      isFlatPlacerGalleryReachable({
        kind: "mockup",
        url: "https://x.example/fs.png",
        label: "front side",
      }),
    ).toBe(false);
  });

  it("from Context continues to catalog Primary when placer is open", () => {
    expect(stepPostGenGalleryIndex(2, 1, items, true)).toBe(3);
  });

  it("from last catalog wraps back to Artwork (not stuck on Front)", () => {
    expect(stepPostGenGalleryIndex(3, 1, items, true)).toBe(0);
  });

  it("from Artwork going back reaches catalog again", () => {
    expect(stepPostGenGalleryIndex(0, -1, items, true)).toBe(3);
  });

  it("reaches Printers Mockup slides while placer is open", () => {
    const withPrinters: PostGenGalleryNavItem[] = [
      { kind: "artwork", label: "Artwork" },
      { kind: "mockup", url: "https://x.example/front.png", label: "front" },
      { kind: "mockup", url: "https://x.example/pfy.png", label: "printers" },
      { kind: "catalog", url: "https://x.example/v2.png", label: "View 2" },
    ];
    expect(stepPostGenGalleryIndex(0, 1, withPrinters, true)).toBe(2);
    expect(stepPostGenGalleryIndex(2, 1, withPrinters, true)).toBe(3);
  });

  it("reaches Front Person while mesh AOP placer is open", () => {
    const withPerson: PostGenGalleryNavItem[] = [
      { kind: "artwork", label: "Artwork" },
      { kind: "mockup", url: "https://x.example/front.png", label: "front" },
      { kind: "mockup", url: "https://x.example/back.png", label: "back" },
      { kind: "mockup", url: "https://x.example/fp.png", label: "Front Person" },
      { kind: "mockup", url: "https://x.example/sp.png", label: "Side Person" },
    ];
    expect(stepPostGenGalleryIndex(0, 1, withPerson, true)).toBe(3);
    expect(stepPostGenGalleryIndex(3, 1, withPerson, true)).toBe(4);
    expect(stepPostGenGalleryIndex(4, 1, withPerson, true)).toBe(0);
    expect(
      isFlatPlacerGalleryReachable({
        kind: "mockup",
        url: "https://x.example/fp.png",
        label: "Front Person",
      }),
    ).toBe(true);
  });

  it("clamps an out-of-range index so one click still advances", () => {
    // Gallery shrank while the pointer was on the (now removed) last slide.
    expect(stepPostGenGalleryIndex(4, 1, items, false)).toBe(0);
    expect(stepPostGenGalleryIndex(9, 1, items, false)).toBe(0);
    expect(stepPostGenGalleryIndex(-2, -1, items, false)).toBe(3);
  });

  it("steps Front → Front Person in one click when placer is closed", () => {
    const itemsClosed: PostGenGalleryNavItem[] = [
      { kind: "artwork", label: "Artwork" },
      { kind: "mockup", url: "https://x.example/front.png", label: "Front" },
      { kind: "mockup", url: "https://x.example/fp.png", label: "Front Person" },
      { kind: "mockup", url: "https://x.example/sp.png", label: "Side Person" },
    ];
    expect(stepPostGenGalleryIndex(1, 1, itemsClosed, false)).toBe(2);
  });

  it("mesh AOP: Front View skips Front/Back and catalog to Front Person", () => {
    const hoodie: PostGenGalleryNavItem[] = [
      { kind: "artwork", label: "Artwork" },
      { kind: "mockup", url: "https://x.example/front.png", label: "Front" },
      { kind: "mockup", url: "https://x.example/back.png", label: "Back" },
      { kind: "mockup", url: "https://x.example/fp.png", label: "Front Person" },
      { kind: "mockup", url: "https://x.example/sp.png", label: "Side Person" },
      { kind: "catalog", url: "https://x.example/p.png", label: "Primary" },
      { kind: "catalog", url: "https://x.example/v2.png", label: "View 2" },
      { kind: "catalog", url: "https://x.example/v3.png", label: "View 3" },
    ];
    expect(stepPostGenGalleryIndex(0, 1, hoodie, "aop")).toBe(3);
    expect(stepPostGenGalleryIndex(3, 1, hoodie, "aop")).toBe(4);
    expect(stepPostGenGalleryIndex(4, 1, hoodie, "aop")).toBe(0);
    expect(stepPostGenGalleryIndex(0, -1, hoodie, "aop")).toBe(4);
    // Catalog still looks like Front View on mesh AOP — one click to Person.
    expect(stepPostGenGalleryIndex(5, 1, hoodie, "aop")).toBe(3);
  });
});

describe("snapUnreachablePlacerGalleryIndex", () => {
  it("snaps hidden Front to Artwork, not the last catalog closeup", () => {
    const apron: PostGenGalleryNavItem[] = [
      { kind: "artwork", label: "Artwork" },
      { kind: "mockup", url: "https://x.example/front.png", label: "Front" },
      { kind: "catalog", url: "https://x.example/p.png", label: "Primary" },
      { kind: "catalog", url: "https://x.example/v2.png", label: "View 2" },
      { kind: "catalog", url: "https://x.example/v3.png", label: "View 3" },
      { kind: "catalog", url: "https://x.example/v4.png", label: "View 4" },
    ];
    // Stepping backward from Front (the old skip) wraps onto View 4.
    expect(stepPostGenGalleryIndex(1, -1, apron, true)).toBe(5);
    expect(snapUnreachablePlacerGalleryIndex(1, apron, true)).toBe(0);
    expect(snapUnreachablePlacerGalleryIndex(0, apron, true)).toBe(0);
    expect(snapUnreachablePlacerGalleryIndex(5, apron, true)).toBe(5);
  });
});

describe("isFlatPlacerGalleryReachable", () => {
  it("allows artwork, catalog, and printers — not front rasters", () => {
    expect(isFlatPlacerGalleryReachable({ kind: "artwork", label: "Artwork" })).toBe(true);
    expect(
      isFlatPlacerGalleryReachable({
        kind: "catalog",
        url: "https://x.example/v2.png",
        label: "View 2",
      }),
    ).toBe(true);
    expect(
      isFlatPlacerGalleryReachable({
        kind: "mockup",
        url: "https://x.example/p.png",
        label: "Printers Mockup",
      }),
    ).toBe(true);
    expect(
      isFlatPlacerGalleryReachable({
        kind: "mockup",
        url: "https://x.example/f.png",
        label: "Front",
      }),
    ).toBe(false);
  });
});
