import { describe, expect, it } from "vitest";
import {
  catalogueDesignCanBeEdited,
  catalogueQueueCounts,
  catalogueQueueIsDone,
  catalogueQueueLabel,
  catalogueQueuePage,
  catalogueStatusRepair,
  filterCatalogueQueue,
  readCatalogueQueueTab,
} from "./catalogueQueue";

const rows = [
  { id: "ginger", title: "Bottoms Up Ginger", punchline: "the ginger one", phase: "", listed: true, done: true },
  { id: "mystery", title: "Mystery Solved", punchline: "case closed", phase: "done", listed: true, done: true },
  { id: "fresh", title: "Still drawing", punchline: "not yet", phase: "", listed: false, done: false },
  { id: "busy", title: "Reprint", punchline: "again", phase: "shopify", listed: true, done: false },
];

describe("catalogue queue done", () => {
  it("counts a live listing as done when the job never recorded it", () => {
    expect(catalogueQueueIsDone({ phase: "", listed: true })).toBe(true);
    expect(catalogueQueueLabel("", "", true)).toBe("Done");
    expect(catalogueQueueIsDone({ phase: "failed", listed: true })).toBe(true);
    expect(catalogueQueueLabel("failed", "upscaler failed", true)).toBe("Done");
  });

  it("keeps a running publish in the pending list", () => {
    expect(catalogueQueueIsDone({ phase: "shopify", listed: true })).toBe(false);
    expect(catalogueQueueLabel("shopify", "", true)).toBe("Creating Shopify product");
  });

  it("leaves a failure with no listing as pending", () => {
    expect(catalogueQueueIsDone({ phase: "failed", listed: false })).toBe(false);
    expect(catalogueQueueLabel("failed", "Printify rejected the product", false)).toBe("Failed: Printify rejected the product");
  });
});

describe("catalogue queue filter", () => {
  it("defaults to pending and remembers a real tab", () => {
    expect(readCatalogueQueueTab(null)).toBe("pending");
    expect(readCatalogueQueueTab("nope")).toBe("pending");
    expect(readCatalogueQueueTab("done")).toBe("done");
  });

  it("filters by tab and by title or wording", () => {
    expect(catalogueQueueCounts(rows)).toEqual({ pending: 2, done: 2, all: 4 });
    expect(filterCatalogueQueue(rows, "pending", "").map((row) => row.id)).toEqual(["fresh", "busy"]);
    expect(filterCatalogueQueue(rows, "done", "ginger").map((row) => row.id)).toEqual(["ginger"]);
    expect(filterCatalogueQueue(rows, "all", "case closed").map((row) => row.id)).toEqual(["mystery"]);
  });

  it("pages a long queue", () => {
    const many = Array.from({ length: 45 }, (_, index) => ({
      title: `Design ${index}`,
      punchline: "",
      done: false,
    }));
    const first = catalogueQueuePage(many, 1);
    const second = catalogueQueuePage(many, 2);
    expect(first.rows).toHaveLength(40);
    expect(second.page).toBe(2);
    expect(second.rows).toHaveLength(5);
    expect(catalogueQueuePage(many, 9).page).toBe(2);
  });
});

describe("published design edits", () => {
  it("allows wording and colour ticks after publish", () => {
    expect(catalogueDesignCanBeEdited("pending")).toBe(true);
    expect(catalogueDesignCanBeEdited("approved")).toBe(true);
    expect(catalogueDesignCanBeEdited("promoted")).toBe(true);
    expect(catalogueDesignCanBeEdited("dropped")).toBe(false);
  });
});

describe("catalogue status repair", () => {
  it("marks a stored job done and does not invent a row or touch a running publish", () => {
    expect(catalogueStatusRepair({ shopifyProductId: "1", jobStatus: "failed", jobPhase: "failed" })).toBe("set-job-done");
    expect(catalogueStatusRepair({ shopifyProductId: "1", jobStatus: null, jobPhase: null })).toBe("no-job-row");
    expect(catalogueStatusRepair({ shopifyProductId: "1", jobStatus: "running", jobPhase: "shopify" })).toBe("in-progress");
    expect(catalogueStatusRepair({ shopifyProductId: "1", jobStatus: "done", jobPhase: "done" })).toBe("unchanged");
    expect(catalogueStatusRepair({ shopifyProductId: "", jobStatus: "failed", jobPhase: "failed" })).toBe("unchanged");
  });
});
