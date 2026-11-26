import { describe, expect, it, vi } from "vitest";

vi.mock("./checkout-guard", () => ({ shopToken: vi.fn() }));

import {
  classifyPrintifySubmitError,
  mergePrintifyRecipient,
  missingPrintifyRecipientFields,
  printifyAddressFromShopifyOrder,
  sanitizePrintifyRecipient,
} from "./printify-order-recipient";

describe("printifyAddressFromShopifyOrder", () => {
  it("maps the Shopify shipping address onto Printify address_to", () => {
    const address = printifyAddressFromShopifyOrder({
      email: "craig@example.com",
      phone: "0400000000",
      shipping_address: {
        first_name: "Craig",
        last_name: "Moodie",
        address1: "9 Rylett Court",
        address2: "",
        city: "Frankston South",
        province_code: "VIC",
        zip: "3199",
        country_code: "AU",
        phone: "0400000000",
      },
    });
    expect(address).toMatchObject({
      first_name: "Craig",
      last_name: "Moodie",
      email: "craig@example.com",
      phone: "0400000000",
      country: "AU",
      region: "VIC",
      address1: "9 Rylett Court",
      city: "Frankston South",
      zip: "3199",
    });
    expect(missingPrintifyRecipientFields(address)).toEqual([]);
  });

  it("does not invent Customer or a US country when the street is redacted", () => {
    const address = sanitizePrintifyRecipient(printifyAddressFromShopifyOrder({
      email: "craig@example.com",
      shipping_address: { province_code: "VIC", country_code: "AU" },
    }));
    expect(address.first_name).toBe("");
    expect(address.address1).toBe("");
    expect(address.country).toBe("AU");
    expect(missingPrintifyRecipientFields(address)).toEqual(
      expect.arrayContaining(["first_name", "last_name", "address1", "city", "zip"]),
    );
  });

  it("fills gaps from the Admin order without replacing fields already present", () => {
    const merged = mergePrintifyRecipient(
      sanitizePrintifyRecipient({
        first_name: "Customer",
        last_name: "",
        email: "craig@example.com",
        phone: "",
        country: "AU",
        region: "VIC",
        address1: "",
        city: "",
        zip: "",
      }),
      printifyAddressFromShopifyOrder({
        email: "other@example.com",
        shipping_address: {
          first_name: "Craig",
          last_name: "Moodie",
          address1: "9 Rylett Court",
          city: "Frankston South",
          province_code: "VIC",
          zip: "3199",
          country_code: "AU",
          phone: "0400000000",
        },
      }),
    );
    expect(merged.first_name).toBe("Craig");
    expect(merged.email).toBe("craig@example.com");
    expect(merged.address1).toBe("9 Rylett Court");
    expect(merged.phone).toBe("0400000000");
  });
});

describe("classifyPrintifySubmitError", () => {
  it("treats 8502 pending as a manual hold, not a failed create", () => {
    const info = classifyPrintifySubmitError(
      'Printify 400 on /shops/1/orders/abc/send_to_production.json: {"code":8502,"message":"not allowed to sent order to production with status pending"}',
    );
    expect(info.manualHold).toBe(true);
    expect(info.code).toBe(8502);
  });

  it("recovers the existing Printify order id from an 8503 conflict", () => {
    const info = classifyPrintifySubmitError(
      'Printify 409 on /shops/28205177/orders.json: {"status":"error","code":8503,"message":"Operation failed.","errors":{"reason":"Order already exists for the given external_id.","code":8503},"order":{"id":"6af62706f0264adfeb0ae886","external_id":"shopify-order-fulfill:gid://shopify/Order/1"}}',
    );
    expect(info.manualHold).toBe(false);
    expect(info.existingOrderId).toBe("6af62706f0264adfeb0ae886");
  });
});
