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
};

const SCENE = /^Mockup_\d+$/i;
const FILE = /_([0-9A-Fa-f]{6})(?:_[A-Za-z0-9]+)?\.(png|jpe?g|webp)$/i;

export function parseMockupImport(relativePaths: string[]): MockupImportPlan {
  const rows: MockupPlanRow[] = [];
  const problems: MockupPlanProblem[] = [];
  const seen = new Map<string, string>();
  for (const relativePath of relativePaths) {
    const parts = relativePath.split(/[/\\]/).filter(Boolean);
    const filename = parts[parts.length - 1] || relativePath;
    if (!filename || filename.startsWith(".")) continue;
    const panelId = parts.find((part) => SCENE.test(part));
    const hexMatch = filename.match(FILE);
    if (!panelId || !hexMatch) {
      if (/\.(png|jpe?g|webp)$/i.test(filename)) {
        problems.push({ relativePath, message: "No Mockup_NN folder or no 6-digit hex in the filename." });
      }
      continue;
    }
    const hex = hexMatch[1].toUpperCase();
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
  return { rows, problems };
}
