import { describe, expect, it } from "vitest";
import { PETPOSTEROUS_CONCEPT_FRAMEWORKS } from "./petposterousCreative";
import {
  ART_STYLE_DEVICE_STRUCTURES,
  adminCandidateDraft,
  darknessLevel,
  deviceStructureId,
  humourOperatorId,
} from "./flywheelRecipe";

const valid = {
  source: "admin-probe",
  petSwap: false,
  shopDomain: "demo-store.myshopify.com",
  humourOperator: "pp-sleep-warfare",
  darknessLevel: 2,
  species: "dog",
  deviceStructure: "occupied_territory",
  deviceText: "The dog occupies the centre of the bed and the person is a sliver at the edge.",
  funnyTruth: "the bed is not for sharing",
  punchline: "MINE.",
  artStyle: "woodcut",
  behaviour: "He takes the middle of the bed.",
  productFamily: "apparel",
  credentialRef: "replicate:shared",
  renderProbeResultId: 12,
};

describe("flywheel recipe", () => {
  it("accepts only the sixteen framework ids", () => {
    expect(Object.keys(PETPOSTEROUS_CONCEPT_FRAMEWORKS)).toHaveLength(16);
    expect(humourOperatorId("pp-sleep-warfare")).toBe("pp-sleep-warfare");
    expect(humourOperatorId("deadpan")).toBeNull();
  });

  it("keeps darkness on 1 to 5 and structure on the closed eight", () => {
    expect(darknessLevel(1)).toBe(1);
    expect(darknessLevel(5)).toBe(5);
    expect(darknessLevel(0)).toBeNull();
    expect(darknessLevel(6)).toBeNull();
    expect(ART_STYLE_DEVICE_STRUCTURES).toHaveLength(8);
    expect(deviceStructureId("portrait_verdict")).toBe("portrait_verdict");
    expect(deviceStructureId("a funny picture")).toBeNull();
  });

  it("stores an admin render and refuses a pet swap or any other source", () => {
    const stored = adminCandidateDraft(valid);
    expect(stored).toMatchObject({ draft: { shopDomain: "demo-store.myshopify.com", species: "dog" } });
    expect(adminCandidateDraft({ ...valid, imageVariant: 2 })).toEqual({ skip: "extra-render" });
    expect(adminCandidateDraft({ ...valid, petSwap: true })).toEqual({ skip: "pet-swap" });
    expect(adminCandidateDraft({ ...valid, source: "storefront" })).toEqual({ skip: "source" });
    expect(adminCandidateDraft({ ...valid, shopDomain: "demo-store" })).toEqual({ skip: "shop" });
    expect(adminCandidateDraft({ ...valid, humourOperator: "not-a-framework" })).toEqual({ skip: "operator" });
    expect(adminCandidateDraft({ ...valid, credentialRef: "" })).toEqual({ skip: "credential" });
  });
});
