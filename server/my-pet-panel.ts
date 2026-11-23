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

export type MyPetColour = { name: string; hex: string };

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
  return { name: hit.name, hex: cleanHex(hit.hex) };
}

/** Scene photo first, then this type's library hex, then a same-name tick. Never another colour. */
export function resolveNamedMyPetColour(name: string, palette: MyPetColourPalette): MyPetColour | null {
  const wanted = String(name || "").trim();
  if (!wanted) return null;
  const scene = namedHex(palette.sceneColours, wanted);
  if (scene) return scene;
  const library = namedHex(palette.libraryColours, wanted);
  if (library) return library;
  const tick = palette.publishTicks.find((row) => sameColour(row, wanted));
  if (!tick) return null;
  const selected = namedHex(palette.selectedColors, tick);
  if (!selected) return null;
  return { name: tick, hex: selected.hex };
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
