import { describe, expect, it } from "vitest";
import { applyRendererOverride, resolveGenerationPlan, type DirectGoogleImagePath } from "./generation-providers";

const PP_POSTER = { merchantId: "m-pp", packProfileKey: "petposterous", productFamily: "poster", isApparel: false };

describe("staging-only renderer override", () => {
  it("swaps only the Google renderer on staging; credential and size stay", () => {
    const base = resolveGenerationPlan(PP_POSTER);
    const plan = applyRendererOverride(base, "google-nb25", { RAILWAY_ENVIRONMENT_NAME: "Staging" });
    const path = plan.imagePath as DirectGoogleImagePath;
    expect(path.renderer.model).toBe("gemini-2.5-flash-image");
    expect(path.credential.id).toBe("google:petposterous");
    expect(path.imageSize).toBe("2K");
  });

  it("is ignored in production, without the gate, for unknown ids, and for legacy plans", () => {
    const base = resolveGenerationPlan(PP_POSTER);
    const model = (p: ReturnType<typeof resolveGenerationPlan>) => (p.imagePath as DirectGoogleImagePath).renderer.model;
    expect(model(applyRendererOverride(base, "google-nb25", { RAILWAY_ENVIRONMENT_NAME: "production" }))).toBe("gemini-3.1-flash-image");
    expect(
      model(applyRendererOverride(base, "google-nb25", { RAILWAY_ENVIRONMENT_NAME: "production", GENERATION_RENDERER_OVERRIDE_ENABLED: "true" })),
    ).toBe("gemini-3.1-flash-image");
    expect(model(applyRendererOverride(base, "google-nb25", {}))).toBe("gemini-3.1-flash-image");
    expect(model(applyRendererOverride(base, "made-up", { RAILWAY_ENVIRONMENT_NAME: "Staging" }))).toBe("gemini-3.1-flash-image");
    expect(model(applyRendererOverride(base, "openai-flare", { RAILWAY_ENVIRONMENT_NAME: "Staging" }))).toBe("gemini-3.1-flash-image");
    const classic = resolveGenerationPlan({ merchantId: "m-classic" });
    expect(applyRendererOverride(classic, "google-nb25", { RAILWAY_ENVIRONMENT_NAME: "Staging" }).imagePath).toBe("legacy");
  });
});
