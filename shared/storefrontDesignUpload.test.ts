import { describe, expect, it, vi } from "vitest";
import {
  UploadRateLimitedError,
  hashPanelDataUrl,
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
