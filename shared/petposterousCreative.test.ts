import { describe, expect, it } from "vitest";
import { PETPOSTEROUS_CONCEPT_FRAMEWORKS, PETPOSTEROUS_VISUAL_SYSTEMS, petposterousLooks, petposterousProductFamily } from "./petposterousCreative";
import { parseCreativeBrief } from "./creativeBrief";

describe("Petposterous V2 product choices", () => {
  it("keeps sixteen frameworks separate from six visual systems", () => {
    expect(Object.keys(PETPOSTEROUS_CONCEPT_FRAMEWORKS)).toHaveLength(16);
    expect(PETPOSTEROUS_VISUAL_SYSTEMS.map((l) => l.label)).toEqual(["Deadpan", "Field Notes", "Vintage Print", "Character", "Portrait", "Domestic Cinema"]);
  });
  it("recognises bedding and pillows before generic AOP/apparel treatment", () => {
    expect(petposterousProductFamily({ name: "Cotton Comforter", designerType: "all-over-print" }, true)).toBe("bedding");
    expect(petposterousProductFamily({ name: "Faux Suede Pillow", designerType: "all-over-print" }, true)).toBe("pillow");
    expect(petposterousProductFamily({ name: "Indoor Wall Tapestry" })).toBe("tapestry");
    expect(petposterousProductFamily({ designerType: "framed-print" })).toBe("poster");
  });
  it("prioritises relevant recommended choices, exposing secondary compatible choices separately", () => {
    const tee = petposterousLooks("apparel", "pp-behavioural-studies");
    expect(tee.recommended[0].label).toBe("Field Notes");
    expect(tee.recommended).toHaveLength(4);
    expect(tee.more.map((l) => l.label)).toContain("Domestic Cinema");
    const bedding = petposterousLooks("bedding", "pp-sleep-warfare");
    expect(bedding.recommended[0].label).toBe("Domestic Cinema");
    expect([...bedding.recommended, ...bedding.more].map((l) => l.label)).not.toContain("Field Notes");
  });
  it("restores V2 fields while old briefs remain readable", () => {
    const brief = parseCreativeBrief({ v: 1, conceptFramework: "pp-sleep-warfare", visualSystem: "cinematic-domestic", productRenderer: "bedding" });
    expect(brief?.conceptFramework).toBe("pp-sleep-warfare");
    expect(brief?.visualSystem).toBe("cinematic-domestic");
    expect(brief?.productRenderer).toBe("bedding");
    expect(parseCreativeBrief({ v: 1, styleSlug: "pp-old-master" })?.styleSlug).toBe("pp-old-master");
  });
});
