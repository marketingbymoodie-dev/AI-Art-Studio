import { describe, expect, it } from "vitest";
import {
  CREATOR_ARTWORK_LIMIT,
  CREATOR_ARTWORK_STRIP_LIMIT,
  dedupeCreatorArtworksByUrl,
  pickOldestCreatorArtworkJobIdsToEvict,
} from "./creatorArtworkLibrary";

describe("creatorArtworkLibrary", () => {
  it("keeps strip and library caps at 8 and 50", () => {
    expect(CREATOR_ARTWORK_STRIP_LIMIT).toBe(8);
    expect(CREATOR_ARTWORK_LIMIT).toBe(50);
  });

  it("dedupes by artwork URL and respects limit", () => {
    const rows = [
      { jobId: "a", artworkUrl: "https://cdn/one.png" },
      { jobId: "b", artworkUrl: "https://cdn/one.png" },
      { jobId: "c", artworkUrl: "https://cdn/two.png" },
      { jobId: "d", artworkUrl: "" },
    ];
    expect(dedupeCreatorArtworksByUrl(rows, 8)).toEqual([
      { jobId: "a", artworkUrl: "https://cdn/one.png" },
      { jobId: "c", artworkUrl: "https://cdn/two.png" },
    ]);
    expect(dedupeCreatorArtworksByUrl(rows, 1)).toEqual([
      { jobId: "a", artworkUrl: "https://cdn/one.png" },
    ]);
  });

  it("does not evict when at or under the cap", () => {
    const under = Array.from({ length: 49 }, (_, i) => ({
      jobId: `j${i}`,
      artworkUrl: `https://cdn/${i}.png`,
    }));
    const atCap = Array.from({ length: 50 }, (_, i) => ({
      jobId: `j${i}`,
      artworkUrl: `https://cdn/${i}.png`,
    }));
    expect(pickOldestCreatorArtworkJobIdsToEvict(under, 50)).toEqual([]);
    expect(pickOldestCreatorArtworkJobIdsToEvict(atCap, 50)).toEqual([]);
  });

  it("evicts the oldest unique artwork after a new save overflows the cap", () => {
    const rows = Array.from({ length: 51 }, (_, i) => ({
      jobId: `j${i}`,
      artworkUrl: `https://cdn/${i}.png`,
    }));
    expect(pickOldestCreatorArtworkJobIdsToEvict(rows, 50)).toEqual(["j50"]);
  });

  it("evicts overflow unique artworks including duplicate URL jobs", () => {
    const rows = [
      { jobId: "new", artworkUrl: "https://cdn/new.png" },
      { jobId: "keep", artworkUrl: "https://cdn/keep.png" },
      { jobId: "dup", artworkUrl: "https://cdn/old.png" },
      { jobId: "old", artworkUrl: "https://cdn/old.png" },
    ];
    expect(pickOldestCreatorArtworkJobIdsToEvict(rows, 2)).toEqual(["dup", "old"]);
  });
});
