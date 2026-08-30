import { describe, expect, it } from "vitest";
import { STYLE_PRESETS } from "./schema";
import { auditCatalogStyleModels } from "./catalogStyleModelAudit";

describe("catalog style model audit (report only — no reassignment)", () => {
  const rows = auditCatalogStyleModels(STYLE_PRESETS);

  it("lists every catalog style", () => {
    expect(rows.map((r) => r.slug).sort()).toEqual(
      [...STYLE_PRESETS].map((s) => s.id).sort(),
    );
  });

  it("catalog default is nano-banana (no STYLE_PRESETS generationModel)", () => {
    expect(rows.every((r) => r.currentModel === "nano-banana")).toBe(true);
  });

  it("flags floating / apparel / graphics still on nano-banana", () => {
    const flagged = rows.filter((r) => r.mismatch).map((r) => r.slug);
    expect(flagged).toEqual([
      "free-4-all",
      "pattern-maker",
      "opinionated",
      "quotes",
      "pet-portraits",
      "centered-graphic",
      "illustrated-motif",
      "vintage-print",
      "one-color-print",
      "retro-sunset-stack",
      "playful-cartoon",
    ]);
  });

  it("does not flag full-bleed decor on nano-banana", () => {
    const decorOk = rows.filter(
      (r) => r.base === "full-bleed" && r.currentModel === "nano-banana",
    );
    expect(decorOk.map((r) => r.slug)).toEqual(
      expect.arrayContaining([
        "royal-pet",
        "watercolor",
        "oil-painting",
        "pop-art",
        "minimal-line",
        "abstract",
        "vintage-poster",
        "photorealistic",
        "pet-portraits-decor",
      ]),
    );
    expect(decorOk.every((r) => r.mismatch === false)).toBe(true);
  });
});
