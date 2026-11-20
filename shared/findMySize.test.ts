import { describe, expect, it } from "vitest";
import {
  defaultEaseForShape,
  estimateBodyChestInches,
  garmentShapeFromName,
  measurementsFromPrintifyChart,
  suggestSize,
} from "./findMySize";

const gildan = [
  ["XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL"],
  ["Width, in", "16.00", "18.00", "20.00", "22.00", "24.00", "26.00", "28.00", "30.00", "32.00"],
  ["Length, in", "27.00", "28.00", "29.00", "30.00", "31.00", "32.00", "33.00", "34.00", "35.00"],
  ["Sleeve length, in", "7.99", "8.23", "8.50", "8.74", "9.02", "9.25", "9.49", "9.72", "9.96"],
  ["Size tolerance, in", "1.50", "1.50", "1.50", "1.50", "1.50", "1.50", "1.50", "1.50", "1.50"],
];

const comfort = [
  ["S", "M", "L", "XL", "2XL", "3XL", "4XL"],
  ["Width, in", "18.25", "20.25", "22.00", "24.00", "26.00", "27.75", "29.75"],
  ["Length, in", "26.62", "28.00", "29.37", "30.75", "31.62", "32.50", "33.50"],
  ["Sleeve length from center back, in", "16.25", "17.75", "19.00", "20.50", "21.75", "23.25", "24.63"],
  ["Size tolerance, in", "1.50", "1.50", "1.50", "1.50", "1.50", "1.50", "1.50"],
];

const offered = ["S", "M", "L", "XL", "2XL", "3XL"];

function guide(rows: unknown[][], model: string) {
  const parsed = measurementsFromPrintifyChart({ model, measurements: rows, selectedSizes: offered });
  if (!parsed) throw new Error("chart did not parse");
  return parsed;
}

describe("find my size", () => {
  it("names the garment shape from the product type", () => {
    expect(garmentShapeFromName("Unisex Softstyle T-Shirt")).toBe("tee");
    expect(garmentShapeFromName("Unisex Long Sleeve Shirt")).toBe("long-sleeve");
    expect(garmentShapeFromName("Unisex Crewneck Sweatshirt")).toBe("sweatshirt");
    expect(defaultEaseForShape("tee")).toEqual({ closer: 2, relaxed: 4, oversized: 8 });
  });

  it("keeps only the sizes the type sells, and the Printify numbers", () => {
    const softstyle = guide(gildan, "Gildan 64000");
    expect(softstyle.rows.map((row) => row.size)).toEqual(offered);
    expect(softstyle.rows.find((row) => row.size === "S")?.values.chestWidth).toBe(18);
    expect(softstyle.columns.map((column) => column.key)).toEqual(["chestWidth", "bodyLength", "sleeveLength"]);
    const dyed = guide(comfort, "Comfort Colors 1717");
    expect(dyed.rows.find((row) => row.size === "S")?.values).toMatchObject({ chestWidth: 18.25, bodyLength: 26.62 });
    expect(dyed.toleranceNote).toBe("Finished garment measurements can vary by ±1.50 in.");
  });

  it("suggests a starting size for the two sample bodies", () => {
    const ease = defaultEaseForShape("tee");
    const cases = [
      { chart: gildan, model: "Gildan 64000", height: 175, weight: 75, fit: "closer" as const, size: "L" },
      { chart: gildan, model: "Gildan 64000", height: 175, weight: 75, fit: "relaxed" as const, size: "XL" },
      { chart: gildan, model: "Gildan 64000", height: 175, weight: 75, fit: "oversized" as const, size: "2XL" },
      { chart: gildan, model: "Gildan 64000", height: 185, weight: 85, fit: "closer" as const, size: "XL" },
      { chart: gildan, model: "Gildan 64000", height: 185, weight: 85, fit: "relaxed" as const, size: "2XL" },
      { chart: gildan, model: "Gildan 64000", height: 185, weight: 85, fit: "oversized" as const, size: "3XL" },
      { chart: comfort, model: "Comfort Colors 1717", height: 175, weight: 75, fit: "closer" as const, size: "L" },
      { chart: comfort, model: "Comfort Colors 1717", height: 175, weight: 75, fit: "relaxed" as const, size: "XL" },
      { chart: comfort, model: "Comfort Colors 1717", height: 175, weight: 75, fit: "oversized" as const, size: "2XL" },
      { chart: comfort, model: "Comfort Colors 1717", height: 185, weight: 85, fit: "closer" as const, size: "XL" },
      { chart: comfort, model: "Comfort Colors 1717", height: 185, weight: 85, fit: "relaxed" as const, size: "2XL" },
      { chart: comfort, model: "Comfort Colors 1717", height: 185, weight: 85, fit: "oversized" as const, size: "3XL" },
    ];
    for (const sample of cases) {
      const parsed = guide(sample.chart, sample.model);
      const result = suggestSize({
        heightCm: sample.height,
        weightKg: sample.weight,
        fit: sample.fit,
        ease,
        columns: parsed.columns,
        rows: parsed.rows,
      });
      expect(result?.size, `${sample.model} ${sample.height}/${sample.weight} ${sample.fit}`).toBe(sample.size);
    }
    const body = estimateBodyChestInches(175, 75);
    expect(body).toBeGreaterThan(37);
    expect(body).toBeLessThan(40);
  });

  it("does not give a taller or heavier person a smaller size", () => {
    const ease = defaultEaseForShape("tee");
    const order = ["S", "M", "L", "XL", "2XL", "3XL"];
    const rank = (size: string) => order.indexOf(size);
    const charts = [
      { chart: gildan, model: "Gildan 64000" },
      { chart: comfort, model: "Comfort Colors 1717" },
    ];
    for (const sample of charts) {
      const parsed = guide(sample.chart, sample.model);
      for (const fit of ["closer", "relaxed", "oversized"] as const) {
        for (let weight = 45; weight <= 130; weight += 1) {
          let previous = -1;
          for (let height = 150; height <= 200; height += 1) {
            const size = suggestSize({
              heightCm: height,
              weightKg: weight,
              fit,
              ease,
              columns: parsed.columns,
              rows: parsed.rows,
            })?.size;
            const next = rank(size || "");
            expect(next, `${sample.model} ${height}cm ${weight}kg ${fit}`).toBeGreaterThanOrEqual(previous);
            previous = next;
          }
        }
        for (let height = 150; height <= 200; height += 1) {
          let previous = -1;
          for (let weight = 45; weight <= 130; weight += 1) {
            const size = suggestSize({
              heightCm: height,
              weightKg: weight,
              fit,
              ease,
              columns: parsed.columns,
              rows: parsed.rows,
            })?.size;
            const next = rank(size || "");
            expect(next, `${sample.model} ${height}cm ${weight}kg ${fit}`).toBeGreaterThanOrEqual(previous);
            previous = next;
          }
        }
      }
    }
    const dyed = guide(comfort, "Comfort Colors 1717");
    const at = (height: number) => suggestSize({
      heightCm: height,
      weightKg: 62,
      fit: "relaxed",
      ease,
      columns: dyed.columns,
      rows: dyed.rows,
    })?.size;
    expect(rank(at(165) || "")).toBeGreaterThanOrEqual(rank(at(155) || ""));
  });
});
