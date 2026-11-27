import { describe, expect, it } from "vitest";
import {
  CATALOGUE_IMPORT_COLUMNS,
  catalogueAttentionRank,
  catalogueBlockingNotes,
  catalogueCreateBlockers,
  catalogueDraftCostUsd,
  catalogueReviewCounts,
  catalogueRowAttention,
  catalogueRowIssues,
  catalogueRowsToRetry,
  catalogueSignageHint,
  catalogueStorageName,
  catalogueWordingWarning,
  claimCatalogueHash,
  createdImportRowMatch,
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

  it("keeps a comma filename and stores it under a hyphenated name", () => {
    const name = "ChatGPT Image Oct 9, 2026, 02_15_30 PM.png";
    const plan = planCatalogueImport({ filenames: [name, "dog.png"] });
    expect(plan.failures).toEqual([]);
    const renamed = plan.rows.find((row) => row.filename === name);
    expect(renamed?.proposedFilename).toBeUndefined();
    expect(catalogueStorageName(name)).toBe("chatgpt-image-oct-9-2026-02_15_30-pm.png");
    expect(catalogueStorageName("dog.png")).toBe("dog.png");
    expect(catalogueRowAttention(renamed!, plan.rows).some((note) => note.message.includes("Storage name"))).toBe(false);
    const filled = {
      ...renamed!,
      style: "woodcut",
      species: "dog",
      humourOperator: "pp-sleep-warfare",
      truth: "asleep",
      device: "on the bed",
      proposedFilename: "chatgpt image oct 9- 2026- 02_15_30 pm.png",
    };
    expect(catalogueBlockingNotes(filled, [filled]).some((note) => note.message.includes("Storage name"))).toBe(false);
    expect(reviewCatalogueImport({ filenames: [name], rows: [filled] }).failures).toEqual([]);
  });

  it("warns on long wording without refusing the folder", () => {
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
    expect(notes).toEqual([{ tone: "warn", field: "exactWording", message: expect.stringMatching(/long for a shirt/) }]);
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

  it("matches a created row by candidate id, image hash, or filename", () => {
    const candidates = [
      { id: "c-id", status: "pending", artworkPath: "catalogue-import/batch/kept.png", contentHash: "hash-kept" },
      { id: "c-hash", status: "promoted", artworkPath: "catalogue-import/batch/other.png", contentHash: "hash-1" },
      { id: "c-file", status: "approved", artworkPath: "catalogue-import/batch/chatgpt-image-oct-9-2026-11_21_16-pm.png", contentHash: null },
    ];
    expect(createdImportRowMatch({ filename: "kept.png", candidateId: "c-id" }, candidates)).toMatchObject({ candidateId: "c-id", status: "pending", via: "id" });
    expect(createdImportRowMatch({ filename: "copy.png", contentHash: "hash-1" }, candidates)).toMatchObject({ candidateId: "c-hash", status: "promoted", via: "hash" });
    expect(createdImportRowMatch({ filename: "ChatGPT Image Oct 9, 2026, 11_21_16 PM.png" }, candidates)).toMatchObject({ candidateId: "c-file", status: "approved", via: "filename" });
    expect(createdImportRowMatch({ filename: "new.png", contentHash: "missing" }, candidates)).toBeNull();
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

  it("flags the same wording even when truth and device differ", () => {
    const base = { style: "woodcut", species: "cat", humourOperator: "pp-sleep-warfare", source: "draft" as const, lowConfidence: { style: false, humourOperator: false }, exactWording: "Bottoms Up" };
    const rows: CatalogueImportRow[] = [
      { ...base, rowNumber: 1, filename: "a.png", truth: "one cat", device: "a toilet" },
      { ...base, rowNumber: 2, filename: "b.png", truth: "another cat", device: "a different toilet" },
      { ...base, rowNumber: 3, filename: "c.png", truth: "a third cat", device: "the bowl" },
    ];
    for (const row of rows) {
      const note = catalogueRowAttention(row, rows).find((item) => item.field === "exactWording" && item.message === "possible duplicate — check");
      expect(note?.tone).toBe("warn");
    }
  });

  it("does not treat the same punchline on different breeds as a duplicate", () => {
    const base = { style: "woodcut", humourOperator: "pp-sleep-warfare", source: "draft" as const, lowConfidence: { style: false, humourOperator: false }, truth: "the dog is on duty", device: "a dog with a bone", exactWording: "BONE DUTY" };
    const rows: CatalogueImportRow[] = [
      { ...base, rowNumber: 1, filename: "golden.png", species: "golden retriever" },
      { ...base, rowNumber: 2, filename: "doberman.png", species: "doberman" },
      { ...base, rowNumber: 3, filename: "labrador.png", species: "labrador" },
    ];
    for (const row of rows) {
      const notes = catalogueRowAttention(row, rows);
      expect(notes.some((note) => note.message.startsWith("possible duplicate"))).toBe(false);
      expect(notes.some((note) => note.message === "contains text that may be background signage")).toBe(true);
    }
    expect(catalogueReviewCounts(rows)).toMatchObject({ ready: 0, attention: 3 });
    const confirmed = rows.map((row) => ({ ...row, acknowledgedWarnings: true }));
    expect(catalogueBlockingNotes(confirmed[0], confirmed)).toEqual([]);
    expect(catalogueReviewCounts(confirmed)).toMatchObject({ ready: 3, attention: 0 });
    expect(catalogueCreateBlockers(rows).join(" ")).toContain("contains text that may be background signage");
    expect(catalogueCreateBlockers(confirmed)).toEqual([]);
  });

  it("still flags the same punchline when the breed is the same", () => {
    const base = { style: "woodcut", species: "labrador", humourOperator: "pp-sleep-warfare", source: "draft" as const, lowConfidence: { style: false, humourOperator: false }, truth: "one", device: "two", exactWording: "BONE DUTY" };
    const rows: CatalogueImportRow[] = [
      { ...base, rowNumber: 1, filename: "a.png" },
      { ...base, rowNumber: 2, filename: "b.png" },
    ];
    expect(catalogueRowAttention(rows[0], rows).some((note) => note.message === "possible duplicate — check")).toBe(true);
  });

  it("hints when wording includes signage and clears the hint when that text is removed", () => {
    const withSign = "I'm Hiring If You're Interested? BUS STOP";
    const withoutSign = "I'm Hiring If You're Interested?";
    expect(catalogueSignageHint(withSign)).toBe("contains text that may be background signage");
    expect(catalogueWordingWarning(withSign)).toMatch(/long for a shirt/);
    expect(catalogueSignageHint(withoutSign)).toBeNull();
    expect(catalogueWordingWarning(withoutSign)).toBeNull();
    const row: CatalogueImportRow = {
      rowNumber: 1,
      filename: "penguin.png",
      style: "woodcut",
      species: "penguin",
      humourOperator: "pp-sleep-warfare",
      truth: "the penguin is hiring",
      device: "a penguin with a sign",
      exactWording: withoutSign,
      source: "draft",
      lowConfidence: { style: false, humourOperator: false },
    };
    expect(catalogueRowAttention(row, [row])).toEqual([]);
    expect(catalogueReviewCounts([row])).toEqual({ ready: 1, attention: 0, failed: 0, drafting: 0, total: 1 });
  });

  it("splits every row into exactly one of ready, attention, or failed", () => {
    const clean: CatalogueImportRow = {
      rowNumber: 1, filename: "clean.png", style: "woodcut", species: "dog", humourOperator: "pp-sleep-warfare", truth: "asleep", device: "on the bed", exactWording: "Nap", source: "draft", lowConfidence: { style: false, humourOperator: false },
    };
    const warned: CatalogueImportRow = { ...clean, rowNumber: 2, filename: "long.png", exactWording: "the dog has collected every card today" };
    const blocked: CatalogueImportRow = { ...clean, rowNumber: 3, filename: "blank.png", style: "", exactWording: "Sit", lowConfidence: { style: true, humourOperator: false } };
    const counts = catalogueReviewCounts([clean, warned, blocked]);
    expect(counts).toEqual({ ready: 1, attention: 2, failed: 0, drafting: 0, total: 3 });
    expect(counts.ready + counts.attention + counts.failed + counts.drafting).toBe(counts.total);
  });
});
