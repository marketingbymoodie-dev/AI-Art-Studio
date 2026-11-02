/**
 * Parse a catalogue folder before anything is stored.
 * A CSV is optional. Images with no row are drafted, not refused.
 * Field problems stay on the row so the review table can fix them.
 * A structural problem refuses the batch before anything is created.
 */
import { humourOperatorId } from "./flywheelRecipe";
import { PETPOSTEROUS_ART_STYLE_LAUNCH } from "./petposterousArtStyles";
import { PETPOSTEROUS_CONCEPT_FRAMEWORKS } from "./petposterousCreative";

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

/** Sonnet 4.6 list price, USD per million tokens. The listing writer uses this model. */
const SONNET_46 = { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 };

const MODEL_RATES: Record<string, { input: number; output: number; cacheWrite: number; cacheRead: number }> = {
  "claude-sonnet-4-6": SONNET_46,
  "claude-sonnet-4-5": SONNET_46,
};

export type CatalogueConfidence = { style: boolean; humourOperator: boolean };

export type CatalogueImportRow = {
  rowNumber: number;
  filename: string;
  style: string;
  species: string;
  humourOperator: string;
  truth: string;
  device: string;
  exactWording: string;
  /** csv rows are not sent to the vision model. */
  source: "csv" | "draft";
  lowConfidence: CatalogueConfidence;
};

export type CatalogueImportPlan = {
  rows: CatalogueImportRow[];
  failures: string[];
};

export type CatalogueDraftUsage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
};

function clip(value: string, max: number): string {
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

function trimEdges(value: string): string {
  return value.replace(/^\s+|\s+$/g, "");
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

export function emptyCatalogueRow(filename: string, rowNumber: number, source: "csv" | "draft"): CatalogueImportRow {
  return {
    rowNumber,
    filename,
    style: "",
    species: "",
    humourOperator: "",
    truth: "",
    device: "",
    exactWording: "",
    source,
    lowConfidence: { style: false, humourOperator: false },
  };
}

function uploadMap(filenames: string[]): { uploaded: Map<string, string>; failures: string[] } {
  const failures: string[] = [];
  const uploaded = new Map<string, string>();
  for (const filename of filenames) {
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
  return { uploaded, failures };
}

/**
 * Why this row cannot be created yet. Empty when the operator can confirm it.
 * Low confidence does not add an issue once the field holds a valid value.
 */
export function catalogueRowIssues(row: Pick<CatalogueImportRow, "filename" | "style" | "species" | "humourOperator" | "truth" | "device" | "exactWording">): string[] {
  const issues: string[] = [];
  const where = row.filename || "This row";
  if (!(PETPOSTEROUS_ART_STYLE_LAUNCH as readonly string[]).includes(row.style)) {
    issues.push(row.style
      ? `${where}: style "${row.style}" is not one of ${PETPOSTEROUS_ART_STYLE_LAUNCH.join(", ")}.`
      : `${where}: style is blank.`);
  }
  const species = clip(row.species || "", LIMITS.species + 1);
  if (!species) issues.push(`${where}: species is blank.`);
  else if (species.length > LIMITS.species) issues.push(`${where}: species is longer than ${LIMITS.species} characters.`);
  if (!humourOperatorId(row.humourOperator)) {
    issues.push(row.humourOperator
      ? `${where}: humour_operator "${row.humourOperator}" is not one of the sixteen frameworks.`
      : `${where}: humour_operator is blank.`);
  }
  const truth = clip(row.truth || "", LIMITS.truth + 1);
  if (!truth) issues.push(`${where}: truth is blank.`);
  else if (truth.length > LIMITS.truth) issues.push(`${where}: truth is longer than ${LIMITS.truth} characters.`);
  const device = clip(row.device || "", LIMITS.device + 1);
  if (!device) issues.push(`${where}: device is blank.`);
  else if (device.length > LIMITS.device) issues.push(`${where}: device is longer than ${LIMITS.device} characters.`);
  if (trimEdges(row.exactWording || "").length > LIMITS.exactWording) {
    issues.push(`${where}: exact_wording is longer than ${LIMITS.exactWording} characters.`);
  }
  return issues;
}

/**
 * Accept a vision draft. An unsure style or humour operator is left blank
 * and marked low-confidence. exact_wording is trimmed, never rewritten.
 */
export function normaliseCatalogueDraft(raw: unknown): Omit<CatalogueImportRow, "rowNumber" | "filename" | "source"> | null {
  const record = raw && typeof raw === "object" ? raw as Record<string, unknown> : null;
  if (!record) return null;
  const text = (key: string) => typeof record[key] === "string" ? record[key] : "";
  const high = (key: string) => String(record[key] || "").trim().toLowerCase() === "high";
  const styleRaw = text("style").trim();
  const styleValid = (PETPOSTEROUS_ART_STYLE_LAUNCH as readonly string[]).includes(styleRaw);
  const styleSure = high("style_confidence") && styleValid;
  const humourRaw = text("humour_operator").trim();
  const humourSure = high("humour_confidence") && !!humourOperatorId(humourRaw);
  const species = clip(text("species"), LIMITS.species);
  const truth = clip(text("truth"), LIMITS.truth);
  const device = clip(text("device"), LIMITS.device);
  return {
    style: styleSure ? styleRaw : "",
    species,
    humourOperator: humourSure ? humourOperatorId(humourRaw) || "" : "",
    truth,
    device,
    exactWording: trimEdges(text("exact_wording")),
    lowConfidence: { style: !styleSure, humourOperator: !humourSure },
  };
}

/** USD from Anthropic usage. Null when this model has no published rate here. */
export function catalogueDraftCostUsd(usage: CatalogueDraftUsage, model: string): number | null {
  const rate = MODEL_RATES[model];
  if (!rate) return null;
  const input = Math.max(0, Number(usage.input_tokens) || 0);
  const output = Math.max(0, Number(usage.output_tokens) || 0);
  const cacheWrite = Math.max(0, Number(usage.cache_creation_input_tokens) || 0);
  const cacheRead = Math.max(0, Number(usage.cache_read_input_tokens) || 0);
  return (input * rate.input + output * rate.output + cacheWrite * rate.cacheWrite + cacheRead * rate.cacheRead) / 1_000_000;
}

/**
 * Match an optional CSV to the PNGs dropped with it.
 * No CSV: every PNG is a draft row. A CSV row wins and is not drafted.
 * A PNG with no CSV row is a draft row, not a failure.
 */
export function planCatalogueImport(input: { csv?: string; filenames: string[] }): CatalogueImportPlan {
  const { uploaded, failures } = uploadMap(input.filenames);
  const csv = String(input.csv || "");
  if (!csv.trim()) {
    if (!uploaded.size && !failures.length) failures.push("The folder has no PNGs.");
    const rows = [...uploaded.values()].map((filename, index) => emptyCatalogueRow(filename, index + 1, "draft"));
    return { rows, failures };
  }

  const table = parseCatalogueCsv(csv);
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
    const wordingRaw = trimEdges(cells[6] || "");
    const objectName = catalogueImportObjectName(filename);
    const style = (PETPOSTEROUS_ART_STYLE_LAUNCH as readonly string[]).includes(styleRaw) ? styleRaw : "";
    const speciesClipped = clip(speciesRaw, LIMITS.species + 1);
    const humourOperator = humourOperatorId(humourRaw) || "";
    const truthClipped = clip(truthRaw, LIMITS.truth + 1);
    const deviceClipped = clip(deviceRaw, LIMITS.device + 1);

    if (!filename) failures.push(blank(rowNumber, "", "filename"));
    else if (!objectName) failures.push(`Row ${rowNumber} (${filename}): filename must be a PNG name using letters, numbers, spaces, dots, underscores, or hyphens.`);
    else {
      const prior = seen.get(objectName);
      if (prior) failures.push(`${filename} is on more than one row (${prior} and ${rowNumber}).`);
      else seen.set(objectName, rowNumber);
      if (!uploaded.has(objectName)) failures.push(`${filename} is in the CSV and was not uploaded.`);
    }

    rows.push({
      rowNumber,
      filename: objectName ? uploaded.get(objectName) || filename : filename,
      style: style || styleRaw,
      species: speciesClipped.length > LIMITS.species ? speciesRaw : speciesClipped,
      humourOperator: humourOperator || humourRaw,
      truth: truthClipped.length > LIMITS.truth ? truthRaw : truthClipped,
      device: deviceClipped.length > LIMITS.device ? deviceRaw : deviceClipped,
      exactWording: wordingRaw,
      source: "csv",
      lowConfidence: { style: false, humourOperator: false },
    });
  }

  let nextNumber = (rows[rows.length - 1]?.rowNumber || 1) + 1;
  for (const [objectName, label] of uploaded) {
    if (seen.has(objectName)) continue;
    rows.push(emptyCatalogueRow(label, nextNumber, "draft"));
    nextNumber += 1;
  }
  if (!rows.length && !failures.length) failures.push("The folder has no PNGs.");
  return { rows, failures };
}

/** The review table, checked again at create. Field edits are included. Drafts are not re-run. */
export function reviewCatalogueImport(input: { filenames: string[]; rows: CatalogueImportRow[] }): { failures: string[] } {
  const { uploaded, failures } = uploadMap(input.filenames);
  const seen = new Map<string, number>();
  for (const row of input.rows) {
    const objectName = catalogueImportObjectName(row.filename);
    if (!objectName) {
      failures.push(`${row.filename || "A row"} is not a PNG named with letters, numbers, spaces, dots, underscores, or hyphens.`);
      continue;
    }
    const prior = seen.get(objectName);
    if (prior) {
      failures.push(`${row.filename} is on more than one row (${prior} and ${row.rowNumber}).`);
      continue;
    }
    seen.set(objectName, row.rowNumber);
    if (!uploaded.has(objectName)) failures.push(`${row.filename} was not uploaded.`);
    failures.push(...catalogueRowIssues(row));
  }
  for (const [objectName, label] of uploaded) {
    if (!seen.has(objectName)) failures.push(`${label} was uploaded and has no row.`);
  }
  if (!input.rows.length && !failures.length) failures.push("The folder has no PNGs.");
  return { failures };
}

export function catalogueFrameworkGuide(): string {
  return Object.entries(PETPOSTEROUS_CONCEPT_FRAMEWORKS).map(([id, line]) => `${id}: ${line}`).join("\n");
}
