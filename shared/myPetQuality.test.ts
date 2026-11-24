import { describe, expect, it } from "vitest";
import {
  compositePetRegion,
  edgeEnergy,
  myPetQualityRetryAllowed,
  parsePetMask,
  resolvedPetMask,
} from "./myPetQuality";

function solid(width: number, height: number, rgba: [number, number, number, number]): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  for (let i = 0; i < out.length; i += 4) {
    out[i] = rgba[0];
    out[i + 1] = rgba[1];
    out[i + 2] = rgba[2];
    out[i + 3] = rgba[3];
  }
  return out;
}

describe("pet mask composite", () => {
  it("keeps every pixel outside the box, including lettering", () => {
    const original = solid(4, 4, [10, 20, 30, 255]);
    original[0] = 255;
    const edited = solid(4, 4, [9, 9, 9, 255]);
    const mask = parsePetMask({ x: 0.5, y: 0.5, w: 0.5, h: 0.5, letteringOverlapsPet: false });
    expect(mask).not.toBeNull();
    const out = compositePetRegion(original, edited, 4, 4, resolvedPetMask(mask!));
    expect(out[0]).toBe(255);
    expect(out[1]).toBe(20);
    const inside = (2 * 4 + 2) * 4;
    expect(out[inside]).toBe(9);
  });

  it("applies the operator nudge before copying", () => {
    const mask = parsePetMask({ x: 0.1, y: 0.1, w: 0.2, h: 0.2, nudgeX: 0.1, nudgeY: 0, nudgeW: 0, nudgeH: 0 });
    expect(resolvedPetMask(mask!)).toMatchObject({ x: 0.2, y: 0.1, w: 0.2, h: 0.2 });
  });

  it("allows one quality retry and never a second", () => {
    expect(myPetQualityRetryAllowed(true, false)).toBe(true);
    expect(myPetQualityRetryAllowed(true, true)).toBe(false);
    expect(myPetQualityRetryAllowed(false, false)).toBe(false);
  });
});

describe("edge energy", () => {
  it("drops when a hard edge is softened and stays put when pixels are copied", () => {
    const sharp = solid(4, 1, [0, 0, 0, 255]);
    sharp[0] = 255;
    sharp[1] = 255;
    sharp[2] = 255;
    const soft = new Uint8Array(sharp);
    soft[4] = 128;
    soft[5] = 128;
    soft[6] = 128;
    const sharpEnergy = edgeEnergy(sharp, 4, 1);
    const softEnergy = edgeEnergy(soft, 4, 1);
    expect(sharpEnergy).toBeGreaterThan(softEnergy);
    const copy = new Uint8Array(sharp);
    expect(edgeEnergy(copy, 4, 1)).toBe(sharpEnergy);
  });
});
