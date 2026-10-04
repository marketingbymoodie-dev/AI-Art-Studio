import { describe, expect, it } from "vitest";
import {
  SHADOW_MINT_BACKOFF_MS,
  percentile,
  shadowMintLikePrefix,
  shadowMintRetryDelayMs,
  shadowMintSupersedePrefix,
} from "./shadowMintQueue";

describe("shadow mint queue policy", () => {
  it("waits 5s then 30s and dies on the third failure", () => {
    expect(shadowMintRetryDelayMs(1)).toBe(5_000);
    expect(shadowMintRetryDelayMs(2)).toBe(30_000);
    expect(shadowMintRetryDelayMs(3)).toBeNull();
    expect(shadowMintRetryDelayMs(4)).toBeNull();
    expect(SHADOW_MINT_BACKOFF_MS[2]).toBe(120_000);
  });

  it("supersedes only other keys for the same job and variant", () => {
    expect(shadowMintSupersedePrefix("job-1::46347::abc")).toBe("job-1::46347::");
    expect(shadowMintSupersedePrefix("job-1::46347")).toBeNull();
    expect(shadowMintSupersedePrefix("")).toBeNull();
  });

  it("escapes LIKE wildcards in the supersede prefix", () => {
    expect(shadowMintLikePrefix("a_b%")).toBe("a\\_b\\%%");
  });

  it("computes nearest-rank percentiles", () => {
    expect(percentile([], 50)).toBeNull();
    expect(percentile([10, 20, 30, 40], 50)).toBe(20);
    expect(percentile([10, 20, 30, 40], 95)).toBe(40);
  });
});
