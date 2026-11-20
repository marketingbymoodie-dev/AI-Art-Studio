/**
 * Find my size. Garment numbers come from the product type.
 * The chest estimate is the unisex average of the male and female
 * chest-circumference regressions in Park et al., hierarchical estimation
 * from the 1988 US Army survey (stature in millimetres, weight in tenths
 * of a kilogram, circumference in millimetres).
 */

export type GarmentShape = "tee" | "long-sleeve" | "sweatshirt";

export type MeasurementRole = "chest" | "length" | "other";

export type MeasurementColumn = {
  key: string;
  label: string;
  role: MeasurementRole;
};

export type MeasurementRow = {
  size: string;
  /** Inches. */
  values: Record<string, number>;
};

export type GarmentMeasurements = {
  model: string;
  columns: MeasurementColumn[];
  rows: MeasurementRow[];
  /** Plain sentence. Empty when the chart has no single tolerance. */
  toleranceNote: string;
};

export type FitId = "closer" | "relaxed" | "oversized";

export type FitEase = Record<FitId, number>;

export type FindMySizeGuide = {
  productTypeId: number;
  garmentWord: string;
  shape: GarmentShape;
  ease: FitEase;
  measurements: GarmentMeasurements;
  guarantee: { title: string; detail: string; url: string } | null;
};

export const FIT_ORDER: FitId[] = ["closer", "relaxed", "oversized"];

export function garmentShapeFromName(name: string): GarmentShape {
  const lower = name.toLowerCase();
  if (/hoodie|sweatshirt|\bcrewneck\b/.test(lower)) return "sweatshirt";
  if (/long[\s-]?sleeve/.test(lower)) return "long-sleeve";
  return "tee";
}

/** Inches of ease added to the estimated body chest. A shape can differ later. */
export function defaultEaseForShape(_shape: GarmentShape): FitEase {
  return { closer: 2, relaxed: 4, oversized: 8 };
}

const MALE_CHEST = { intercept: 928.002, stature: -0.242, weight: 0.622 };
const FEMALE_CHEST = { intercept: 916.48, stature: -0.282, weight: 0.727 };

function chestMillimetres(
  coeff: { intercept: number; stature: number; weight: number },
  heightCm: number,
  weightKg: number,
): number {
  return coeff.intercept + coeff.stature * (heightCm * 10) + coeff.weight * (weightKg * 10);
}

/** Unisex body chest circumference, in inches. */
export function estimateBodyChestInches(heightCm: number, weightKg: number): number | null {
  if (!(heightCm > 0) || !(weightKg > 0)) return null;
  const male = chestMillimetres(MALE_CHEST, heightCm, weightKg);
  const female = chestMillimetres(FEMALE_CHEST, heightCm, weightKg);
  return (male + female) / 2 / 25.4;
}

export function garmentChestInches(row: MeasurementRow, columns: MeasurementColumn[]): number | null {
  const chest = columns.find((column) => column.role === "chest");
  if (!chest) return null;
  const width = row.values[chest.key];
  if (!(width > 0)) return null;
  return width * 2;
}

/**
 * Smallest offered size whose garment chest is at least the estimated body
 * chest plus the chosen ease. Clamps to the last size when even that is small.
 */
export function suggestSize(args: {
  heightCm: number;
  weightKg: number;
  fit: FitId;
  ease: FitEase;
  columns: MeasurementColumn[];
  rows: MeasurementRow[];
}): { size: string; bodyChestInches: number; targetChestInches: number } | null {
  const body = estimateBodyChestInches(args.heightCm, args.weightKg);
  if (body == null) return null;
  const ease = args.ease[args.fit];
  if (!(ease >= 0)) return null;
  const target = body + ease;
  const ranked = args.rows
    .map((row) => ({ size: row.size, chest: garmentChestInches(row, args.columns) }))
    .filter((row): row is { size: string; chest: number } => row.chest != null);
  if (!ranked.length) return null;
  const fit = ranked.find((row) => row.chest + 1e-9 >= target) || ranked[ranked.length - 1];
  return { size: fit.size, bodyChestInches: body, targetChestInches: target };
}

export function columnFromChartLabel(label: string): MeasurementColumn | null {
  const clean = label.replace(/,\s*in\b/i, "").trim();
  const lower = clean.toLowerCase();
  if (!clean || /tolerance/.test(lower)) return null;
  if (/^width\b/.test(lower)) return { key: "chestWidth", label: "Chest width", role: "chest" };
  if (/^length\b/.test(lower) && !/sleeve/.test(lower)) return { key: "bodyLength", label: "Body length", role: "length" };
  if (/sleeve/.test(lower)) return { key: "sleeveLength", label: "Sleeve length", role: "other" };
  const key = lower.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (!key) return null;
  return { key, label: clean, role: "other" };
}

function numeric(value: unknown): number | null {
  const number = Number(String(value ?? "").trim());
  return Number.isFinite(number) ? number : null;
}

/** Printify chart rows, limited to the sizes this type actually sells. */
export function measurementsFromPrintifyChart(args: {
  model: string;
  measurements: unknown[][];
  selectedSizes: string[];
}): GarmentMeasurements | null {
  const rows = args.measurements.filter((row) => Array.isArray(row) && row.length > 1);
  if (rows.length < 2) return null;
  const header = rows[0].map((cell) => String(cell ?? "").trim());
  const selected = new Set(args.selectedSizes.map((size) => size.toLowerCase()));
  const keep = header
    .map((size, index) => ({ size, index }))
    .filter((cell) => cell.size && selected.has(cell.size.toLowerCase()));
  if (!keep.length) return null;

  const columns: MeasurementColumn[] = [];
  const built: MeasurementRow[] = keep.map((cell) => ({ size: cell.size, values: {} }));
  const tolerances: number[] = [];
  for (const source of rows.slice(1)) {
    const column = columnFromChartLabel(String(source[0] ?? ""));
    if (!column) {
      if (/tolerance/i.test(String(source[0] ?? ""))) {
        for (const cell of keep) {
          const value = numeric(source[cell.index + 1]);
          if (value != null) tolerances.push(value);
        }
      }
      continue;
    }
    if (columns.some((existing) => existing.key === column.key)) continue;
    columns.push(column);
    keep.forEach((cell, rowIndex) => {
      // Chart size names have no label cell. Each measurement row does.
      const value = numeric(source[cell.index + 1]);
      if (value != null) built[rowIndex].values[column.key] = value;
    });
  }
  if (!columns.some((column) => column.role === "chest") || built.every((row) => garmentChestInches(row, columns) == null)) {
    return null;
  }
  const uniqueTolerance = [...new Set(tolerances.map((value) => value.toFixed(2)))];
  const toleranceNote = uniqueTolerance.length === 1
    ? `Finished garment measurements can vary by ±${uniqueTolerance[0]} in.`
    : "";
  return {
    model: args.model.trim(),
    columns,
    rows: built,
    toleranceNote,
  };
}

export function inchesToCentimetres(inches: number): number {
  return inches * 2.54;
}
