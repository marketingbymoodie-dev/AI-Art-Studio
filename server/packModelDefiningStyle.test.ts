import { describe, expect, it } from "vitest";
import { modelDefiningStyle, type PackGenerationContext } from "./pack-generation";
import { persistGenerationModelDecor } from "@shared/styleGeneration";
import { resolveStyleGenerationForProduct } from "@shared/decorBackgroundFill";

const carrier = { id: 38, catalogSlug: "pp-owner-vs-pet", visibility: "pack_only", generationModel: "openai-flare", generationModelDecor: "google-nb2" };
const petty = { id: 31, catalogSlug: "pp-petty-crimes", visibility: "pack_only", generationModel: "openai-flare", generationModelDecor: "openai-flare" };
const sleep = { id: 44, catalogSlug: "pp-sleep-warfare", visibility: "pack_only", generationModel: "openai-flare", generationModelDecor: "google-nb-pro" };
const standard = { id: 1, catalogSlug: "pp-petty-crimes", visibility: null, generationModel: null, generationModelDecor: null };
const all = [standard, carrier, petty, sleep];
const ctx = (framework: string | null) => ({ conceptFramework: framework }) as PackGenerationContext;

describe("pack style model precedence", () => {
  it("the concept framework's own pack style defines the model, not the carrier", () => {
    expect(modelDefiningStyle(carrier, ctx("pp-petty-crimes"), all)).toBe(petty);
    expect(modelDefiningStyle(carrier, ctx("pp-sleep-warfare"), all)).toBe(sleep);
  });

  it("per-style: two frameworks on a framed print resolve to their own routes", () => {
    const route = (s: typeof carrier) => resolveStyleGenerationForProduct(s, "framed-print").route;
    expect(route(modelDefiningStyle(carrier, ctx("pp-petty-crimes"), all))).toBe("openai-flare");
    expect(route(modelDefiningStyle(carrier, ctx("pp-sleep-warfare"), all))).toBe("google-nb-pro");
  });

  it("no framework, same framework or unknown framework keeps the selected style", () => {
    expect(modelDefiningStyle(carrier, null, all)).toBe(carrier);
    expect(modelDefiningStyle(carrier, ctx(null), all)).toBe(carrier);
    expect(modelDefiningStyle(carrier, ctx("pp-owner-vs-pet"), all)).toBe(carrier);
    expect(modelDefiningStyle(carrier, ctx("pp-missing"), all)).toBe(carrier);
  });

  it("editor Default on decor saves 'legacy' (never the old seed value the boot migration rewrites)", () => {
    expect(persistGenerationModelDecor("default")).toBe("legacy");
    expect(persistGenerationModelDecor("nano-banana")).toBe("legacy");
    expect(persistGenerationModelDecor(null)).toBeNull();
    expect(persistGenerationModelDecor("openai-flare")).toBe("openai-flare");
    expect(resolveStyleGenerationForProduct({ generationModel: "openai-flare", generationModelDecor: "legacy" }, "framed-print").route).toBeNull();
  });
});
