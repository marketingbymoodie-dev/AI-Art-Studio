import { describe, expect, it } from "vitest";
import {
  decodeFlatLinePlacement,
  decodeToteLinePlacement,
  encodeFlatLinePlacement,
  encodeToteLinePlacement,
} from "./linePlacementSnapshot";

describe("flat line placement snapshot", () => {
  it("round-trips a moved/scaled front placement", () => {
    const encoded = encodeFlatLinePlacement({
      placements: {
        front: { scale: 0.62, offsetX: 0.15, offsetY: -0.2, rotationDeg: 12 },
        back: { scale: 1, offsetX: 0, offsetY: 0 },
      },
      enabled: { front: true, back: false },
    });
    expect(encoded).toBeTruthy();
    expect(encoded!.length).toBeLessThan(255);
    const decoded = decodeFlatLinePlacement(encoded);
    expect(decoded?.placements.front.scale).toBeCloseTo(0.62);
    expect(decoded?.placements.front.offsetX).toBeCloseTo(0.15);
    expect(decoded?.placements.front.offsetY).toBeCloseTo(-0.2);
    expect(decoded?.placements.front.rotationDeg).toBeCloseTo(12);
    expect(decoded?.enabled.front).toBe(true);
    expect(decoded?.enabled.back).toBe(false);
  });

  it("keeps two different snapshots distinct", () => {
    const a = encodeFlatLinePlacement({
      placements: { front: { scale: 1.4, offsetX: 0, offsetY: 0 } },
      enabled: { front: true, back: false },
    });
    const b = encodeFlatLinePlacement({
      placements: { front: { scale: 0.55, offsetX: 0, offsetY: -0.25 } },
      enabled: { front: true, back: false },
    });
    expect(a).not.toBe(b);
    expect(decodeFlatLinePlacement(a)?.placements.front.scale).toBeCloseTo(1.4);
    expect(decodeFlatLinePlacement(b)?.placements.front.scale).toBeCloseTo(0.55);
  });
});

describe("tote line placement snapshot", () => {
  it("converts editor percent coords", () => {
    const encoded = encodeToteLinePlacement({ scale: 120, x: 40, y: 60 });
    const decoded = decodeToteLinePlacement(encoded);
    expect(decoded?.scale).toBeCloseTo(1.2);
    expect(decoded?.offsetX).toBeCloseTo(-0.2);
    expect(decoded?.offsetY).toBeCloseTo(0.2);
  });
});
