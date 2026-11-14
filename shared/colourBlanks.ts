/** Colour list for the mockup-library blank grid. Compose still matches the stored row name. */

export type BlankFinish = "solid" | "heather";

export type ColourBlankSeed = {
  name: string;
  printifyOptionId: number;
  printifyTitle: string;
  hex: string;
  finish: BlankFinish;
  linkStoredName: string | null;
  sortOrder: number;
};

/**
 * Printify Choice chips for blueprint 145 / provider 99.
 * Sport Grey is the existing option 358. The photograph is stored as "Light grey".
 */
export const SOFTSTYLE_COLOUR_SEED: ColourBlankSeed[] = [
  { name: "White", printifyOptionId: 521, printifyTitle: "White", hex: "FFFFFF", finish: "solid", linkStoredName: null, sortOrder: 0 },
  { name: "Black", printifyOptionId: 418, printifyTitle: "Black", hex: "000000", finish: "solid", linkStoredName: null, sortOrder: 1 },
  { name: "Sport Grey", printifyOptionId: 358, printifyTitle: "Sport Grey", hex: "CACACA", finish: "heather", linkStoredName: "Light grey", sortOrder: 2 },
  { name: "Light Blue", printifyOptionId: 392, printifyTitle: "Light Blue", hex: "D6E6F7", finish: "solid", linkStoredName: null, sortOrder: 3 },
  { name: "Military Green", printifyOptionId: 364, printifyTitle: "Military Green", hex: "62664C", finish: "solid", linkStoredName: null, sortOrder: 4 },
  { name: "Natural", printifyOptionId: 552, printifyTitle: "Natural", hex: "FFF6E3", finish: "solid", linkStoredName: null, sortOrder: 5 },
  { name: "Navy", printifyOptionId: 511, printifyTitle: "Navy", hex: "1A2237", finish: "solid", linkStoredName: null, sortOrder: 6 },
  { name: "Red", printifyOptionId: 423, printifyTitle: "Red", hex: "C62A32", finish: "solid", linkStoredName: null, sortOrder: 7 },
  { name: "Royal", printifyOptionId: 425, printifyTitle: "Royal", hex: "084F97", finish: "solid", linkStoredName: null, sortOrder: 8 },
  { name: "Dark Heather", printifyOptionId: 367, printifyTitle: "Dark Heather", hex: "454545", finish: "heather", linkStoredName: null, sortOrder: 9 },
];

export function normaliseBlankHex(hex: string): string {
  const raw = hex.replace(/^#/, "").trim().toUpperCase();
  if (!/^[0-9A-F]{6}$/.test(raw)) throw new Error("Hex must be six characters");
  return raw;
}

export function blankNameKey(name: string): string {
  return name.trim().toLowerCase();
}

export type ComposeBlankRow = {
  id: string;
  name: string;
  hex: string;
  kind: "produced" | "white-master";
};

/**
 * Same choice compose makes: an exact name uses that photograph,
 * otherwise the white master is repainted. Rows must be newest first.
 */
export function composeBlankChoice(
  rowsNewestFirst: readonly ComposeBlankRow[],
  requestedName: string,
): { mode: "produced" | "recolour" | "unavailable"; sourceName: string; rowId: string | null } {
  const wanted = blankNameKey(requestedName);
  const exact = rowsNewestFirst.find((row) => blankNameKey(row.name) === wanted);
  if (exact) return { mode: "produced", sourceName: exact.name, rowId: exact.id };
  const white = rowsNewestFirst.find((row) => row.kind === "white-master");
  if (white) return { mode: "recolour", sourceName: white.name, rowId: white.id };
  return { mode: "unavailable", sourceName: "", rowId: null };
}

/** Exact stored name, a suggested link, or nothing. */
export function blankNameMatch(
  colourName: string,
  linkStoredName: string | null,
  storedNames: readonly string[],
): { state: "present" } | { state: "name-mismatch"; storedName: string } | { state: "missing" } {
  const wanted = blankNameKey(colourName);
  if (storedNames.some((name) => blankNameKey(name) === wanted)) return { state: "present" };
  const link = (linkStoredName || "").trim();
  if (link) {
    const hit = storedNames.find((name) => blankNameKey(name) === blankNameKey(link));
    if (hit) return { state: "name-mismatch", storedName: hit };
  }
  return { state: "missing" };
}
