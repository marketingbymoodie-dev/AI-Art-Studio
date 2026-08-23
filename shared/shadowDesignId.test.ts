import { describe, expect, it } from "vitest";
import {
  reusableShadowDesignId,
  shadowDesignIdForCart,
  shadowJobPrefix,
  shadowLookupKeys,
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

  it("canonical reusable id is the job, not a per-mockup hash", () => {
    expect(reusableShadowDesignId("job-1::abc")).toBe("job-1");
    expect(shadowJobPrefix("job-1::M::black")).toBe("job-1");
  });
});
