import { describe, expect, it } from "vitest";
import { buildProductSetInput, numericShopifyId, restVariantFromNode } from "./shopify-product-graphql";

describe("buildProductSetInput", () => {
  it("maps a REST size x colour body to productSet input", () => {
    const input: any = buildProductSetInput({
      title: "Custom Tee",
      body_html: "<p>x</p>",
      vendor: "Shop",
      product_type: "Tee",
      status: "unlisted",
      tags: ["a", "b"],
      options: [
        { name: "Size", values: ["S", "M"] },
        { name: "Color", values: ["Black"] },
      ],
      variants: [
        { option1: "S", option2: "Black", price: "19.95", sku: "5-s-black", inventory_management: null, inventory_policy: "continue" },
        { option1: "M", option2: "Black", price: "21.95", sku: "5-m-black", inventory_management: null, inventory_policy: "continue" },
      ],
      images: [{ src: "https://x/front.png", alt: "Front" }],
      metafields: [{ namespace: "ai_art_studio", key: "enable", value: "true", type: "single_line_text_field" }],
    });
    expect(input.status).toBe("UNLISTED");
    expect(input.descriptionHtml).toBe("<p>x</p>");
    expect(input.productType).toBe("Tee");
    expect(input.productOptions).toEqual([
      { name: "Size", position: 1, values: [{ name: "S" }, { name: "M" }] },
      { name: "Color", position: 2, values: [{ name: "Black" }] },
    ]);
    expect(input.variants[1]).toEqual({
      optionValues: [{ optionName: "Size", name: "M" }, { optionName: "Color", name: "Black" }],
      price: "21.95",
      sku: "5-m-black",
      inventoryPolicy: "CONTINUE",
      inventoryItem: { tracked: false },
    });
    expect(input.files).toEqual([{ originalSource: "https://x/front.png", alt: "Front", contentType: "IMAGE" }]);
    expect(input.metafields).toHaveLength(1);
  });

  it("supports more than 100 variants", () => {
    const sizes = Array.from({ length: 9 }, (_, i) => `S${i}`);
    const colors = Array.from({ length: 20 }, (_, i) => `C${i}`);
    const variants = sizes.flatMap((s) => colors.map((c) => ({ option1: s, option2: c, price: "10.00", inventory_policy: "continue" })));
    const input: any = buildProductSetInput({
      title: "Big",
      options: [{ name: "Size", values: sizes }, { name: "Color", values: colors }],
      variants,
    });
    expect(input.variants).toHaveLength(180);
  });

  it("uses Default Title when the REST body has no options", () => {
    const input: any = buildProductSetInput({ title: "Solo", variants: [{ price: "5.00" }] });
    expect(input.productOptions).toEqual([{ name: "Title", position: 1, values: [{ name: "Default Title" }] }]);
    expect(input.variants[0].optionValues).toEqual([{ optionName: "Title", name: "Default Title" }]);
    expect(input.variants[0].inventoryPolicy).toBe("DENY");
    expect(input.status).toBe("ACTIVE");
  });
});

describe("restVariantFromNode", () => {
  it("fills option slots by product option position, not selectedOptions order", () => {
    const v = restVariantFromNode(
      {
        id: "gid://shopify/ProductVariant/4616",
        title: "M / Black",
        price: "21.95",
        sku: "5-m-black",
        position: 7,
        inventoryPolicy: "CONTINUE",
        inventoryItem: { tracked: false },
        selectedOptions: [{ name: "Color", value: "Black" }, { name: "Size", value: "M" }],
        media: { nodes: [{ preview: { image: { url: "https://cdn/x.png" } } }] },
      },
      8704,
      ["Size", "Color"],
    );
    expect(v).toMatchObject({
      id: 4616,
      product_id: 8704,
      option1: "M",
      option2: "Black",
      option3: null,
      price: "21.95",
      inventory_policy: "continue",
      inventory_management: null,
      featured_image: { src: "https://cdn/x.png" },
    });
  });

  it("parses numeric ids from gids", () => {
    expect(numericShopifyId("gid://shopify/Product/123")).toBe(123);
    expect(numericShopifyId(456)).toBe(456);
    expect(numericShopifyId(null)).toBe(0);
  });
});
