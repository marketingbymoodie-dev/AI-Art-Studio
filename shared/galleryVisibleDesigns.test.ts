import { describe, expect, it } from "vitest";
import {
  galleryJobHasMockupPreview,
  isPlacementForkJob,
  selectVisibleGalleryJobs,
} from "./galleryVisibleDesigns";

describe("selectVisibleGalleryJobs", () => {
  it("keeps a single artwork-only job", () => {
    const rows = [
      { id: "a", prompt: "Kangaroos boxing", productTypeId: "20" },
    ];
    expect(selectVisibleGalleryJobs(rows).map((r) => r.id)).toEqual(["a"]);
  });

  it("hides artwork-snippet siblings next to a hoodie mockup card", () => {
    const rows = [
      {
        id: "hoodie",
        prompt: "Kangaroos boxing",
        productTypeId: "20",
        createdAt: "2026-09-12T00:02:00Z",
        mockupUrls: ["https://cdn.example.com/hoodie-front.png"],
      },
      {
        id: "snip-1",
        prompt: "Kangaroos boxing",
        productTypeId: "20",
        createdAt: "2026-09-12T00:01:00Z",
      },
      {
        id: "snip-2",
        prompt: "Kangaroos boxing",
        productTypeId: "20",
        createdAt: "2026-09-12T00:01:30Z",
        designState: { hoodieAopMockups: {} },
      },
    ];
    expect(selectVisibleGalleryJobs(rows).map((r) => r.id)).toEqual(["hoodie"]);
  });

  it("hides placement forks (ATC scale/move clones with no mockups)", () => {
    const rows = [
      {
        id: "source",
        prompt: "Kangaroos boxing",
        productTypeId: "20",
        mockupUrls: ["https://cdn.example.com/hoodie-front.png"],
      },
      {
        id: "fork",
        prompt: "Kangaroos boxing",
        productTypeId: "20",
        designState: { placementFork: true, sourceJobId: "source" },
      },
    ];
    expect(isPlacementForkJob(rows[1])).toBe(true);
    expect(selectVisibleGalleryJobs(rows).map((r) => r.id)).toEqual(["source"]);
  });

  it("keeps two intentional mockup cards with the same prompt", () => {
    const rows = [
      {
        id: "one",
        prompt: "Kangaroos boxing",
        productTypeId: "20",
        mockupUrls: ["https://cdn.example.com/a.png"],
      },
      {
        id: "two",
        prompt: "Kangaroos boxing",
        productTypeId: "20",
        mockupUrls: ["https://cdn.example.com/b.png"],
      },
    ];
    expect(selectVisibleGalleryJobs(rows).map((r) => r.id)).toEqual(["one", "two"]);
  });

  it("keeps only the newest when every sibling is still artwork-only", () => {
    const rows = [
      {
        id: "old",
        prompt: "Kangaroos boxing",
        productTypeId: "20",
        createdAt: "2026-09-12T00:00:00Z",
      },
      {
        id: "new",
        prompt: "Kangaroos boxing",
        productTypeId: "20",
        createdAt: "2026-09-12T00:00:05Z",
      },
      {
        id: "mid",
        prompt: "Kangaroos boxing",
        productTypeId: "20",
        createdAt: "2026-09-12T00:00:02Z",
      },
    ];
    expect(selectVisibleGalleryJobs(rows).map((r) => r.id)).toEqual(["new"]);
  });

  it("treats hoodieAopMockups.front as a mockup preview", () => {
    expect(
      galleryJobHasMockupPreview({
        id: "x",
        designState: { hoodieAopMockups: { front: "https://cdn.example.com/f.png" } },
      }),
    ).toBe(true);
  });
});
