import { describe, expect, it } from "vitest";
import {
  isStorefrontPasswordHtml,
  parseAjaxVariantJson,
} from "./shadow-storefront-visible";

describe("parseAjaxVariantJson", () => {
  it("accepts the matching Ajax variant payload", () => {
    expect(parseAjaxVariantJson(`{"id":46284091588842,"title":"20 x 20"}`, "46284091588842")).toBe(
      true,
    );
  });

  it("rejects a different variant or HTML", () => {
    expect(parseAjaxVariantJson(`{"id":1}`, "46284091588842")).toBe(false);
    expect(parseAjaxVariantJson("<html><body>password</body></html>", "46284091588842")).toBe(false);
  });
});

describe("isStorefrontPasswordHtml", () => {
  it("detects the password wall", () => {
    expect(
      isStorefrontPasswordHtml(
        `<html><form action="/password"><input name="password"></form></html>`,
        "text/html",
      ),
    ).toBe(true);
    expect(isStorefrontPasswordHtml(`{"id":1}`, "application/json")).toBe(false);
  });
});
