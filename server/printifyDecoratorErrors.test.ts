import { describe, expect, it } from "vitest";
import { isPrintifyDecoratorUnavailableError } from "./printifyDecoratorErrors";

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
