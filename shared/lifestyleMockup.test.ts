import { describe, expect, it } from "vitest";
import {
  fillLifestyleTemplate,
  joinPanelList,
  lifestyleGarmentForBlueprint,
  lifestyleImageInput,
  lifestyleFlatsPresent,
  lifestylePanelManifest,
  lifestylePartStateFromCoverage,
  LIFESTYLE_TEMPLATES,
  sanitiseLifestyleSetting,
} from "./lifestyleMockup";
import { PULOVER_HOODIE_BLUEPRINT_ID, ZIP_HOODIE_BLUEPRINT_ID } from "./hoodieTemplate";

const slots = {
  gender: "female" as const,
  setting: "farmers market stall",
  frontPrinted: "a",
  frontPlain: "b",
  backPrinted: "c",
  backPlain: "d",
};

describe("lifestyle templates", () => {
  it("maps zip 451 / pullover 450 and nothing else", () => {
    expect(lifestyleGarmentForBlueprint(ZIP_HOODIE_BLUEPRINT_ID)).toBe("zip");
    expect(lifestyleGarmentForBlueprint(PULOVER_HOODIE_BLUEPRINT_ID)).toBe("pullover");
    expect(lifestyleGarmentForBlueprint(433)).toBeNull();
  });

  it("fills every slot on both garments", () => {
    for (const g of ["zip", "pullover"] as const) {
      const out = fillLifestyleTemplate(g, slots);
      expect(out).not.toMatch(/\{[A-Z_]+\}/);
      expect(out).toContain("same female person");
      expect(out).toContain("everyday farmers market stall");
      expect(out).toContain("Printed: a. Plain (no artwork): b.");
      expect(out).toContain("Printed: c. Plain: d.");
    }
  });

  it("keeps the garment-specific lines", () => {
    expect(LIFESTYLE_TEMPLATES.zip).toContain("The hood has NO drawstrings of any kind");
    expect(LIFESTYLE_TEMPLATES.pullover).toContain("The hood has white knotted drawstrings, always.");
    for (const g of ["zip", "pullover"] as const) {
      expect(LIFESTYLE_TEMPLATES[g]).toContain("exactly like the close-up in reference image 3");
      expect(LIFESTYLE_TEMPLATES[g]).not.toMatch(/reference image 4|4 = /);
      expect(LIFESTYLE_TEMPLATES[g]).toContain("not shifted down toward the waist.");
    }
  });

  it("orders reference images 1-3 as the templates number them", () => {
    expect(lifestyleImageInput({ frontFlat: "F", backFlat: "B", pocket: "P" })).toEqual(["F", "B", "P"]);
  });
});

describe("lifestyleFlatsPresent", () => {
  it("requires BOTH hosted front and back flats", () => {
    expect(lifestyleFlatsPresent({ hoodieAopMockups: { front: "https://x/f.png" } })).toBe(false);
    expect(lifestyleFlatsPresent({ hoodieAopMockups: { front: "https://x/f.png", back: null } })).toBe(false);
    expect(lifestyleFlatsPresent({ hoodieAopMockups: { front: "https://x/f.png", back: "data:image/png;base64,AA" } })).toBe(false);
    expect(lifestyleFlatsPresent({})).toBe(false);
    expect(lifestyleFlatsPresent({ hoodieAopMockups: { front: "https://x/f.png", back: "https://x/b.png" } })).toBe(true);
  });
});

describe("lifestylePanelManifest", () => {
  it("place-mode hoodie defaults: front + hood printed, back/sleeves/trim plain", () => {
    const m = lifestylePanelManifest("pullover", { mode: "place", enabled: {}, pocketsEnabled: true });
    expect(m.frontPrinted).toEqual(["the front body", "the kangaroo pocket", "the hood"]);
    expect(m.frontPlain).toEqual(["both sleeves", "the cuffs", "the waistband"]);
    expect(m.backPrinted).toEqual(["the hood"]);
    expect(m.backPlain).toEqual(["the back body", "both sleeves", "the cuffs", "the waistband"]);
  });

  it("honours saved toggles and zip naming", () => {
    const m = lifestylePanelManifest("zip", {
      mode: "place",
      enabled: { "back-body": true, "left-sleeve": true, "right-sleeve": true, hood: false },
      pocketsEnabled: false,
    });
    expect(m.frontPrinted).toEqual(["the left and right front panels", "both sleeves"]);
    expect(m.frontPlain).toEqual(["the hand-warmer pockets", "the hood", "the cuffs", "the waistband"]);
    expect(m.backPrinted).toEqual(["the back body", "both sleeves"]);
  });

  it("pattern mode prints every group; trim stays plain", () => {
    const m = lifestylePanelManifest("zip", { mode: "pattern", enabled: { "back-body": false }, pocketsEnabled: true });
    expect(m.backPrinted).toEqual(["the back body", "the hood", "both sleeves"]);
    expect(m.backPlain).toEqual(["the cuffs", "the waistband"]);
  });
});

describe("helpers", () => {
  it("joins panel lists", () => {
    expect(joinPanelList([])).toBe("none");
    expect(joinPanelList(["a"])).toBe("a");
    expect(joinPanelList(["a", "b", "c"])).toBe("a, b and c");
  });

  it("sanitises the setting phrase", () => {
    expect(sanitiseLifestyleSetting('"A quiet bookshop corner."')).toBe("a quiet bookshop corner");
    expect(sanitiseLifestyleSetting("x")).toBeNull();
    expect(sanitiseLifestyleSetting("")).toBeNull();
  });
});

describe("lifestylePanelManifest facts", () => {
  it("a partly printed hood is named as printed but flagged mostly plain", () => {
    const m = lifestylePanelManifest("pullover", { mode: "place", enabled: {}, pocketsEnabled: true }, { hood: "partial" });
    expect(m.frontPrinted).toContain("the hood (only partly — mostly plain)");
    expect(m.backPrinted).toContain("the hood (only partly — mostly plain)");
  });

  it("coverage bands", () => {
    expect(lifestylePartStateFromCoverage(0)).toBe(false);
    expect(lifestylePartStateFromCoverage(0.2)).toBe("partial");
    expect(lifestylePartStateFromCoverage(0.38)).toBe(true);
  });

  it("a hood toggled on but printed plain is reported plain", () => {
    const m = lifestylePanelManifest("zip", { mode: "place", enabled: { hood: true }, pocketsEnabled: false }, { hood: false });
    expect(m.frontPrinted).not.toContain("the hood");
    expect(m.frontPlain).toContain("the hood");
    expect(m.backPlain).toContain("the hood");
  });
});
