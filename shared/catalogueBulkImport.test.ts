import { describe, expect, it } from "vitest";
import {
  CATALOGUE_IMPORT_COLUMNS,
  catalogueAttentionRank,
  catalogueDraftCostUsd,
  catalogueRowAttention,
  catalogueRowIssues,
  catalogueRowsToRetry,
  catalogueWordingWarning,
  claimCatalogueHash,
  normaliseCatalogueDraft,
  planCatalogueImport,
  reviewCatalogueImport,
  type CatalogueImportRow,
} from "./catalogueBulkImport";

const header = CATALOGUE_IMPORT_COLUMNS.join(",");

function csv(...lines: string[]): string {
  return [header, ...lines].join("\n");
}

describe("catalogue bulk import", () => {
  it("accepts a clean batch, including a blank punchline and a bird", () => {
    const plan = planCatalogueImport({
      csv: csv(
        'dog.png,woodcut,dog,pp-sleep-warfare,"the bed, apparently, is his","dog in the middle, human at the edge",',
        "bird.png,pen-ink,bird,pp-petty-crimes,the bird files a complaint,a small bird with a notebook,FILED",
      ),
      filenames: ["Dog.PNG", "bird.png"],
    });
    expect(plan.failures).toEqual([]);
    expect(plan.rows.map((row) => row.filename)).toEqual(["Dog.PNG", "bird.png"]);
    expect(plan.rows[0]).toMatchObject({
      source: "csv",
      style: "woodcut",
      species: "dog",
      humourOperator: "pp-sleep-warfare",
      truth: "the bed, apparently, is his",
      device: "dog in the middle, human at the edge",
      exactWording: "",
    });
    expect(plan.rows[1].species).toBe("bird");
    expect(plan.rows[1].exactWording).toBe("FILED");
    expect(plan.rows.every((row) => catalogueRowIssues(row).length === 0)).toBe(true);
  });

  it("names structural failures and leaves field problems on the row", () => {
    const plan = planCatalogueImport({
      csv: csv(
        "dog.png,watercolor,dog,deadpan,,a dog,hello",
        "dog.png,woodcut,,pp-sleep-warfare,asleep,a dog,",
        "missing.png,woodcut,dog,pp-sleep-warfare,asleep,a dog,",
      ),
      filenames: ["dog.png", "extra.png", "extra.png"],
    });
    expect(plan.failures).toEqual([
      "extra.png duplicates extra.png.",
      "dog.png is on more than one row (2 and 3).",
      "missing.png is in the CSV and was not uploaded.",
    ]);
    const extra = plan.rows.find((row) => row.filename === "extra.png");
    expect(extra?.source).toBe("draft");
    expect(catalogueRowIssues(plan.rows[0])).toEqual([
      'dog.png: style "watercolor" is not one of vintage-engraving, pen-ink, woodcut, retro-character, bold-type, folk-graphic.',
      'dog.png: humour_operator "deadpan" is not one of the sixteen frameworks.',
      "dog.png: truth is blank.",
    ]);
  });

  it("drafts every PNG when no CSV is supplied", () => {
    const plan = planCatalogueImport({ filenames: ["bird.png", "dog.png"] });
    expect(plan.failures).toEqual([]);
    expect(plan.rows.map((row) => ({ filename: row.filename, source: row.source, style: row.style }))).toEqual([
      { filename: "bird.png", source: "draft", style: "" },
      { filename: "dog.png", source: "draft", style: "" },
    ]);
  });

  it("refuses a header that is not the template", () => {
    const plan = planCatalogueImport({
      csv: "file,style\ndog.png,woodcut",
      filenames: ["dog.png"],
    });
    expect(plan.rows).toEqual([]);
    expect(plan.failures).toEqual([
      "CSV header must be filename, style, species, humour_operator, truth, device, exact_wording.",
      "dog.png was uploaded and has no CSV row.",
    ]);
  });

  it("keeps a sure style and blanks an unsure one instead of guessing", () => {
    const draft = normaliseCatalogueDraft({
      species: "dog",
      style: "woodcut",
      style_confidence: "high",
      humour_operator: "pp-sleep-warfare",
      humour_confidence: "low",
      truth: "the dog takes the bed",
      device: "the dog is in the middle",
      exact_wording: " Bed Etiquette! ",
    });
    expect(draft).toMatchObject({
      style: "woodcut",
      humourOperator: "",
      exactWording: "Bed Etiquette!",
      lowConfidence: { style: false, humourOperator: true },
    });
    const guessed = normaliseCatalogueDraft({
      style: "not-a-style",
      style_confidence: "high",
      humour_operator: "pp-sleep-warfare",
      humour_confidence: "high",
      species: "cat",
      truth: "asleep",
      device: "on the bed",
      exact_wording: "",
    });
    expect(guessed?.style).toBe("");
    expect(guessed?.lowConfidence.style).toBe(true);
    expect(guessed?.humourOperator).toBe("pp-sleep-warfare");
    expect(guessed?.exactWording).toBe("");
  });

  it("prices a Sonnet 4.6 draft from the token usage", () => {
    expect(catalogueDraftCostUsd({ input_tokens: 1_000_000, output_tokens: 0 }, "claude-sonnet-4-6")).toBe(3);
    expect(catalogueDraftCostUsd({ input_tokens: 1000, output_tokens: 200 }, "claude-sonnet-4-6")).toBeCloseTo(0.006, 6);
    expect(catalogueDraftCostUsd({ input_tokens: 1, output_tokens: 1 }, "some-other-model")).toBeNull();
  });

  it("refuses a reviewed batch that is still incomplete", () => {
    const plan = planCatalogueImport({ filenames: ["dog.png"] });
    expect(reviewCatalogueImport({ filenames: ["dog.png"], rows: plan.rows }).failures).toContain("dog.png: style is blank.");
    const filled = { ...plan.rows[0], style: "woodcut", species: "dog", humourOperator: "pp-sleep-warfare", truth: "asleep", device: "on the bed" };
    expect(reviewCatalogueImport({ filenames: ["dog.png"], rows: [filled] }).failures).toEqual([]);
  });

  it("offers a rename for a comma filename and does not fail the rest of the batch", () => {
    const plan = planCatalogueImport({
      filenames: ["ChatGPT Image Oct 9, 2026, 02_15_30 PM.png", "dog.png"],
    });
    expect(plan.failures).toEqual([]);
    const renamed = plan.rows.find((row) => row.filename.includes(","));
    expect(renamed?.proposedFilename).toBe("chatgpt image oct 9- 2026- 02_15_30 pm.png");
    expect(catalogueRowAttention(renamed!, plan.rows).some((note) => note.tone === "block" && note.message.includes("Rename to"))).toBe(true);
    expect(plan.rows.find((row) => row.filename === "dog.png")?.proposedFilename).toBeUndefined();
  });

  it("warns on long wording and still leaves the row queueable", () => {
    const row: CatalogueImportRow = {
      rowNumber: 1,
      filename: "dog.png",
      style: "woodcut",
      species: "dog",
      humourOperator: "pp-sleep-warfare",
      truth: "asleep",
      device: "on the bed",
      exactWording: "the dog has collected every card today",
      source: "draft",
      lowConfidence: { style: false, humourOperator: false },
    };
    expect(catalogueWordingWarning(row.exactWording)).toMatch(/7 words/);
    expect(catalogueWordingWarning("one\ntwo\nthree\nfour")).toMatch(/4 lines/);
    expect(catalogueWordingWarning("a punchline that is clearly too many characters")).toMatch(/characters/);
    expect(row.exactWording).toBe("the dog has collected every card today");
    expect(catalogueRowIssues(row)).toEqual([]);
    const notes = catalogueRowAttention(row, [row]);
    expect(notes).toEqual([{ tone: "warn", message: expect.stringMatching(/long for a shirt/) }]);
    expect(reviewCatalogueImport({ filenames: ["dog.png"], rows: [row] }).failures).toEqual([]);
  });

  it("sorts near-duplicates above a clean row", () => {
    const shared = { style: "woodcut", species: "dog", humourOperator: "pp-sleep-warfare", truth: "asleep", device: "on the bed", source: "draft" as const, lowConfidence: { style: false, humourOperator: false } };
    const rows: CatalogueImportRow[] = [
      { ...shared, rowNumber: 1, filename: "clean.png", exactWording: "ONE" },
      { ...shared, rowNumber: 2, filename: "copy-a.png", exactWording: "SAME", contentHash: "hash-1" },
      { ...shared, rowNumber: 3, filename: "copy-b.png", exactWording: "SAME", contentHash: "hash-1" },
    ];
    const ordered = [...rows].sort((a, b) => catalogueAttentionRank(a, rows) - catalogueAttentionRank(b, rows));
    expect(ordered.map((row) => row.filename)).toEqual(["copy-a.png", "copy-b.png", "clean.png"]);
    expect(catalogueRowAttention(rows[1], rows).some((note) => note.message.includes("copy-b.png"))).toBe(true);
  });

  it("returns the same candidate id when the same file hash is claimed twice", () => {
    const known = new Map<string, string>();
    const first = claimCatalogueHash(known, "abc", () => "candidate-1");
    const second = claimCatalogueHash(known, "abc", () => "candidate-2");
    const other = claimCatalogueHash(known, "def", () => "candidate-3");
    expect(first).toEqual({ candidateId: "candidate-1", created: true });
    expect(second).toEqual({ candidateId: "candidate-1", created: false });
    expect(other).toEqual({ candidateId: "candidate-3", created: true });
  });

  it("retries a failed row and leaves a queued row alone", () => {
    const rows = [
      { filename: "done.png", importStatus: "queued" as const, source: "draft" as const },
      { filename: "again.png", importStatus: "failed" as const, failureReason: "The draft failed", source: "draft" as const, draftState: "failed" },
    ];
    expect(catalogueRowsToRetry(rows).map((row) => row.filename)).toEqual(["again.png"]);
  });
});
