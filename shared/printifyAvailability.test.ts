import { describe, expect, it } from "vitest";
import { summarizeVariantAvailability } from "./printifyAvailability";

describe("summarizeVariantAvailability", () => {
  it("returns unknown when there are no selected variants", () => {
    const summary = summarizeVariantAvailability({
      catalogVariants: [{ id: 1, is_available: true }],
      selectedPrintifyVariantIds: [],
    });
    expect(summary.status).toBe("unknown");
    expect(summary.totalSelected).toBe(0);
  });

  it("flags fully_oos when every selected variant is unavailable", () => {
    const summary = summarizeVariantAvailability({
      catalogVariants: [
        { id: 1, is_available: false },
        { id: 2, is_available: false },
      ],
      selectedPrintifyVariantIds: [1, 2],
    });
    expect(summary.status).toBe("fully_oos");
    expect(summary.availableSelected).toBe(0);
    expect(summary.unavailableSelected).toBe(2);
  });

  it("flags critical at the default 90% OOS ratio without being fully_oos", () => {
    const catalogVariants = Array.from({ length: 10 }, (_, i) => ({
      id: i + 1,
      is_available: i === 0, // only variant 1 available -> 90% OOS
    }));
    const summary = summarizeVariantAvailability({
      catalogVariants,
      selectedPrintifyVariantIds: catalogVariants.map((v) => v.id),
    });
    expect(summary.status).toBe("critical");
    expect(summary.availableSelected).toBe(1);
    expect(summary.unavailableSelected).toBe(9);
  });

  it("stays ok when below the critical ratio", () => {
    const catalogVariants = Array.from({ length: 10 }, (_, i) => ({
      id: i + 1,
      is_available: i < 5, // 50% available
    }));
    const summary = summarizeVariantAvailability({
      catalogVariants,
      selectedPrintifyVariantIds: catalogVariants.map((v) => v.id),
    });
    expect(summary.status).toBe("ok");
  });

  it("treats selected variants missing from the catalog response as OOS (safer default)", () => {
    const summary = summarizeVariantAvailability({
      catalogVariants: [{ id: 1, is_available: true }],
      selectedPrintifyVariantIds: [1, 999],
    });
    expect(summary.missingFromCatalog).toBe(1);
    expect(summary.availableSelected).toBe(1);
    expect(summary.status).toBe("ok");
  });

  it("flags fully_oos when every selected variant is missing from the catalog response", () => {
    const summary = summarizeVariantAvailability({
      catalogVariants: [],
      selectedPrintifyVariantIds: [1, 2],
    });
    expect(summary.missingFromCatalog).toBe(2);
    expect(summary.availableSelected).toBe(0);
    expect(summary.status).toBe("fully_oos");
  });

  it("only intersects the variants a product type actually sells, ignoring unrelated catalog colors", () => {
    const catalogVariants = [
      { id: 1, is_available: true },
      { id: 2, is_available: false },
    ];
    const summary = summarizeVariantAvailability({
      catalogVariants,
      selectedPrintifyVariantIds: [1],
    });
    expect(summary.status).toBe("ok");
    expect(summary.totalSelected).toBe(1);
  });

  it("uses provided labels for the unavailable sample", () => {
    const summary = summarizeVariantAvailability({
      catalogVariants: [{ id: 1, is_available: false }],
      selectedPrintifyVariantIds: [1],
      labelsByPrintifyVariantId: { "1": "S / Heather Grey" },
    });
    expect(summary.unavailableLabels).toEqual(["S / Heather Grey"]);
  });

  it("does not treat omitted is_available as in-stock (catalog docs omit the field)", () => {
    // show-out-of-stock=1 returns all variants with no is_available — must NOT count as available.
    const allVariants = Array.from({ length: 10 }, (_, i) => ({ id: i + 1 }));
    const summary = summarizeVariantAvailability({
      catalogVariants: allVariants,
      selectedPrintifyVariantIds: allVariants.map((v) => v.id),
    });
    expect(summary.availableSelected).toBe(0);
    expect(summary.status).toBe("fully_oos");
  });

  it("uses availablePrintifyVariantIds membership as the primary stock signal", () => {
    // All 10 listed with show-out-of-stock=1; in-stock-only list is empty → fully OOS.
    const allVariants = Array.from({ length: 10 }, (_, i) => ({ id: i + 1 }));
    const summary = summarizeVariantAvailability({
      catalogVariants: allVariants,
      selectedPrintifyVariantIds: allVariants.map((v) => v.id),
      availablePrintifyVariantIds: [],
    });
    expect(summary.status).toBe("fully_oos");
    expect(summary.availableSelected).toBe(0);
    expect(summary.unavailableSelected).toBe(10);
  });

  it("counts only IDs present in the in-stock list as available", () => {
    const allVariants = Array.from({ length: 10 }, (_, i) => ({ id: i + 1 }));
    const summary = summarizeVariantAvailability({
      catalogVariants: allVariants,
      selectedPrintifyVariantIds: allVariants.map((v) => v.id),
      availablePrintifyVariantIds: [1], // 90% OOS → critical
    });
    expect(summary.availableSelected).toBe(1);
    expect(summary.unavailableSelected).toBe(9);
    expect(summary.status).toBe("critical");
  });
});
