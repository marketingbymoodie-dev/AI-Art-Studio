import { describe, expect, it } from "vitest";
import {
  isPrintifyAuthError,
  isPrintifyDecoratorUnavailableError,
} from "./printifyDecoratorErrors";

describe("isPrintifyDecoratorUnavailableError", () => {
  it("matches Printify 6002 decorator messages", () => {
    expect(
      isPrintifyDecoratorUnavailableError(
        'Printify 400 on /shops/1/products.json: {"status":"error","code":6002,"message":"Validation failed.","errors":{"reason":"Decorator 54 not available for this blueprint 79","code":6002}}',
      ),
    ).toBe(true);
    expect(
      isPrintifyDecoratorUnavailableError("Decorator 99 not available for this blueprint 12"),
    ).toBe(true);
  });

  it("ignores unrelated failures", () => {
    expect(isPrintifyDecoratorUnavailableError("blank garment photos could not be harvested")).toBe(
      false,
    );
    expect(isPrintifyDecoratorUnavailableError("Printify 429 rate limited")).toBe(false);
  });
});

describe("isPrintifyAuthError", () => {
  it("matches upload 401 Unauthenticated", () => {
    expect(
      isPrintifyAuthError(
        'Printify 401 on /uploads/images.json: {"error":"Unauthenticated","request_id":"1791836109@abc"}',
      ),
    ).toBe(true);
    expect(isPrintifyAuthError("Printify 403 on /shops.json: forbidden")).toBe(true);
  });

  it("ignores decorator and probe failures", () => {
    expect(isPrintifyAuthError("Decorator 99 not available for this blueprint 145")).toBe(false);
    expect(isPrintifyAuthError("probe: no mockup returned for front")).toBe(false);
  });
});
