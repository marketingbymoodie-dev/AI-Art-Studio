import { describe, expect, it } from "vitest";
import {
  extractPlaceholderPositionNames,
  parseStoredPlaceholderPositionNames,
  resolveCostProbePositionAttempts,
} from "./printifyCostProbePositions";

describe("extractPlaceholderPositionNames", () => {
  it("unions nested variants.json placeholder names", () => {
    expect(
      extractPlaceholderPositionNames([
        { id: 1, placeholders: [{ position: "default", width: 2650, height: 5250 }] },
        { id: 2, placeholders: [{ position: "default" }, { position: "label" }] },
      ]),
    ).toEqual(["default", "label"]);
  });

  it("skips empty or missing placeholders", () => {
    expect(extractPlaceholderPositionNames([{ id: 1 }, { placeholders: [] }])).toEqual([]);
  });
});

describe("parseStoredPlaceholderPositionNames", () => {
  it("reads import-stored JSON rows", () => {
    expect(
      parseStoredPlaceholderPositionNames(
        JSON.stringify([{ position: "default", width: 2650, height: 5250 }]),
      ),
    ).toEqual(["default"]);
  });
});

describe("resolveCostProbePositionAttempts", () => {
  it("uses the catalog name for tote 1300 — never invents front", () => {
    const r = resolveCostProbePositionAttempts({
      blueprintId: 1300,
      catalogPositions: ["default"],
      isAllOverPrint: true,
      fulfillmentLayout: "tote_folded_v1",
    });
    expect(r.attempts).toEqual([["default"]]);
    expect(r.attempts.flat()).not.toContain("front");
    expect(r.source).toBe("catalog");
  });

  it("falls back to import-stored names when catalog placeholders are empty", () => {
    const r = resolveCostProbePositionAttempts({
      blueprintId: 1300,
      catalogPositions: [],
      storedPositions: ["default"],
      fulfillmentLayout: "tote_folded_v1",
    });
    expect(r.attempts).toEqual([["default"]]);
    expect(r.source).toBe("stored");
  });

  it("does not send front for tote 1300 when no names are known", () => {
    const r = resolveCostProbePositionAttempts({
      blueprintId: 1300,
      catalogPositions: [],
      storedPositions: [],
      fulfillmentLayout: "tote_folded_v1",
    });
    expect(r.attempts).toEqual([]);
    expect(r.source).toBe("none");
  });

  it("sends the full AOP panel set from catalog", () => {
    const r = resolveCostProbePositionAttempts({
      blueprintId: 836,
      catalogPositions: ["front", "back"],
      isAllOverPrint: true,
    });
    expect(r.attempts[0]).toEqual(["front", "back"]);
  });

  it("keeps DTG base probe on front when catalog lists sleeves", () => {
    const r = resolveCostProbePositionAttempts({
      blueprintId: 5,
      catalogPositions: ["front", "back", "left_sleeve", "right_sleeve", "neck_label"],
      isAllOverPrint: false,
    });
    expect(r.attempts).toEqual([["front"]]);
  });

  it("uses the first real name for non-AOP when front is absent", () => {
    const r = resolveCostProbePositionAttempts({
      blueprintId: 1649,
      catalogPositions: ["print_area"],
      isAllOverPrint: false,
    });
    expect(r.attempts).toEqual([["print_area"]]);
  });

  it("prefers zip hoodie minimal body panels when present", () => {
    const r = resolveCostProbePositionAttempts({
      blueprintId: 451,
      catalogPositions: ["front_left", "front_right", "back_left", "back_right"],
      isAllOverPrint: true,
    });
    expect(r.attempts[0]).toEqual(["front_left", "front_right"]);
    expect(r.attempts).toContainEqual(["front_left", "front_right", "back_left", "back_right"]);
  });

  it("falls back to DTG front when catalog omitted placeholders", () => {
    const r = resolveCostProbePositionAttempts({
      blueprintId: 5,
      catalogPositions: [],
      storedPositions: [],
      isAllOverPrint: false,
    });
    expect(r.attempts).toEqual([["front"]]);
    expect(r.source).toBe("dtg_front");
  });
});
