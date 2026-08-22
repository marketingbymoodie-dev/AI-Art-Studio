import { describe, expect, it } from "vitest";
import {
  convertUsdCentsToShop,
  countryLookupKeys,
  printifyShippingLineProps,
  quotePrintifyLinesUsdCents,
} from "./printify-shipping-quote";

describe("printify shipping quote", () => {
  it("charges first + additional for extra qty of the same variant", () => {
    expect(
      quotePrintifyLinesUsdCents([
        {
          groupKey: "5:99",
          variantKey: "111",
          quantity: 3,
          firstItemCents: 499,
          additionalItemCents: 199,
        },
      ]),
    ).toBe(499 + 199 + 199);
  });

  it("does not treat two products as one first-item even from the same provider", () => {
    expect(
      quotePrintifyLinesUsdCents([
        {
          groupKey: "5:99",
          variantKey: "111",
          quantity: 1,
          firstItemCents: 499,
          additionalItemCents: 199,
        },
        {
          groupKey: "5:99",
          variantKey: "222",
          quantity: 1,
          firstItemCents: 899,
          additionalItemCents: 300,
        },
      ]),
    ).toBe(499 + 899);
  });

  it("converts USD cents to AUD", () => {
    const aud = convertUsdCentsToShop(1000, "AUD", 1.5);
    expect(aud).toEqual({ amountCents: 1500, currency: "AUD" });
  });

  it("looks up ISO country then rest of world", () => {
    expect(countryLookupKeys("DE")).toEqual(["DE", "REST_OF_THE_WORLD"]);
  });

  it("stamps hidden line props for checkout quoting", () => {
    expect(
      printifyShippingLineProps({
        productTypeId: 42,
        blueprintId: 5,
        providerId: 99,
        printifyVariantId: 111,
      }),
    ).toEqual({
      _product_type_id: "42",
      _printify_blueprint_id: "5",
      _printify_provider_id: "99",
      _printify_variant_id: "111",
    });
  });
});
