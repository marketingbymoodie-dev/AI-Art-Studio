import { describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({ pool: { query: vi.fn() } }));

import { readCataloguePrintifyVariant } from "./catalogue-variant-fulfillment";

describe("readCataloguePrintifyVariant", () => {
  it("reads the Printify id stored against a catalogue Shopify variant", () => {
    expect(readCataloguePrintifyVariant({
      sizeId: "m",
      colorId: "sapphire",
      printifyVariantId: 42827,
    })).toEqual({ sizeId: "m", colorId: "sapphire", printifyVariantId: 42827 });
  });

  it("rejects a catalogue combo with no Printify variant", () => {
    expect(readCataloguePrintifyVariant({ sizeId: "m", colorId: "blue" })).toBeNull();
    expect(readCataloguePrintifyVariant(null)).toBeNull();
  });
});
