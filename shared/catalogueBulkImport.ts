/**
 * Parse a catalogue folder before anything is stored.
 * A failure anywhere refuses the whole batch.
 */
import { humourOperatorId } from "./flywheelRecipe";
import { PETPOSTEROUS_ART_STYLE_LAUNCH } from "./petposterousArtStyles";

export const CATALOGUE_IMPORT_COLUMNS = [
  "filename",
  "style",
  "species",
  "humour_operator",
  "truth",
  "device",
  "exact_wording",
] as const;

const LIMITS = { species: 80, truth: 400, device: 400, exactWording: 120 } as const;

export type CatalogueImportRow = {
  rowNumber: number;
  filename: string;
  style: string;
  species: string;
  humourOperator: string;
  truth: string;
  device: string;
  exactWording: string;
};

export type CatalogueImportPlan = {
  rows: CatalogueImportRow[];
  failures: string[];
};

function clip(value: string, max: number): string {
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

/** Basename safe to use as a storage key. Comparison is case-insensitive. */
export function catalogueImportObjectName(filename: string): string | null {
  const base = filename.split(/[/\\]/).pop()?.trim() || "";
  if (!/^[\w .()-]+\.png$/i.test(base)) return null;
  const stem = base.slice(0, -4);
  if (!stem || stem === "." || stem === "..") return null;
  return base.toLowerCase();
}

export function parseCatalogueCsv(text: string): string[][] {
  const src = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
          continue;
        }
        quoted = false;
        continue;
      }
      cell += ch;
      continue;
    }
    if (ch === '"') {
      quoted = true;
      continue;
    }
    if (ch === ",") {
      row.push(cell);
      cell = "";
      continue;
    }
    if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    cell += ch;
  }
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function blank(rowNumber: number, filename: string, field: string): string {
  const where = filename ? `Row ${rowNumber} (${filename})` : `Row ${rowNumber}`;
  return `${where}: ${field} is blank.`;
}

/**
 * Match one CSV to the PNGs dropped with it.
 * Rows are returned even when the batch is dirty, so the page can show them.
 * `failures` is every reason the batch cannot be created.
 */
export function planCatalogueImport(input: { csv: string; filenames: string[] }): CatalogueImportPlan {
  const failures: string[] = [];
  const uploaded = new Map<string, string>();
  for (const filename of input.filenames) {
    const objectName = catalogueImportObjectName(filename);
    const label = filename.split(/[/\\]/).pop()?.trim() || filename;
    if (!objectName) {
      failures.push(`${label} is not a PNG named with letters, numbers, spaces, dots, underscores, or hyphens.`);
      continue;
    }
    const prior = uploaded.get(objectName);
    if (prior) {
      failures.push(`${label} duplicates ${prior}.`);
      continue;
    }
    uploaded.set(objectName, label);
  }

  const table = parseCatalogueCsv(input.csv);
  const header = (table[0] || []).map((cell) => cell.trim());
  const headerOk = CATALOGUE_IMPORT_COLUMNS.every((column, index) => header[index] === column) && header.length === CATALOGUE_IMPORT_COLUMNS.length;
  if (!headerOk) {
    failures.push(`CSV header must be ${CATALOGUE_IMPORT_COLUMNS.join(", ")}.`);
    for (const label of uploaded.values()) failures.push(`${label} was uploaded and has no CSV row.`);
    return { rows: [], failures };
  }

  const rows: CatalogueImportRow[] = [];
  const seen = new Map<string, number>();
  for (let i = 1; i < table.length; i++) {
    const cells = table[i];
    if (cells.every((cell) => !cell.trim())) continue;
    const rowNumber = i + 1;
    const rawName = (cells[0] || "").trim();
    const filename = rawName.split(/[/\\]/).pop()?.trim() || "";
    const styleRaw = (cells[1] || "").trim();
    const speciesRaw = (cells[2] || "").trim();
    const humourRaw = (cells[3] || "").trim();
    const truthRaw = (cells[4] || "").trim();
    const deviceRaw = (cells[5] || "").trim();
    const wordingRaw = (cells[6] || "").trim();
    const objectName = catalogueImportObjectName(filename);

    if (!filename) failures.push(blank(rowNumber, "", "filename"));
    else if (!objectName) failures.push(`Row ${rowNumber} (${filename}): filename must be a PNG name using letters, numbers, spaces, dots, underscores, or hyphens.`);
    else {
      const prior = seen.get(objectName);
      if (prior) failures.push(`${filename} is on more than one row (${prior} and ${rowNumber}).`);
      else seen.set(objectName, rowNumber);
      if (!uploaded.has(objectName)) failures.push(`${filename} is in the CSV and was not uploaded.`);
    }

    const style = (PETPOSTEROUS_ART_STYLE_LAUNCH as readonly string[]).includes(styleRaw) ? styleRaw : "";
    if (!styleRaw) failures.push(blank(rowNumber, filename, "style"));
    else if (!style) failures.push(`Row ${rowNumber} (${filename}): style "${styleRaw}" is not one of ${PETPOSTEROUS_ART_STYLE_LAUNCH.join(", ")}.`);

    const species = clip(speciesRaw, LIMITS.species + 1);
    if (!species) failures.push(blank(rowNumber, filename, "species"));
    else if (species.length > LIMITS.species) failures.push(`Row ${rowNumber} (${filename}): species is longer than ${LIMITS.species} characters.`);

    const humourOperator = humourOperatorId(humourRaw) || "";
    if (!humourRaw) failures.push(blank(rowNumber, filename, "humour_operator"));
    else if (!humourOperator) failures.push(`Row ${rowNumber} (${filename}): humour_operator "${humourRaw}" is not one of the sixteen frameworks.`);

    const truth = clip(truthRaw, LIMITS.truth + 1);
    if (!truth) failures.push(blank(rowNumber, filename, "truth"));
    else if (truth.length > LIMITS.truth) failures.push(`Row ${rowNumber} (${filename}): truth is longer than ${LIMITS.truth} characters.`);

    const device = clip(deviceRaw, LIMITS.device + 1);
    if (!device) failures.push(blank(rowNumber, filename, "device"));
    else if (device.length > LIMITS.device) failures.push(`Row ${rowNumber} (${filename}): device is longer than ${LIMITS.device} characters.`);

    const exactWording = clip(wordingRaw, LIMITS.exactWording + 1);
    if (exactWording.length > LIMITS.exactWording) failures.push(`Row ${rowNumber} (${filename}): exact_wording is longer than ${LIMITS.exactWording} characters.`);

    rows.push({
      rowNumber,
      filename: objectName ? uploaded.get(objectName) || filename : filename,
      style: style || styleRaw,
      species: species.length > LIMITS.species ? speciesRaw : species,
      humourOperator: humourOperator || humourRaw,
      truth: truth.length > LIMITS.truth ? truthRaw : truth,
      device: device.length > LIMITS.device ? deviceRaw : device,
      exactWording: exactWording.length > LIMITS.exactWording ? wordingRaw : exactWording,
    });
  }

  if (!rows.length) failures.push("The CSV has no design rows.");

  for (const [objectName, label] of uploaded) {
    if (!seen.has(objectName)) failures.push(`${label} was uploaded and has no CSV row.`);
  }

  return { rows, failures };
}
