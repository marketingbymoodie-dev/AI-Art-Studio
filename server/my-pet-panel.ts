/**
 * A catalogue candidate stores one panel id, and the same candidate can be
 * published as two product types (Softstyle and Comfort Colors). Compositing
 * must use a scene that actually belongs to the product being rendered.
 */
import { colourMatchKeys } from "@shared/colourBlanks";

export type MyPetPanelRow = {
  panelId: string;
  isDefault?: boolean | null;
  kind?: string | null;
};

export function chooseMyPetPanelId(
  candidatePanelId: string | null | undefined,
  panels: MyPetPanelRow[],
): string | null {
  const rows = panels.filter((row) => row.panelId);
  const wanted = String(candidatePanelId || "").trim();
  if (wanted && rows.some((row) => row.panelId === wanted)) return wanted;
  const defaults = rows.filter((row) => row.isDefault).map((row) => row.panelId).sort();
  if (defaults.length) return defaults[0];
  const masters = rows.filter((row) => row.kind === "white-master").map((row) => row.panelId).sort();
  if (masters.length) return masters[0];
  const any = rows.map((row) => row.panelId).sort();
  return any[0] || null;
}

export type MyPetColour = { name: string; hex: string; linkStoredName?: string | null };

export type MyPetColourPalette = {
  requestedName?: string | null;
  publishTicks: readonly string[];
  sceneColours: readonly MyPetColour[];
  libraryColours: readonly MyPetColour[];
  selectedColors: readonly MyPetColour[];
};

function cleanHex(hex: string): string {
  const raw = String(hex || "").replace(/^#/, "").trim().toUpperCase();
  return /^[0-9A-F]{6}$/.test(raw) ? raw : "";
}

function sameColour(a: string, b: string): boolean {
  const left = new Set(colourMatchKeys(a));
  if (!left.size) return false;
  return colourMatchKeys(b).some((key) => left.has(key));
}

function namedHex(list: readonly MyPetColour[], name: string): MyPetColour | null {
  const hit = list.find((row) => sameColour(row.name, name) && cleanHex(row.hex));
  if (!hit) return null;
  return { name: hit.name, hex: cleanHex(hit.hex), linkStoredName: hit.linkStoredName };
}

/** Library name and its stored photograph name. "Light grey" and "Sport Grey" are one colour. */
function colourAliases(name: string, library: readonly MyPetColour[]): string[] {
  const out: string[] = [];
  const add = (value: string) => {
    const trimmed = String(value || "").trim();
    if (!trimmed || out.some((row) => sameColour(row, trimmed))) return;
    out.push(trimmed);
  };
  add(name);
  for (const row of library) {
    const link = String(row.linkStoredName || "").trim();
    if (!link) continue;
    if (sameColour(row.name, name) || sameColour(link, name)) {
      add(row.name);
      add(link);
    }
  }
  return out;
}

function withAlias(colour: MyPetColour, library: readonly MyPetColour[]): MyPetColour {
  const row = library.find((entry) => sameColour(entry.name, colour.name) || sameColour(String(entry.linkStoredName || ""), colour.name));
  const link = String(row?.linkStoredName || "").trim();
  const canonical = row && sameColour(row.name, colour.name) ? row.name : colour.name;
  const alias = link && !sameColour(link, canonical) ? link : (row && !sameColour(row.name, canonical) ? row.name : "");
  return alias ? { ...colour, name: canonical, linkStoredName: alias } : { ...colour, name: canonical };
}

/** Scene photo first, then this type's library hex, then a same-name tick. Never another colour. */
export function resolveNamedMyPetColour(name: string, palette: MyPetColourPalette): MyPetColour | null {
  const wanted = String(name || "").trim();
  if (!wanted) return null;
  const names = colourAliases(wanted, palette.libraryColours);
  const canonical = names.find((candidate) => palette.libraryColours.some((row) => sameColour(row.name, candidate))) || wanted;
  const scene = namedHex(palette.sceneColours, canonical)
    || names.map((candidate) => namedHex(palette.sceneColours, candidate)).find((hit) => hit);
  if (scene) return withAlias({ ...scene, name: namedHex(palette.sceneColours, canonical)?.name || canonical }, palette.libraryColours);
  const library = namedHex(palette.libraryColours, canonical)
    || names.map((candidate) => namedHex(palette.libraryColours, candidate)).find((hit) => hit);
  if (library) return withAlias(library, palette.libraryColours);
  const tick = palette.publishTicks.find((row) => names.some((candidate) => sameColour(row, candidate)));
  if (!tick) return null;
  const selected = namedHex(palette.selectedColors, tick) || names.map((candidate) => namedHex(palette.selectedColors, candidate)).find((hit) => hit);
  if (!selected) return null;
  return withAlias({ name: tick, hex: selected.hex }, palette.libraryColours);
}

/**
 * Colour for this product type. A name the shopper asked for that this type
 * does not sell resolves to null — it is not replaced with selectedColors[0].
 * An empty request uses the first ticked colour this type can render.
 */
export function resolveMyPetCompositeColor(palette: MyPetColourPalette): MyPetColour | null {
  const requested = String(palette.requestedName || "").trim();
  if (requested) return resolveNamedMyPetColour(requested, palette);
  for (const tick of palette.publishTicks) {
    const hit = resolveNamedMyPetColour(tick, palette);
    if (hit) return hit;
  }
  return namedHex(palette.sceneColours, palette.sceneColours[0]?.name || "");
}

/** Colours to precompose for this type. Drops names the scene and library cannot render. */
export function myPetCompositeColours(palette: MyPetColourPalette): MyPetColour[] {
  const source = palette.publishTicks.length
    ? palette.publishTicks
    : palette.selectedColors.map((color) => color.name);
  const out: MyPetColour[] = [];
  const seen = new Set<string>();
  const add = (color: MyPetColour | null) => {
    if (!color) return;
    const key = color.name.trim().toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(color);
  };
  for (const name of source) add(resolveNamedMyPetColour(name, palette));
  if (palette.requestedName) add(resolveNamedMyPetColour(palette.requestedName, palette));
  return out;
}
