import { describe, expect, it } from "vitest";
import {
  checkReferenceInputs,
  isPackOnlyStyle,
  packContainsStyle,
  parseStyleInputCapabilities,
  resolvePackPresetIds,
} from "./stylePacks";
import {
  filterStylePresetsForPage,
  parseCustomizerPageStyleConfig,
  validateCustomizerPageStyleConfig,
} from "./customizerPageStyles";

const merchantRows = [
  { id: "11", name: "Watercolor", category: "decor", catalogSlug: "watercolor" },
  { id: "12", name: "Centered Graphic", category: "all", catalogSlug: "centered-graphic" },
  { id: "20", name: "Pack A", category: "all", catalogSlug: "pk-a", visibility: "pack_only" },
  { id: "21", name: "Pack B", category: "apparel", catalogSlug: "pk-b", visibility: "pack_only" },
  { id: "30", name: "My Custom", category: "all", catalogSlug: null },
];

describe("pack resolution", () => {
  it("maps slug items onto this merchant's rows in pack order", () => {
    const items = [
      { catalogSlug: "pk-b", sortOrder: 2 },
      { catalogSlug: "PK-A", sortOrder: 1 },
      { stylePresetId: 30, sortOrder: 3 },
      { catalogSlug: "not-provisioned", sortOrder: 0 },
    ];
    expect(resolvePackPresetIds(items, merchantRows)).toEqual(["20", "21", "30"]);
  });

  it("membership by slug or row id", () => {
    const items = [{ catalogSlug: "pk-a" }, { stylePresetId: 30 }];
    expect(packContainsStyle(items, { id: 20, catalogSlug: "pk-a" })).toBe(true);
    expect(packContainsStyle(items, { id: 30, catalogSlug: null })).toBe(true);
    expect(packContainsStyle(items, { id: 21, catalogSlug: "pk-b" })).toBe(false);
  });

  it("only visibility pack_only is pack-only", () => {
    expect(isPackOnlyStyle({ visibility: "pack_only" })).toBe(true);
    expect(isPackOnlyStyle({ visibility: null })).toBe(false);
    expect(isPackOnlyStyle({})).toBe(false);
  });
});

describe("page style config with packs", () => {
  it("parses and validates mode:pack", () => {
    expect(parseCustomizerPageStyleConfig({ mode: "pack", packId: " p1 " })).toEqual({ mode: "pack", packId: "p1" });
    expect(parseCustomizerPageStyleConfig({ mode: "pack", packId: "" })).toBeNull();
    expect(validateCustomizerPageStyleConfig({ mode: "pack", packId: "p1" })).toBeNull();
  });

  it("category pages never show pack-only styles", () => {
    const all = filterStylePresetsForPage(merchantRows as any, { mode: "category", category: "all" });
    expect(all.map((s) => s.id)).toEqual(["11", "12", "30"]);
    const apparel = filterStylePresetsForPage(merchantRows as any, { mode: "category", category: "apparel" });
    expect(apparel.map((s) => s.id)).toEqual(["12", "30"]);
  });

  it("existing pages without pack rows are unchanged", () => {
    const legacy = merchantRows.filter((r) => !r.visibility);
    expect(filterStylePresetsForPage(legacy as any, { mode: "category", category: "all" }).map((s) => s.id)).toEqual([
      "11",
      "12",
      "30",
    ]);
    expect(
      filterStylePresetsForPage(legacy as any, { mode: "selected", presetIds: ["12", "11"] }).map((s) => s.id),
    ).toEqual(["11", "12"]);
  });

  it("a resolved pack (selected ids) shows its pack-only styles; an unresolved pack shows nothing", () => {
    const resolved = { mode: "selected" as const, presetIds: resolvePackPresetIds([{ catalogSlug: "pk-a" }], merchantRows) };
    expect(filterStylePresetsForPage(merchantRows as any, resolved).map((s) => s.id)).toEqual(["20"]);
    expect(filterStylePresetsForPage(merchantRows as any, { mode: "pack", packId: "p1" })).toEqual([]);
  });
});

describe("declared input capabilities", () => {
  const caps = parseStyleInputCapabilities({
    petPhoto: "optional",
    ownerPhoto: "unsupported",
    humor: { supported: true, default: "witty" },
    relationship: { supported: true, default: "its-complicated" },
  });

  it("null column = legacy style, no checks", () => {
    expect(parseStyleInputCapabilities(null)).toBeNull();
    expect(checkReferenceInputs(null, ["owner", "owner"], { personalized: true })).toBeNull();
  });

  it("defaults unknown requirement values to optional", () => {
    expect(parseStyleInputCapabilities({ petPhoto: "sometimes" })?.petPhoto).toBe("optional");
  });

  it("optional pet photo: concept without a photo is fine, a likeness needs one", () => {
    expect(checkReferenceInputs(caps, [], { personalized: false })).toBeNull();
    expect(checkReferenceInputs(caps, [], { personalized: true })?.code).toBe("REFERENCE_REQUIRED");
    expect(checkReferenceInputs(caps, ["pet"], { personalized: true })).toBeNull();
  });

  it("unsupported roles are rejected, required roles always enforced", () => {
    expect(checkReferenceInputs(caps, ["pet", "owner"], { personalized: false })?.code).toBe("REFERENCE_UNSUPPORTED");
    const both = parseStyleInputCapabilities({ petPhoto: "required", ownerPhoto: "required" });
    expect(checkReferenceInputs(both, ["pet"], { personalized: false })).toMatchObject({ code: "REFERENCE_REQUIRED", role: "owner" });
    expect(checkReferenceInputs(both, ["pet", "owner"], { personalized: false })).toBeNull();
  });

  it("a style with no photo input never demands one", () => {
    const none = parseStyleInputCapabilities({ petPhoto: "unsupported", ownerPhoto: "unsupported" });
    expect(checkReferenceInputs(none, [], { personalized: true })).toBeNull();
  });
});
