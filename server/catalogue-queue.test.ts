import { describe, expect, it } from "vitest";
import { candidateCanBeDeleted, isOpenPending, needsOperatorAction, nextQueueId, sortOperatorQueue } from "./catalogue-queue";

describe("catalogue studio queue", () => {
  it("limits drop and delete to pending", () => {
    expect(isOpenPending("pending")).toBe(true);
    expect(isOpenPending("dropped")).toBe(false);
    expect(isOpenPending("approved")).toBe(false);
    expect(isOpenPending("promoted")).toBe(false);
  });

  it("keeps pending and approved-without-a-product for the operator", () => {
    expect(needsOperatorAction({ status: "pending", shopifyProductId: null })).toBe(true);
    expect(needsOperatorAction({ status: "approved", shopifyProductId: null })).toBe(true);
    expect(needsOperatorAction({ status: "approved", shopifyProductId: "8790832120042" })).toBe(false);
    expect(needsOperatorAction({ status: "promoted", shopifyProductId: "8790832120042" })).toBe(false);
    expect(needsOperatorAction({ status: "dropped", shopifyProductId: null })).toBe(false);
  });

  it("walks pending first, then approved, newest first in each group", () => {
    const ids = sortOperatorQueue([
      { id: "old-pending", status: "pending", createdAt: "2026-11-01T00:00:00Z" },
      { id: "new-approved", status: "approved", createdAt: "2026-11-03T00:00:00Z" },
      { id: "new-pending", status: "pending", createdAt: "2026-11-02T00:00:00Z" },
      { id: "old-approved", status: "approved", createdAt: "2026-10-01T00:00:00Z" },
    ]).map((row) => row.id);
    expect(ids).toEqual(["new-pending", "old-pending", "new-approved", "old-approved"]);
    expect(nextQueueId(ids, "old-pending")).toBe("new-approved");
  });

  it("walks to the next id and stops at the end", () => {
    expect(nextQueueId(["new", "older"], "new")).toBe("older");
    expect(nextQueueId(["new", "older"], "older")).toBe("");
    expect(nextQueueId(["new"], "missing")).toBe("new");
  });

  it("deletes only a pending candidate that stored nothing", () => {
    const empty = {
      status: "pending",
      artworkPath: null,
      choiceArtworkPath: "",
      printFilePath: null,
      shopifyProductId: null,
      printifyProductId: null,
    };
    expect(candidateCanBeDeleted(empty)).toBe(true);
    expect(candidateCanBeDeleted({ ...empty, artworkPath: "candidates/toilet-seat.png" })).toBe(false);
    expect(candidateCanBeDeleted({ ...empty, choiceArtworkPath: "candidates/toilet-seat.png" })).toBe(false);
    expect(candidateCanBeDeleted({ ...empty, status: "dropped" })).toBe(false);
    expect(candidateCanBeDeleted({ ...empty, shopifyProductId: "1" })).toBe(false);
    expect(candidateCanBeDeleted({ ...empty, printifyProductId: "abc" })).toBe(false);
    expect(candidateCanBeDeleted({ ...empty, printFilePath: "prints/a.png" })).toBe(false);
  });
});
