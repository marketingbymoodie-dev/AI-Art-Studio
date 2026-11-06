import { describe, expect, it } from "vitest";
import {
  MY_PET_DEFAULT_CAPS,
  MY_PET_DEFAULT_RENDER_PARAMS,
  MY_PET_LOCKED_PRINT_RULES,
  MY_PET_SUNBURST_ESTIMATED_COST_USD,
  buildMyPetPrompt,
  collectMyPetSettingsShopDomains,
  defaultMyPetSettings,
  evaluateMyPetCap,
  isMyPetSettingsShop,
  sanitizeMyPetCaps,
  sanitizeMyPetRenderParams,
  sanitizeMyPetStyleTweaks,
} from "./myPetSettings";

describe("buildMyPetPrompt", () => {
  it("assembles base, details, then the locked print rules last", () => {
    const settings = defaultMyPetSettings("ai-art-studio-staging.myshopify.com");
    const prompt = buildMyPetPrompt(settings, {
      species: "dog",
      artStyle: "woodcut",
      punchline: "Guilty. Unbothered.",
    });
    expect(prompt.startsWith("Image 1 is the finished design. Image 2 is the shopper's pet.")).toBe(true);
    expect(prompt).toContain(settings.basePrompt);
    expect(prompt).toContain("Species: dog.");
    expect(prompt).toContain("Style: woodcut.");
    expect(prompt).toContain('Wording stays exactly: "Guilty. Unbothered."');
    expect(prompt.endsWith(MY_PET_LOCKED_PRINT_RULES)).toBe(true);
  });

  it("appends the style tweak only for a matching style, and only when non-blank", () => {
    const settings = defaultMyPetSettings("shop.myshopify.com");
    settings.styleTweaks = { woodcut: "Keep the carved-line texture heavy.", "bold-type": "" };
    const woodcut = buildMyPetPrompt(settings, { species: "cat", artStyle: "woodcut", punchline: "" });
    expect(woodcut).toContain("Keep the carved-line texture heavy.");

    const boldType = buildMyPetPrompt(settings, { species: "cat", artStyle: "bold-type", punchline: "" });
    expect(boldType).not.toContain("Keep the carved-line texture heavy.");

    const other = buildMyPetPrompt(settings, { species: "cat", artStyle: "pen-ink", punchline: "" });
    expect(other).not.toContain("Keep the carved-line texture heavy.");
  });

  it("omits the wording line entirely when the design has no punchline", () => {
    const settings = defaultMyPetSettings("shop.myshopify.com");
    const prompt = buildMyPetPrompt(settings, { species: "dog", artStyle: "folk-graphic", punchline: "" });
    expect(prompt).not.toContain("Wording stays exactly");
  });

  it("falls back to the default base prompt when the stored one is blank", () => {
    const settings = defaultMyPetSettings("shop.myshopify.com");
    settings.basePrompt = "   ";
    const prompt = buildMyPetPrompt(settings, { species: "dog", artStyle: "woodcut", punchline: "" });
    expect(prompt).toContain("Replace the animal in this design with the pet in the photo");
  });
});

describe("sanitizeMyPetCaps", () => {
  it("clamps to non-negative integers and falls back on invalid input", () => {
    const fallback = { ...MY_PET_DEFAULT_CAPS };
    expect(sanitizeMyPetCaps({ perListing: 5, perDay: 50, emailBonus: 3 }, fallback)).toEqual({
      perListing: 5,
      perDay: 50,
      emailBonus: 3,
    });
    // -4 clamps to 0; "oops" is not numeric so it falls back; null coerces to 0 (still finite, so it clamps, not a fallback).
    expect(sanitizeMyPetCaps({ perListing: -4, perDay: "oops", emailBonus: null }, fallback)).toEqual({
      perListing: 0,
      perDay: fallback.perDay,
      emailBonus: 0,
    });
    expect(sanitizeMyPetCaps(null, fallback)).toEqual(fallback);
  });
});

describe("sanitizeMyPetStyleTweaks", () => {
  it("keeps only known styles with non-blank trimmed text", () => {
    const out = sanitizeMyPetStyleTweaks({
      woodcut: "  heavy carve lines  ",
      "bold-type": "",
      "not-a-style": "ignored",
    });
    expect(out).toEqual({ woodcut: "heavy carve lines" });
  });
});

describe("sanitizeMyPetRenderParams", () => {
  it("preserves the measured Sunburst defaults", () => {
    expect(MY_PET_DEFAULT_RENDER_PARAMS).toEqual({
      quality: "medium",
      background: "transparent",
      size: "1024x1536",
      outputFormat: "png",
      outputCompression: 90,
      moderation: "low",
    });
    expect(MY_PET_SUNBURST_ESTIMATED_COST_USD).toBeGreaterThan(0);
  });

  it("accepts a full valid payload", () => {
    const out = sanitizeMyPetRenderParams(
      { quality: "high", background: "opaque", size: "1536x1024", outputFormat: "webp", outputCompression: 80, moderation: "auto" },
      MY_PET_DEFAULT_RENDER_PARAMS,
    );
    expect(out).toEqual({
      quality: "high",
      background: "opaque",
      size: "1536x1024",
      outputFormat: "webp",
      outputCompression: 80,
      moderation: "auto",
    });
  });

  it("falls back per-field on unknown values and clamps compression to 0..100", () => {
    const out = sanitizeMyPetRenderParams(
      { quality: "ultra", background: "mint", size: "2048x2048", outputFormat: "tiff", outputCompression: 200, moderation: "strict" },
      MY_PET_DEFAULT_RENDER_PARAMS,
    );
    expect(out).toEqual({ ...MY_PET_DEFAULT_RENDER_PARAMS, outputCompression: 100 });
  });

  it("falls back wholesale on a non-object input", () => {
    expect(sanitizeMyPetRenderParams(null, MY_PET_DEFAULT_RENDER_PARAMS)).toEqual(MY_PET_DEFAULT_RENDER_PARAMS);
    expect(sanitizeMyPetRenderParams("string", MY_PET_DEFAULT_RENDER_PARAMS)).toEqual(MY_PET_DEFAULT_RENDER_PARAMS);
  });
});

describe("defaultMyPetSettings", () => {
  it("includes the Sunburst render parameter defaults", () => {
    const settings = defaultMyPetSettings("shop.myshopify.com");
    expect(settings.renderParams).toEqual(MY_PET_DEFAULT_RENDER_PARAMS);
    // Must be a copy, not a reference — editing one must not mutate the global.
    settings.renderParams.quality = "high";
    expect(MY_PET_DEFAULT_RENDER_PARAMS.quality).toBe("medium");
  });
});

describe("isMyPetSettingsShop", () => {
  it("is on for the built-in Petposterous staging domain", () => {
    expect(isMyPetSettingsShop("ai-art-studio-staging.myshopify.com")).toBe(true);
  });

  it("is off for any other shop by default", () => {
    expect(isMyPetSettingsShop("some-other-merchant.myshopify.com")).toBe(false);
    expect(isMyPetSettingsShop(null)).toBe(false);
  });

  it("opens to another shop via env without code changes", () => {
    const env = { MY_PET_SETTINGS_SHOP_DOMAINS: "new-merchant.myshopify.com, other.myshopify.com" };
    expect(isMyPetSettingsShop("new-merchant.myshopify.com", env)).toBe(true);
    const domains = collectMyPetSettingsShopDomains(env);
    expect(domains.has("other.myshopify.com")).toBe(true);
    expect(domains.has("ai-art-studio-staging.myshopify.com")).toBe(true);
  });
});

describe("evaluateMyPetCap", () => {
  const caps = { perListing: 2, perDay: 20, emailBonus: 2 };

  it("allows under both caps", () => {
    expect(evaluateMyPetCap({ perListingCount: 0, dailyCount: 0, hasEmailBonus: false, caps })).toEqual({ allowed: true });
  });

  it("blocks on the listing cap with a friendly message, not an error", () => {
    const result = evaluateMyPetCap({ perListingCount: 2, dailyCount: 1, hasEmailBonus: false, caps });
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBe("listing_cap");
      expect(result.message.length).toBeGreaterThan(0);
    }
  });

  it("the email bonus raises the listing cap by exactly emailBonus", () => {
    expect(evaluateMyPetCap({ perListingCount: 2, dailyCount: 1, hasEmailBonus: true, caps })).toEqual({ allowed: true });
    expect(evaluateMyPetCap({ perListingCount: 3, dailyCount: 1, hasEmailBonus: true, caps })).toEqual({ allowed: true });
    const blocked = evaluateMyPetCap({ perListingCount: 4, dailyCount: 1, hasEmailBonus: true, caps });
    expect(blocked.allowed).toBe(false);
  });

  it("blocks on the daily cap even with an unused listing cap", () => {
    const result = evaluateMyPetCap({ perListingCount: 0, dailyCount: 20, hasEmailBonus: false, caps });
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toBe("daily_cap");
  });
});
