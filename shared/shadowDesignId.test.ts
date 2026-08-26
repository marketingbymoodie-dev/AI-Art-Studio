import { describe, expect, it } from "vitest";
import {
  reusableShadowDesignId,
  shadowDesignIdForCart,
  shadowJobPrefix,
  shadowLookupKeys,
  shadowMatchesBaseVariant,
} from "./shadowDesignId";

describe("shadowDesignIdForCart", () => {
  it("keeps different mockups on different keys even for the same job", () => {
    const a = shadowDesignIdForCart("job-1", "https://cdn.example/a.png");
    const b = shadowDesignIdForCart("job-1", "https://cdn.example/b.png");
    expect(a).not.toBe(b);
    expect(a.startsWith("job-1::")).toBe(true);
  });

  it("is stable for the same job + mockup", () => {
    const url = "https://cdn.example/apron.png";
    expect(shadowDesignIdForCart("job-1", url)).toBe(shadowDesignIdForCart("job-1", url));
  });
});

describe("shadowLookupKeys", () => {
  it("includes incoming id, url-hash, and bare job so PreShadow and ATC meet", () => {
    const hashed = shadowDesignIdForCart("job-1", "https://cdn.example/a.png");
    const keys = shadowLookupKeys(hashed, "https://cdn.example/a.png");
    expect(keys).toContain(hashed);
    expect(keys).toContain("job-1");
  });

  it("canonical reusable id is job + catalog variant, not a per-mockup hash", () => {
    expect(reusableShadowDesignId("job-1::abc", "46172379185386")).toBe(
      "job-1::46172379185386",
    );
    expect(reusableShadowDesignId("job-1", "4617")).toBe("job-1::4617");
    expect(shadowJobPrefix("job-1::M::black")).toBe("job-1");
  });
});

describe("shadowMatchesBaseVariant", () => {
  it("refuses reuse when the stored shadow is a different catalog color", () => {
    expect(shadowMatchesBaseVariant("46172379185386", "46172379185387")).toBe(false);
    expect(shadowMatchesBaseVariant("46172379185386", "46172379185386")).toBe(true);
  });

  it("refuses reuse when either side is missing — do not fall through to another color", () => {
    expect(shadowMatchesBaseVariant(null, "4617")).toBe(false);
    expect(shadowMatchesBaseVariant("4617", null)).toBe(false);
  });
});
