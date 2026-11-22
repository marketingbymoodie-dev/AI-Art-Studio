import { describe, expect, it } from "vitest";
import {
  assertCopyTargets,
  isRoundOneDesign,
  jsonParameter,
  remapIdKeys,
  remapTagCondition,
  retagCatalogueTypeTags,
  withoutSecrets,
} from "./petposterous-copy-lib";

const source = "postgres://user:secret@altaria.proxy.rlwy.net:1234/railway";
const dest = "postgres://user:secret@prod-db.proxy.rlwy.net:1234/railway";

describe("petposterous copy guards", () => {
  it("accepts a staging source and a different production destination", () => {
    expect(assertCopyTargets(source, dest, true)).toEqual({
      sourceHost: "altaria.proxy.rlwy.net",
      destHost: "prod-db.proxy.rlwy.net",
    });
  });

  it("refuses a production source, a staging destination, and a matching pair", () => {
    expect(() => assertCopyTargets("postgres://user:secret@prod-db.proxy.rlwy.net/railway", dest, false)).toThrow(/production/);
    expect(() => assertCopyTargets(source, "postgres://user:secret@staging.proxy.rlwy.net/railway", true)).toThrow(/staging/);
    expect(() => assertCopyTargets(source, source, true)).toThrow(/same database/);
    expect(assertCopyTargets(source, undefined, false).destHost).toBeNull();
    expect(() => assertCopyTargets(source, undefined, true)).toThrow(/DEST_DATABASE_URL/);
  });

  it("skips ROUND ONE and leaves other listings", () => {
    expect(isRoundOneDesign({ shopify_product_id: "16470702325841", title: "ROUND ONE" })).toBe(true);
    expect(isRoundOneDesign({ shopify_product_id: "1", title: "Round One tee" })).toBe(true);
    expect(isRoundOneDesign({ shopify_product_id: "16484623319121", title: "Love What You've Done With The Place" })).toBe(false);
  });

  it("sends JSON columns as JSON text, including arrays", () => {
    expect(jsonParameter(["Black", "White"])).toBe('["Black","White"]');
    expect(jsonParameter({ "901": ["Black"] })).toBe('{"901":["Black"]}');
    expect(jsonParameter("appai_discount")).toBe('"appai_discount"');
    expect(jsonParameter(null)).toBeNull();
  });

  it("remaps type ids in ticks and tags", () => {
    const map = new Map([[56, 901], [58, 902]]);
    expect(remapIdKeys({ "56": ["Black"], "70": ["White"] }, map)).toEqual({
      "901": ["Black"],
      "70": ["White"],
    });
    expect(retagCatalogueTypeTags(["woodcut", "aas-type-56", "aas-type-58", "my-pet"], { "56": 901, "58": 902 })).toEqual([
      "woodcut",
      "aas-type-901",
      "aas-type-902",
      "my-pet",
    ]);
    expect(remapTagCondition("aas-type-56", { "56": 901 })).toBe("aas-type-901");
    expect(remapTagCondition("aas-studio-product", { "56": 901 })).toBe("aas-studio-product");
  });

  it("drops token columns before anything is printed", () => {
    expect(withoutSecrets({ shop_domain: "h7epay-gh.myshopify.com", access_token: "secret", printify_api_token: "secret" })).toEqual({
      shop_domain: "h7epay-gh.myshopify.com",
    });
  });
});
