import { describe, expect, it } from "vitest";
import {
  condenseVariantPriceRows,
  formatCondensedColorLabel,
  splitVariantTitle,
  unifySameSizeSuggestedPrices,
} from "./condenseVariantPrices";

describe("splitVariantTitle", () => {
  it("splits size and colour", () => {
    expect(splitVariantTitle('14" x 11" / Black')).toEqual({
      size: '14" x 11"',
      color: "Black",
    });
  });

  it("keeps size-only titles", () => {
    expect(splitVariantTitle("Large")).toEqual({ size: "Large", color: null });
  });
});

describe("formatCondensedColorLabel", () => {
  it("lists a few colours", () => {
    expect(formatCondensedColorLabel(["Black", "White"], ["Black", "White"])).toBe("Black/White");
  });

  it("uses All Colours when every colour shares the price", () => {
    const colors = Array.from({ length: 8 }, (_, i) => `C${i}`);
    expect(formatCondensedColorLabel(colors, colors)).toBe("All Colours");
  });

  it("does not say All Colours for a partial group", () => {
    const all = ["Black", "White", "Navy", "Red", "Green"];
    expect(formatCondensedColorLabel(["Black", "White", "Navy", "Red"], all)).toBe("4 colours");
  });
});

describe("condenseVariantPriceRows", () => {
  const frames = [
    { id: "a", title: '14" x 11" / Black' },
    { id: "b", title: '14" x 11" / White' },
    { id: "c", title: '18" x 12" / Black' },
    { id: "d", title: '18" x 12" / White' },
  ];

  it("merges colours that share a price or only differ by .95 rounding", () => {
    const rows = condenseVariantPriceRows(frames, {
      a: "54.95",
      b: "54.95",
      c: "66.95",
      d: "67.95",
    });
    expect(rows.map((r) => r.label)).toEqual([
      '14" x 11" / Black/White',
      '18" x 12" / Black/White',
    ]);
    expect(rows[1]!.price).toBe("67.95");
  });

  it("keeps a colour split when its price is meaningfully different", () => {
    const rows = condenseVariantPriceRows(frames, {
      a: "54.95",
      b: "54.95",
      c: "62.95",
      d: "79.95",
    });
    expect(rows.map((r) => r.label)).toEqual([
      '14" x 11" / Black/White',
      '18" x 12" / Black',
      '18" x 12" / White',
    ]);
  });

  it("unifies same-size suggested prices within $1", () => {
    const out = unifySameSizeSuggestedPrices(frames, {
      a: "54.95",
      b: "54.95",
      c: "66.95",
      d: "67.95",
    });
    expect(out.c).toBe("67.95");
    expect(out.d).toBe("67.95");
  });

  it("labels a full colour set as All Colours", () => {
    const colors = ["Black", "White", "Navy", "Red", "Green"];
    const variants = colors.map((c, i) => ({ id: `s${i}`, title: `M / ${c}` }));
    const prices = Object.fromEntries(variants.map((v) => [v.id, "29.95"]));
    const rows = condenseVariantPriceRows(variants, prices);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.label).toBe("M / All Colours");
  });
});
