import { describe, expect, it, vi } from "vitest";
import {
  UploadRateLimitedError,
  hashPanelDataUrl,
  hasReusableHostedPrintSet,
  hostPrintPanelsBatched,
  parseRetryAfterSec,
  shouldKickAopPersist,
} from "./storefrontDesignUpload";

describe("shouldKickAopPersist", () => {
  it("allows a single cold-start kick when none/saving and not yet attempted", () => {
    expect(shouldKickAopPersist("none", false)).toBe(true);
    expect(shouldKickAopPersist("saving", false)).toBe(true);
  });

  it("never loops after a caught persist failure or 429", () => {
    expect(shouldKickAopPersist("error", false)).toBe(false);
    expect(shouldKickAopPersist("error", true)).toBe(false);
    expect(shouldKickAopPersist("rateLimited", false)).toBe(false);
    expect(shouldKickAopPersist("rateLimited", true)).toBe(false);
    expect(shouldKickAopPersist("saved", false)).toBe(false);
    expect(shouldKickAopPersist("none", true)).toBe(false);
    expect(shouldKickAopPersist("saving", true)).toBe(false);
  });
});

describe("parseRetryAfterSec", () => {
  it("prefers the Retry-After header, then JSON, then 60s", () => {
    expect(parseRetryAfterSec("47")).toBe(47);
    expect(parseRetryAfterSec(null, { retryAfter: 12 })).toBe(12);
    expect(parseRetryAfterSec(null, { retryAfterSec: 9 })).toBe(9);
    expect(parseRetryAfterSec(null, {})).toBe(60);
  });
});

describe("hashPanelDataUrl", () => {
  it("distinguishes same-length payloads that only differ in the middle", () => {
    const a = `data:image/png;base64,${"A".repeat(8000)}TEAL${"B".repeat(8000)}`;
    const b = `data:image/png;base64,${"A".repeat(8000)}NAVY${"B".repeat(8000)}`;
    expect(a.length).toBe(b.length);
    expect(hashPanelDataUrl(a)).not.toBe(hashPanelDataUrl(b));
  });

  it("treats a different reuseKey as a different panel", () => {
    const dataUrl = "data:image/jpeg;base64,SOLIDFILL";
    expect(hashPanelDataUrl(dataUrl, "#00B4C8")).not.toBe(
      hashPanelDataUrl(dataUrl, "#1F2937"),
    );
  });
});

describe("hasReusableHostedPrintSet", () => {
  it("rejects restored URLs that have no content hash", () => {
    expect(
      hasReusableHostedPrintSet(
        [{ position: "left_hood", url: "https://cdn.example/old-hood.jpg", hash: "" }],
        ["left_hood"],
      ),
    ).toBe(false);
  });

  it("accepts a full set only when every position has a hash and https URL", () => {
    expect(
      hasReusableHostedPrintSet(
        [
          { position: "left_hood", url: "https://cdn.example/l.jpg", hash: "1:1" },
          { position: "right_hood", url: "https://cdn.example/r.jpg", hash: "1:2" },
        ],
        ["left_hood", "right_hood"],
      ),
    ).toBe(true);
  });
});

describe("hostPrintPanelsBatched", () => {
  const panels = [
    { position: "front", dataUrl: "data:image/jpeg;base64,AAA" },
    { position: "back", dataUrl: "data:image/jpeg;base64,BBB" },
    { position: "left_hood", dataUrl: "data:image/jpeg;base64,CCC" },
    { position: "right_hood", dataUrl: "data:image/jpeg;base64,DDD" },
  ];

  it("reuses unchanged hashes and uploads 0 when every panel matches", async () => {
    const previous = panels.map((p) => ({
      position: p.position,
      url: `https://cdn.example/${p.position}.jpg`,
      hash: hashPanelDataUrl(p.dataUrl),
    }));
    const host = vi.fn(async () => "https://cdn.example/new.jpg");
    const result = await hostPrintPanelsBatched({ panels, previous, host });
    expect(host).not.toHaveBeenCalled();
    expect(result.uploadsAttempted).toBe(0);
    expect(result.hosted).toHaveLength(4);
  });

  it("re-uploads when only the garment background reuseKey changed", async () => {
    const previous = panels.map((p) => ({
      position: p.position,
      url: `https://cdn.example/${p.position}.jpg`,
      hash: hashPanelDataUrl(p.dataUrl, "#1F2937"),
    }));
    const host = vi.fn(async () => "https://cdn.example/new-teal.jpg");
    const result = await hostPrintPanelsBatched({
      panels,
      previous,
      host,
      reuseKey: "#00B4C8",
    });
    expect(host).toHaveBeenCalledTimes(4);
    expect(result.hosted.every((h) => h.url === "https://cdn.example/new-teal.jpg")).toBe(
      true,
    );
  });

  it("uploads only the dirty panel", async () => {
    const previous = panels.map((p) => ({
      position: p.position,
      url: `https://cdn.example/${p.position}.jpg`,
      hash: hashPanelDataUrl(p.dataUrl),
    }));
    const next = panels.map((p) =>
      p.position === "left_hood"
        ? { ...p, dataUrl: "data:image/jpeg;base64,CHANGED" }
        : p,
    );
    const host = vi.fn(async () => "https://cdn.example/hood.jpg");
    const result = await hostPrintPanelsBatched({ panels: next, previous, host });
    expect(host).toHaveBeenCalledTimes(1);
    expect(result.uploadsAttempted).toBe(1);
    expect(result.hosted.find((h) => h.position === "left_hood")?.url).toBe(
      "https://cdn.example/hood.jpg",
    );
    expect(result.hosted.find((h) => h.position === "front")?.url).toBe(
      "https://cdn.example/front.jpg",
    );
  });

  it("stops the remaining queue on 429 and keeps earlier successes", async () => {
    const host = vi.fn(async (dataUrl: string) => {
      if (dataUrl.includes("CCC") || dataUrl.includes("DDD")) {
        throw new UploadRateLimitedError(33);
      }
      return `https://cdn.example/${dataUrl.slice(-3)}.jpg`;
    });
    const result = await hostPrintPanelsBatched({
      panels,
      previous: [],
      host,
      batchSize: 2,
    });
    expect(result.rateLimited?.retryAfterSec).toBe(33);
    expect(result.hosted.map((h) => h.position)).toEqual(["front", "back"]);
    expect(result.failedPositions).toEqual(["left_hood", "right_hood"]);
    expect(result.uploadsAttempted).toBe(4);
  });
});
