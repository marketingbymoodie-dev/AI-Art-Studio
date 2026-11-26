import { describe, expect, it } from "vitest";
import { myPetPlusCents, presentmentCents } from "./myPetSurcharge";

const AUD = 1.49786595;

describe("myPetPlusCents", () => {
  it("is the shop surcharge when the market rate is 1", () => {
    expect(myPetPlusCents(2995, 100, 1)).toBe(100);
    expect(myPetPlusCents(2995, 0, 1)).toBe(0);
  });

  it("subtracts the two rounded presentment prices", () => {
    const catalogue = presentmentCents(2995, AUD);
    const custom = presentmentCents(3095, AUD);
    expect(myPetPlusCents(catalogue, 100, AUD)).toBe(custom - catalogue);
    // A rate that rounds the two full prices differently from rounding the $0.01 alone.
    const crossed = presentmentCents(333, 1.5);
    expect(myPetPlusCents(crossed, 1, 1.5)).toBe(presentmentCents(334, 1.5) - crossed);
    expect(myPetPlusCents(crossed, 1, 1.5)).not.toBe(presentmentCents(1, 1.5));
  });
});
