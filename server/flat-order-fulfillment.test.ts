import { describe, expect, it } from "vitest";
import {
  creatorCartLinesToOrderLines,
  looksLikeApronProduct,
  pickFlatOrderArtworkUrl,
  pickFlatOrderSizeColor,
  placementForPrintMatch,
  resolveGenerationJobIdForOrderLine,
  resolvePrintifyTarget,
  resolvePrintifyTargetForOrderLine,
  shouldUseFlatBake,
  usablePrintArtworkUrl,
} from "./flat-order-fulfillment";
import { pickAopPanelsForOrderLine } from "./aop-line-snapshot";
import type { ProductType } from "@shared/schema";

describe("pickFlatOrderArtworkUrl", () => {
  it("prefers the artwork stamped on that cart line", () => {
    expect(
      pickFlatOrderArtworkUrl({
        flatPlacerArtworkUrl: "https://cdn.example/new.png",
        jobDesignImageUrl: "https://cdn.example/old.png",
        lineArtworkUrl: "https://cdn.example/line.png",
      }),
    ).toBe("https://cdn.example/line.png");
  });

  it("ignores truncated Shopify attributes and falls back to the job", () => {
    const truncated = `https://cdn.example/${"x".repeat(240)}`;
    expect(truncated.length).toBeGreaterThanOrEqual(255);
    expect(usablePrintArtworkUrl(truncated)).toBe("");
    expect(
      pickFlatOrderArtworkUrl({
        jobDesignImageUrl: "https://cdn.example/job.png",
        lineArtworkUrl: truncated,
      }),
    ).toBe("https://cdn.example/job.png");
  });

  it("falls back to placer then job", () => {
    expect(
      pickFlatOrderArtworkUrl({
        flatPlacerArtworkUrl: "https://cdn.example/placer.png",
        jobDesignImageUrl: "https://cdn.example/job.png",
      }),
    ).toBe("https://cdn.example/placer.png");
    expect(
      pickFlatOrderArtworkUrl({
        lineArtworkUrl: "https://cdn.example/line.png",
      }),
    ).toBe("https://cdn.example/line.png");
  });
});

describe("resolveGenerationJobIdForOrderLine", () => {
  it("uses the cart line job id over a shared shadow designId", () => {
    expect(
      resolveGenerationJobIdForOrderLine({
        lineJobId: "job-a",
        publishedDesignId: "job-b::deadbeef",
        lineDesignId: "Apron · Style #ab12",
      }),
    ).toBe("job-a");
  });

  it("strips the checkout mockup hash from published designId", () => {
    expect(
      resolveGenerationJobIdForOrderLine({
        publishedDesignId: "job-a::cafebabe",
      }),
    ).toBe("job-a");
  });

  it("ignores human-readable _design_id labels", () => {
    expect(
      resolveGenerationJobIdForOrderLine({
        lineDesignId: "Apron · Style #ab12",
      }),
    ).toBeNull();
  });
});

describe("pickFlatOrderSizeColor", () => {
  it("prefers designState over job columns when the line has no size/color", () => {
    expect(
      pickFlatOrderSizeColor({
        designStateSize: "20x30",
        designStateColor: "white",
        jobSize: "11x14",
        jobColor: "black",
      }),
    ).toEqual({ sizeId: "20x30", colorId: "white" });
  });

  it("line beats designState — natural line after job was overwritten to blue", () => {
    expect(
      pickFlatOrderSizeColor({
        designStateSize: "M",
        designStateColor: "blue",
        lineSize: "M",
        lineColor: "natural",
        jobSize: "M",
        jobColor: "blue",
      }),
    ).toEqual({ sizeId: "M", colorId: "natural" });
  });

  it("line beats designState — reverse last-write-wins (blue first, then natural on the job)", () => {
    expect(
      pickFlatOrderSizeColor({
        designStateSize: "M",
        designStateColor: "natural",
        lineSize: "M",
        lineColor: "blue",
        jobSize: "M",
        jobColor: "natural",
      }),
    ).toEqual({ sizeId: "M", colorId: "blue" });
  });

  it("falls back to designState when the line field is absent", () => {
    expect(
      pickFlatOrderSizeColor({
        designStateSize: "20x30",
        designStateColor: "white",
        lineSize: "",
        lineColor: "",
        jobSize: "11x14",
        jobColor: "black",
      }),
    ).toEqual({ sizeId: "20x30", colorId: "white" });
  });

  it("design product override wins over line and designState", () => {
    expect(
      pickFlatOrderSizeColor({
        designProductSizeId: "16x20",
        designProductColorId: "black",
        designStateSize: "20x30",
        designStateColor: "white",
        lineSize: "M",
        lineColor: "blue",
        jobSize: "11x14",
        jobColor: "gold",
      }),
    ).toEqual({ sizeId: "16x20", colorId: "black" });
  });
});

describe("resolvePrintifyTargetForOrderLine", () => {
  const productType = {
    printifyBlueprintId: 12,
    printifyProviderId: 99,
    variantMap: JSON.stringify({
      "m:natural": { printifyVariantId: 111, providerId: 99 },
      "m:blue": { printifyVariantId: 222, providerId: 99 },
    }),
    flatCalibration: null,
  } as unknown as ProductType;

  it("uses the line _printify_variant_id even when designState color maps elsewhere", () => {
    const fromJobColor = resolvePrintifyTarget(productType, "m", "blue");
    expect(fromJobColor?.printifyVariantId).toBe(222);
    const target = resolvePrintifyTargetForOrderLine(productType, "m", "blue", {
      _printify_variant_id: "111",
      _printify_blueprint_id: "12",
      _printify_provider_id: "99",
    });
    expect(target).toEqual({ blueprintId: 12, providerId: 99, printifyVariantId: 111 });
  });

  it("falls back to the size/color map when the line has no Printify variant", () => {
    expect(resolvePrintifyTargetForOrderLine(productType, "m", "blue", {})).toEqual({
      blueprintId: 12,
      providerId: 99,
      printifyVariantId: 222,
    });
  });
});

describe("pickAopPanelsForOrderLine", () => {
  it("prefers the line snapshot over later job panels", () => {
    const line = [{ position: "front", url: "https://cdn.example/line-front.png" }];
    const job = [
      { position: "front", url: "https://cdn.example/job-front.png" },
      { position: "back", url: "https://cdn.example/job-back.png" },
    ];
    expect(pickAopPanelsForOrderLine(line, job)).toEqual(line);
  });

  it("falls back to job panels when the line has no snapshot", () => {
    const job = [{ position: "front", url: "https://cdn.example/job-front.png" }];
    expect(pickAopPanelsForOrderLine(null, job)).toEqual(job);
    expect(pickAopPanelsForOrderLine([], job)).toEqual(job);
  });
});

describe("resolvePrintifyTarget phone size-only", () => {
  it("resolves iphone_13:12_pro via edgeWrap size-only fallback", () => {
    const productType = {
      printifyBlueprintId: 999,
      printifyProviderId: 1,
      variantMap: JSON.stringify({
        "iphone_13:black": { printifyVariantId: 4242, providerId: 1 },
      }),
      flatCalibration: JSON.stringify({ edgeWrap: true }),
    } as unknown as ProductType;

    const target = resolvePrintifyTarget(productType, "iphone_13", "12_pro");
    expect(target).toEqual({
      blueprintId: 999,
      providerId: 1,
      printifyVariantId: 4242,
    });
  });

  it("does not size-only fallback without edgeWrap", () => {
    const productType = {
      printifyBlueprintId: 999,
      printifyProviderId: 1,
      variantMap: JSON.stringify({
        "iphone_13:black": { printifyVariantId: 4242, providerId: 1 },
      }),
      flatCalibration: JSON.stringify({ edgeWrap: false }),
    } as unknown as ProductType;

    expect(resolvePrintifyTarget(productType, "iphone_13", "12_pro")).toBeNull();
  });
});

describe("creatorCartLinesToOrderLines", () => {
  it("maps cart attributes including per-line placement onto order properties", () => {
    const lines = creatorCartLinesToOrderLines([
      {
        id: "gid://shopify/CartLine/1",
        quantity: 2,
        merchandiseId: "gid://shopify/ProductVariant/12345",
        attributes: [
          { key: "_appai_job_id", value: "job-a" },
          { key: "_flat_pl", value: '{"f":{"s":1.2,"x":0.1,"y":0.2}}' },
          { key: "_size", value: "one_size" },
          { key: "_color", value: "black" },
        ],
      },
    ]);
    expect(lines).toEqual([
      {
        lineId: "gid://shopify/CartLine/1",
        variantId: "12345",
        quantity: 2,
        properties: {
          _appai_job_id: "job-a",
          _flat_pl: '{"f":{"s":1.2,"x":0.1,"y":0.2}}',
          _size: "one_size",
          _color: "black",
        },
      },
    ]);
  });
});

describe("shouldUseFlatBake", () => {
  it("uses the flat bake for calibrated AOP when a line snapshot exists", () => {
    expect(
      shouldUseFlatBake({
        onTheFlyTier: null,
        hasFlatCalibrationViews: true,
        hasLineOrJobFlatPlacement: true,
      }),
    ).toBe(true);
    expect(
      shouldUseFlatBake({
        onTheFlyTier: null,
        hasFlatCalibrationViews: true,
        hasLineOrJobFlatPlacement: false,
      }),
    ).toBe(false);
  });
});

describe("placementForPrintMatch", () => {
  it("shrinks apron print scale to match the in-app mockup", () => {
    expect(looksLikeApronProduct({ name: "Custom Apron (AOP)" })).toBe(true);
    expect(placementForPrintMatch({ scale: 1, offsetX: 0, offsetY: 0 }, true).scale).toBeCloseTo(
      0.9,
    );
    expect(placementForPrintMatch({ scale: 1.1, offsetX: 0, offsetY: 0 }, false).scale).toBe(1.1);
  });
});
