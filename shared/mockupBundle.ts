/** Parse a Petposterous_Mockups folder. Nothing is stored here. */

export const MOCKUP_COLOUR_NAMES: Record<string, string> = {
  FFFFFF: "White",
  "819E87": "Sage",
  "25282A": "Black",
  "97999B": "Light grey",
  "66676C": "Dark grey",
  AC2B37: "Red",
  "0077B5": "Blue",
  DD74A1: "Pink",
};

export type MockupPlanRow = {
  relativePath: string;
  filename: string;
  panelId: string;
  hex: string;
  garmentColor: string;
  kind: "white-master" | "produced";
  knownHex: boolean;
};

export type MockupPlanProblem = { relativePath: string; message: string };

export type MockupImportPlan = {
  rows: MockupPlanRow[];
  problems: MockupPlanProblem[];
  notes: string[];
};

/** A mask whose area is this far from its scene's median asks for a look. */
export const MASK_AREA_FAR = 0.12;

export function sceneMedian(areas: number[]): number | null {
  if (!areas.length) return null;
  const sorted = [...areas].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Marks on the contact sheet. Touching the frame is not one of them. */
export function mockupSheetMarks(
  cell: { error: string; areaFraction: number; disconnected: boolean },
  median: number | null,
): string[] {
  const reasons: string[] = [];
  if (cell.error) reasons.push(cell.error);
  if (median != null && Math.abs(cell.areaFraction - median) > MASK_AREA_FAR) reasons.push("area far from this scene");
  if (cell.disconnected) reasons.push("disconnected");
  return reasons;
}

const SCENE = /^Mockup_\d+$/i;
const FILE = /^(Mockup_\d+)_([0-9A-Fa-f]{6})\.png$/i;

export function parseMockupImport(relativePaths: string[]): MockupImportPlan {
  const rows: MockupPlanRow[] = [];
  const problems: MockupPlanProblem[] = [];
  const notes: string[] = [];
  const seen = new Map<string, string>();
  for (const relativePath of relativePaths) {
    const parts = relativePath.split(/[/\\]/).filter(Boolean);
    const filename = parts[parts.length - 1] || relativePath;
    if (!filename || filename.startsWith(".")) continue;
    const panelId = parts.find((part) => SCENE.test(part));
    const hexMatch = filename.match(FILE);
    if (!hexMatch) {
      if (/\.(png|jpe?g|webp)$/i.test(filename)) {
        notes.push(`${filename} is not named Mockup_NN_HEX.png, so it is left out.`);
      }
      continue;
    }
    if (!panelId) {
      problems.push({ relativePath, message: `${filename} is not inside a Mockup_NN folder.` });
      continue;
    }
    const fileScene = hexMatch[1];
    const hex = hexMatch[2].toUpperCase();
    if (fileScene.toLowerCase() !== panelId.toLowerCase()) {
      problems.push({ relativePath, message: `${filename} is in ${panelId}, not ${fileScene}.` });
      continue;
    }
    const key = `${panelId}:${hex}`;
    const prior = seen.get(key);
    if (prior) {
      problems.push({ relativePath, message: `${hex} is already ${prior} in ${panelId}.` });
      continue;
    }
    seen.set(key, filename);
    rows.push({
      relativePath,
      filename,
      panelId,
      hex,
      garmentColor: MOCKUP_COLOUR_NAMES[hex] || hex,
      kind: hex === "FFFFFF" ? "white-master" : "produced",
      knownHex: Object.prototype.hasOwnProperty.call(MOCKUP_COLOUR_NAMES, hex),
    });
  }
  rows.sort((a, b) => a.panelId.localeCompare(b.panelId) || a.hex.localeCompare(b.hex));
  const byPanel = new Map<string, MockupPlanRow[]>();
  for (const row of rows) {
    const list = byPanel.get(row.panelId) || [];
    list.push(row);
    byPanel.set(row.panelId, list);
  }
  for (const [panelId, list] of byPanel) {
    if (!list.some((row) => row.kind === "white-master")) {
      problems.push({ relativePath: panelId, message: `${panelId} has no FFFFFF white master.` });
    }
  }
  return { rows, problems, notes };
}
