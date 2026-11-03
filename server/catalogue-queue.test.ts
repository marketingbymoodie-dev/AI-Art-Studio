import { describe, expect, it } from "vitest";
import { candidateCanBeDeleted, isOpenPending, nextQueueId } from "./catalogue-queue";

describe("catalogue studio queue", () => {
  it("keeps only pending candidates in the decision queue", () => {
    expect(isOpenPending("pending")).toBe(true);
    expect(isOpenPending("dropped")).toBe(false);
    expect(isOpenPending("approved")).toBe(false);
    expect(isOpenPending("promoted")).toBe(false);
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
