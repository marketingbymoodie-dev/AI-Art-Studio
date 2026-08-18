import { describe, expect, it } from "vitest";
import { buildThemeEditorUrl } from "./themeEditorUrl";

describe("buildThemeEditorUrl", () => {
  it("builds an admin.shopify.com App embeds deep link", () => {
    expect(buildThemeEditorUrl("studio-demo.myshopify.com", "abc123")).toBe(
      "https://admin.shopify.com/store/studio-demo/themes/current/editor?context=apps&activateAppId=abc123%2Fai-art-embed",
    );
  });

  it("accepts a bare handle", () => {
    expect(buildThemeEditorUrl("studio-demo", "abc123")).toContain("/store/studio-demo/");
  });

  it("omits activateAppId when the API key is missing", () => {
    expect(buildThemeEditorUrl("studio-demo.myshopify.com", "")).toBe(
      "https://admin.shopify.com/store/studio-demo/themes/current/editor?context=apps",
    );
  });
});
