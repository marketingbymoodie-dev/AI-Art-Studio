/** Colour list for the mockup-library blank grid. Compose still matches the stored row name. */
import { normalizePrintifyColorKey, slugPrintifyColorId } from "./printifyColorSlug";

export type BlankFinish = "solid" | "heather" | "produced";

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

/**
 * Scene colours the studio may offer. An empty active list keeps every stored
 * colour (a type with no colour list). Otherwise only names on that list remain,
 * in list order, so an old test photograph cannot be selected.
 */
export function listedSceneColours<T extends { name: string }>(
  colours: readonly T[],
  activeNames: readonly string[],
): T[] {
  if (!activeNames.length) return [...colours];
  const byKey = new Map<string, T>();
  for (const colour of colours) {
    const key = blankNameKey(colour.name);
    if (key && !byKey.has(key)) byKey.set(key, colour);
  }
  const listed: T[] = [];
  for (const name of activeNames) {
    const hit = byKey.get(blankNameKey(name));
    if (hit) listed.push(hit);
  }
  return listed;
}

/** Name, slug, and hyphen forms so a stored colour id matches the list name. */
export function colourMatchKeys(name: string): string[] {
  const raw = name.trim();
  if (!raw || raw.toLowerCase() === "default") return [];
  return [...new Set([
    blankNameKey(raw),
    slugPrintifyColorId(raw),
    normalizePrintifyColorKey(raw),
  ])];
}

export function frameColourHidden(name: unknown, id: unknown, hidden: Set<string>): boolean {
  if (!hidden.size) return false;
  const values = [name, id].filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  return values.some((value) => colourMatchKeys(value).some((key) => hidden.has(key)));
}

export type ColourBlankSwatch = { name: string; hex: string; sortOrder: number };

/** Storefront and Studio swatches take hex and order from the Colour blanks list. */
export function overlayBlankSwatches<T extends { name?: string; id?: string; hex?: string }>(
  colours: T[],
  blanks: readonly ColourBlankSwatch[],
): T[] {
  if (!blanks.length || !colours.length) return colours;
  const byKey = new Map<string, { hex: string; sortOrder: number }>();
  blanks.forEach((row, index) => {
    const hex = String(row.hex || "").replace(/^#/, "").trim().toUpperCase();
    const sortOrder = Number.isFinite(row.sortOrder) ? row.sortOrder : index;
    for (const key of colourMatchKeys(row.name)) {
      if (!byKey.has(key)) byKey.set(key, { hex, sortOrder });
    }
  });
  return colours
    .map((colour, index) => {
      const keys = [
        ...colourMatchKeys(String(colour.name || "")),
        ...colourMatchKeys(String(colour.id || "")),
      ];
      const hit = keys.map((key) => byKey.get(key)).find(Boolean);
      if (!hit) return { colour, order: 100000 + index };
      const hex = /^[0-9A-F]{6}$/.test(hit.hex) ? hit.hex : colour.hex;
      return { colour: { ...colour, hex }, order: hit.sortOrder };
    })
    .sort((a, b) => a.order - b.order)
    .map((row) => row.colour);
}

export function describeColourUse(
  name: string,
  products: string[],
  orders: Array<{ id: number; status: string }>,
): string | null {
  const productTitles = [...new Set(products.map((title) => title.trim()).filter(Boolean))];
  const openOrders = orders.filter((order) => Number.isInteger(order.id));
  if (!productTitles.length && !openOrders.length) return null;
  const parts: string[] = [];
  if (productTitles.length) {
    const shown = productTitles.slice(0, 3).map((title) => `"${title}"`).join(", ");
    const more = productTitles.length > 3 ? ` and ${productTitles.length - 3} more` : "";
    parts.push(`${productTitles.length === 1 ? "the published product" : "the published products"} ${shown}${more}`);
  }
  if (openOrders.length) {
    const shown = openOrders.slice(0, 3).map((order) => `#${order.id} (${order.status})`).join(", ");
    const more = openOrders.length > 3 ? ` and ${openOrders.length - 3} more` : "";
    parts.push(`${openOrders.length === 1 ? "open order" : "open orders"} ${shown}${more}`);
  }
  return `${name} is on ${parts.join(" and ")}.`;
}

export type ComposeBlankRow = {
  id: string;
  name: string;
  hex: string;
  kind: "produced" | "white-master";
  maskSource?: string | null;
};

export type InUseBlankKind = "produced" | "white-master";

export type InUseBlankPanel = {
  panelId: string;
  name: string;
  kind: string;
};

/**
 * Newest blank per scene. A produced photo counts. So does a colour whose own
 * in-use blank is the white master (White). Repainting some other colour from
 * that master does not.
 * Panels must be newest first.
 */
export function inUseBlankKind(
  panelsNewestFirst: readonly InUseBlankPanel[],
  colourName: string,
): InUseBlankKind | null {
  const wanted = blankNameKey(colourName);
  if (!wanted) return null;
  const seen = new Set<string>();
  let produced = false;
  let whiteMaster = false;
  for (const panel of panelsNewestFirst) {
    const key = blankNameKey(panel.name || "");
    if (key !== wanted) continue;
    const slot = `${panel.panelId}\0${key}`;
    if (seen.has(slot)) continue;
    seen.add(slot);
    if (panel.kind === "produced") produced = true;
    else if (panel.kind === "white-master") whiteMaster = true;
  }
  if (produced) return "produced";
  if (whiteMaster) return "white-master";
  return null;
}

/**
 * Same choice the in-use blank makes: a real photograph of this colour,
 * otherwise a painted approval, otherwise the white master is repainted.
 * Rows must be newest first.
 */
export function composeBlankChoice(
  rowsNewestFirst: readonly ComposeBlankRow[],
  requestedName: string,
): { mode: "produced" | "recolour" | "unavailable"; sourceName: string; rowId: string | null } {
  const exact = newestUploadedBlank(rowsNewestFirst, requestedName);
  if (exact && blankNameKey(exact.name) === blankNameKey(requestedName)) {
    return { mode: "produced", sourceName: exact.name, rowId: exact.id };
  }
  const white = rowsNewestFirst.find((row) => row.kind === "white-master");
  if (white) return { mode: "recolour", sourceName: white.name, rowId: white.id };
  return { mode: "unavailable", sourceName: "", rowId: null };
}

export type UploadedBlankRow = {
  name: string;
  kind: string;
  maskSource?: string | null;
};

/**
 * A stored blank the operator approved. That includes an approved paint
 * (`copied-from-white` or `painted`) and an uploaded photograph.
 * A colour with no stored row is still an unapproved recolour and is not publishable.
 */
export function isUploadedBlank(row: UploadedBlankRow): boolean {
  return row.kind === "produced" || row.kind === "white-master";
}

/** An approval painted from the white master. A photograph uses some other mask source. */
export function isPaintedBlank(row: UploadedBlankRow): boolean {
  const source = String(row.maskSource || "").trim();
  return source === "painted" || source === "copied-from-white";
}

/**
 * Real photograph for this colour, even when a later paint is newer.
 * A painted approval is used only when this colour has no photograph.
 * The linked name is used only when the colour itself has no stored row.
 * Rows must be newest first.
 */
export function newestUploadedBlank<T extends UploadedBlankRow>(
  rowsNewestFirst: readonly T[],
  colourName: string,
  linkedName?: string | null,
): T | null {
  const names: string[] = [];
  for (const name of [colourName, linkedName || ""]) {
    const key = blankNameKey(name);
    if (key && !names.includes(key)) names.push(key);
  }
  for (const name of names) {
    const matches = rowsNewestFirst.filter((row) => blankNameKey(row.name) === name && isUploadedBlank(row));
    const photo = matches.find((row) => !isPaintedBlank(row));
    if (photo) return photo;
    if (matches[0]) return matches[0];
  }
  return null;
}

export function noPhotographMessage(colourName: string, typeName: string): string {
  return `${colourName} has no photograph on ${typeName}. Upload a blank before publishing this colour.`;
}

export function compareBlankScenes(a: { panelId: string; label?: string }, b: { panelId: string; label?: string }): number {
  const num = (value: string) => {
    const match = value.match(/(\d+)\s*$/);
    return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
  };
  const left = num(a.label || a.panelId);
  const right = num(b.label || b.panelId);
  if (left !== right) return left - right;
  return a.panelId.localeCompare(b.panelId);
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
