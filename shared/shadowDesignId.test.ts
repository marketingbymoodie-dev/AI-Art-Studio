import { describe, expect, it } from "vitest";
import { shadowDesignIdForCart } from "./shadowDesignId";

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
