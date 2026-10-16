import { describe, expect, it } from "vitest";
import {
  buildShopifyAdminAppUrl,
  buildThemeEditorShopifyHref,
  buildThemeEditorUrl,
  httpsAdminUrlToShopifyProtocol,
  stagingCatalogueStudioUrl,
} from "./themeEditorUrl";

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

  it("builds a shopify:// admin href that App Bridge can keep in history", () => {
    expect(buildThemeEditorShopifyHref("abc123")).toBe(
      "shopify://admin/themes/current/editor?context=apps&activateAppId=abc123%2Fai-art-embed",
    );
  });

  it("builds the staging catalogue studio admin link", () => {
    expect(stagingCatalogueStudioUrl()).toBe(
      "https://admin.shopify.com/store/ai-art-studio-staging/apps/ai-art-studio-staging/admin/catalogue-studio",
    );
    expect(buildShopifyAdminAppUrl("studio-demo", "ai-art-studio", "/admin/settings")).toBe(
      "https://admin.shopify.com/store/studio-demo/apps/ai-art-studio/admin/settings",
    );
  });

  it("converts an admin.shopify.com editor URL to shopify://", () => {
    expect(
      httpsAdminUrlToShopifyProtocol(
        "https://admin.shopify.com/store/studio-demo/themes/current/editor?context=apps&activateAppId=abc123%2Fai-art-embed",
      ),
    ).toBe("shopify://admin/themes/current/editor?context=apps&activateAppId=abc123%2Fai-art-embed");
  });
});
