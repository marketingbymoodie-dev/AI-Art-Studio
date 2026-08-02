import { describe, expect, it } from "vitest";
import {
  mergeFlatCalibrationBlanks,
  normalizeHarvestBlankColorKey,
  type FlatCalibrationManifest,
} from "./flat-calibration";

function baseManifest(blanks: FlatCalibrationManifest["blanks"]): FlatCalibrationManifest {
  return {
    productTypeId: 0,
    name: "test",
    blueprintId: 79,
    providerId: 1,
    tier: "flat",
    views: {},
    blanks,
    representativeGeometry: true,
    generatedAt: new Date().toISOString(),
  };
}

describe("normalizeHarvestBlankColorKey", () => {
  it("normalizes slash and underscore colour ids", () => {
    expect(normalizeHarvestBlankColorKey("black_red")).toBe("black-red");
    expect(normalizeHarvestBlankColorKey("White/ Red")).toBe("white-red");
  });
});

describe("mergeFlatCalibrationBlanks", () => {
  it("adds only missing blank keys from another provider", () => {
    const into = baseManifest({
      white_red: { front: "https://cdn/white_red.jpg" },
      white_navy: { front: "https://cdn/white_navy.jpg" },
    });
    const from = baseManifest({
      white_red: { front: "https://cdn/other_white_red.jpg" },
      black_red: { front: "https://cdn/black_red.jpg" },
    });
    expect(mergeFlatCalibrationBlanks(into, from)).toBe(1);
    expect(into.blanks.white_red?.front).toBe("https://cdn/white_red.jpg");
    expect(into.blanks.black_red?.front).toBe("https://cdn/black_red.jpg");
  });

  it("copies per-blank geometry for newly added keys", () => {
    const into = baseManifest({ white_red: { front: "a.jpg" } });
    const from = baseManifest({ black_red: { front: "b.jpg" } });
    from.geometryByBlank = {
      black_red: { front: { printFileDims: { width: 1, height: 2 } } as any },
    };
    mergeFlatCalibrationBlanks(into, from);
    expect(into.geometryByBlank?.black_red).toBeTruthy();
  });
});
