import { describe, expect, it } from "vitest";
import {
  BOMBER_BACK_PREVIEW_PLACEMENT_SCALE,
  BOMBER_FRONT_BODY_ASPECT_X_SCALE,
  BOMBER_FRONT_BODY_OFFSET_Y_FRAC,
  BOMBER_FRONT_BODY_PLACEMENT_SCALE,
  BOMBER_FRONT_BODY_PREVIEW_HEIGHT_SCALE,
  BOMBER_FRONT_BODY_PREVIEW_OFFSET_Y_FRAC,
  BOMBER_FRONT_BODY_PREVIEW_PLACEMENT_SCALE,
  BOMBER_JACKET_BLUEPRINT_ID,
  BOMBER_PATTERN_BACK_PRINT_TILE_SCALE,
  BOMBER_PATTERN_FRONT_PRINT_TILE_SCALE,
  BOMBER_PATTERN_SLEEVES_PRINT_TILE_SCALE,
  BOMBER_SLEEVES_PREVIEW_PLACEMENT_SCALE,
  bomberPatternPrintTileScaleForPanel,
  BEANIE_BLUEPRINT_ID,
  BEANIE_PREVIEW_PLACEMENT_SCALE,
  PULOVER_HOODIE_BLUEPRINT_ID,
  PULLOVER_FRONT_BODY_PLACE_OFFSET_X,
  PULLOVER_FRONT_BODY_PLACE_OFFSET_Y,
  PULLOVER_FRONT_BODY_PLACE_SCALE,
  PULLOVER_HOOD_PLACE_OFFSET_Y,
  PULLOVER_HOOD_PLACE_SCALE,
  PULLOVER_POCKET_BIAS_OFFSET_X_PERCENT,
  PULLOVER_POCKET_BIAS_OFFSET_Y_PERCENT,
  PULLOVER_SLEEVE_CALIBRATION_SOURCE_RECT,
  LEGGINGS_CASUAL_BLUEPRINT_ID,
  LEGGINGS_CAPRI_BLUEPRINT_ID,
  SWEATSHIRT_BLUEPRINT_ID,
  ZIP_HOODIE_BLUEPRINT_ID,
  PILLOW_WRAP_BLUEPRINT_ID,
  FAUX_SUEDE_PILLOW_WRAP_BLUEPRINT_ID,
  BODY_PILLOW_WRAP_BLUEPRINT_ID,
  BODY_PILLOW_DEFAULT_PLACE_SCALE,
  bodyPillowGenerationAspectRatio,
  defaultAopPlaceScale,
  isBodyPillowBlueprint,
  createFreshAopTemplate,
  createDefaultMesh,
  defaultHoodieTypeForBlueprint,
  defaultPulloverDesignGroups,
  defaultSweatshirtDesignGroups,
  designGroupsForBlueprint,
  drawMockupImageInCanvas,
  hoodiePanelKeyToPrintifyPosition,
  isBeanieBlueprint,
  flatArtFitForBlueprint,
  isBomberJacketBlueprint,
  isValidAopTemplateSlug,
  normalizeAopTemplateSlugInput,
  MAX_MESH_COLS,
  defaultPlacerEditorForBlueprint,
  defaultPrintFileLayoutForBlueprint,
  resolvePlacerEditor,
  resolvePrintFileLayout,
  resolveGarmentLayout,
  usesJumperNoHoodGarmentUi,
  shouldForceSolidSweatshirtCollar,
  isPillowWrapBlueprint,
  isPillowWrapTemplate,
  migrateSweatshirtDesignGroups,
  mockupDrawRect,
  IDENTITY_TRANSFORM_2D,
  normalizeHoodieTemplate,
  restorePulloverFrontSleeveSourceRects,
  panelsEligibleForView,
  SWEATSHIRT_BODY_PREVIEW_PLACEMENT_SCALE,
  SWEATSHIRT_TRIM_PANEL_KEYS,
  mergeFrontBodyPanelPlacementBias,
  mergePanelPlacementBiasPercent,
  migrateFrontPocketOutOfTrimGroup,
  findGroupForPanel,
  resolveFrontBodyPanelBias,
  FRONT_CHEST_PANEL_KEYS,
  FRONT_POCKET_PANEL_KEYS,
  ZERO_PANEL_PLACEMENT_BIAS,
} from "./hoodieTemplate";

describe("createFreshAopTemplate", () => {
  it("builds blank views and blueprint-specific design groups", () => {
    const t = createFreshAopTemplate({
      name: "sweatshirt-aop-L",
      blueprintId: 449,
    });
    expect(t.name).toBe("sweatshirt-aop-L");
    expect(t.views.front.layers).toHaveLength(0);
    expect(t.views.back.layers).toHaveLength(0);
    expect(t.productTypeId).toBeNull();
    expect(t.hoodieType).toBe("aop-bp-449");
    expect(t.designGroups.length).toBeGreaterThan(0);
  });

  it("uses pullover defaults for bp 450", () => {
    const t = createFreshAopTemplate({ name: "pullover-hoodie-aop-L", blueprintId: 450 });
    expect(t.hoodieType).toBe("pullover-hoodie-aop");
    expect(t.designGroups.find((g) => g.id === "front-body")?.panelKeys).toEqual([
      "front",
      "front_pocket",
    ]);
  });

  it("uses sweatshirt defaults for bp 449", () => {
    const t = createFreshAopTemplate({ name: "sweatshirt-aop-L", blueprintId: 449 });
    expect(t.designGroups.find((g) => g.id === "trim")?.panelKeys).toEqual([
      ...SWEATSHIRT_TRIM_PANEL_KEYS,
    ]);
    expect(t.designGroups.find((g) => g.id === "left-sleeve")?.panelKeys).toEqual(["left_sleeve"]);
    expect(t.designGroups.find((g) => g.id === "hood")).toBeUndefined();
    expect(t.designGroups.find((g) => g.id === "collar")).toBeUndefined();
  });
});

describe("isValidAopTemplateSlug", () => {
  it("accepts admin slugs", () => {
    expect(isValidAopTemplateSlug("pullover-hoodie-aop-L")).toBe(true);
    expect(isValidAopTemplateSlug("bad slug")).toBe(false);
  });
});

describe("normalizeAopTemplateSlugInput", () => {
  it("converts labels with spaces into admin slugs", () => {
    expect(normalizeAopTemplateSlugInput("Spun Polyester Square Pillow")).toBe(
      "Spun_Polyester_Square_Pillow",
    );
  });
});

describe("pillow wrap blueprints", () => {
  it("recognises spun polyester (220) and faux suede (223)", () => {
    expect(isPillowWrapBlueprint(PILLOW_WRAP_BLUEPRINT_ID)).toBe(true);
    expect(isPillowWrapBlueprint(FAUX_SUEDE_PILLOW_WRAP_BLUEPRINT_ID)).toBe(true);
    expect(isPillowWrapBlueprint(BODY_PILLOW_WRAP_BLUEPRINT_ID)).toBe(true);
    expect(isPillowWrapBlueprint(451)).toBe(false);
  });

  it("uses pillow design groups for bp 2758 body pillow", () => {
    const groups = designGroupsForBlueprint(BODY_PILLOW_WRAP_BLUEPRINT_ID);
    expect(groups.find((g) => g.id === "front-face")?.panelKeys).toEqual(["front"]);
    expect(groups.find((g) => g.id === "back-face")?.panelKeys).toEqual(["back"]);
    expect(groups.find((g) => g.id === "front-body")).toBeUndefined();
  });

  it("defaultHoodieTypeForBlueprint maps pillow blueprints", () => {
    expect(defaultHoodieTypeForBlueprint(PILLOW_WRAP_BLUEPRINT_ID)).toBe("pillow-wrap-aop");
    expect(defaultHoodieTypeForBlueprint(FAUX_SUEDE_PILLOW_WRAP_BLUEPRINT_ID)).toBe(
      "pillow-wrap-aop",
    );
  });

  it("normalizeHoodieTemplate replaces hoodie groups on faux suede templates", () => {
    const raw = createFreshAopTemplate({
      name: "faux-suede-square-pillow",
      blueprintId: FAUX_SUEDE_PILLOW_WRAP_BLUEPRINT_ID,
    });
    raw.designGroups = designGroupsForBlueprint(ZIP_HOODIE_BLUEPRINT_ID);
    const normalized = normalizeHoodieTemplate(raw);
    expect(isPillowWrapTemplate(normalized)).toBe(true);
    expect(normalized.placerEditor).toBe("front-back-face");
    expect(normalized.printFileLayout).toBe("wrap-single");
    expect(normalized.designGroups?.find((g) => g.id === "front-face")).toBeDefined();
    expect(normalized.designGroups?.find((g) => g.id === "front-body")).toBeUndefined();
  });

  it("explicit placerEditor front-back-face works for unlisted blueprint ids", () => {
    const t = normalizeHoodieTemplate(
      createFreshAopTemplate({
        name: "custom-pillow",
        blueprintId: 996,
        placerEditor: "front-back-face",
        printFileLayout: "wrap-single",
        hoodieType: "pillow-wrap-aop",
      }),
    );
    expect(isPillowWrapTemplate(t)).toBe(true);
    expect(resolvePlacerEditor(t)).toBe("front-back-face");
    expect(t.designGroups?.find((g) => g.id === "front-face")).toBeDefined();
    expect(panelsEligibleForView("front", 996, "front-back-face")).toContain("front");
    expect(panelsEligibleForView("front", 996, "front-back-face")).not.toContain("front_left");
  });

  it("forces body-pillow generation AR to landscape", () => {
    expect(isBodyPillowBlueprint(BODY_PILLOW_WRAP_BLUEPRINT_ID)).toBe(true);
    expect(bodyPillowGenerationAspectRatio("20:54")).toBe("54:20");
    expect(bodyPillowGenerationAspectRatio("27:10")).toBe("27:10");
  });

  it("defaults body-pillow Place on Item to 122%", () => {
    expect(defaultAopPlaceScale(BODY_PILLOW_WRAP_BLUEPRINT_ID)).toBe(BODY_PILLOW_DEFAULT_PLACE_SCALE);
    expect(defaultAopPlaceScale(BODY_PILLOW_WRAP_BLUEPRINT_ID)).toBeCloseTo(1.22, 5);
    expect(defaultAopPlaceScale(FAUX_SUEDE_PILLOW_WRAP_BLUEPRINT_ID)).toBe(1.1);
    expect(defaultAopPlaceScale(ZIP_HOODIE_BLUEPRINT_ID)).toBe(1);
  });

  it("defaultPrintFileLayoutForBlueprint maps body pillow to split", () => {
    expect(defaultPrintFileLayoutForBlueprint(BODY_PILLOW_WRAP_BLUEPRINT_ID)).toBe("split-front-back");
    expect(defaultPrintFileLayoutForBlueprint(PILLOW_WRAP_BLUEPRINT_ID)).toBe("wrap-single");
    expect(defaultPrintFileLayoutForBlueprint(450)).toBe("split-front-back");
  });

  it("defaultPrintFileLayoutForBlueprint maps lumbar pillow 538 to split", () => {
    expect(defaultPrintFileLayoutForBlueprint(538)).toBe("split-front-back");
  });
});

describe("jumper no hood garment layout", () => {
  it("seeds sweatshirt-style groups for any blueprint", () => {
    const t = createFreshAopTemplate({
      name: "aop-jacket-L",
      blueprintId: 1604,
      garmentLayout: "jumper-no-hood",
    });
    expect(t.garmentLayout).toBe("jumper-no-hood");
    expect(t.placerEditor).toBe("hoodie");
    expect(t.designGroups?.find((g) => g.id === "hood")).toBeUndefined();
    expect(t.designGroups?.find((g) => g.id === "front-body")?.panelKeys).toEqual(["front"]);
    expect(t.designGroups?.find((g) => g.id === "left-sleeve")).toBeDefined();
    expect(usesJumperNoHoodGarmentUi(t)).toBe(true);
  });

  it("resolveGarmentLayout infers jumper for bp 449", () => {
    const t = createFreshAopTemplate({ name: "sweatshirt-aop-L", blueprintId: 449 });
    expect(resolveGarmentLayout(t)).toBe("jumper-no-hood");
  });

  it("panelsEligibleForView hides hood panels for jumper layout", () => {
    const front = panelsEligibleForView("front", 1604, "hoodie", "jumper-no-hood");
    expect(front).toContain("front");
    expect(front).not.toContain("left_hood");
    expect(front).not.toContain("front_left");
  });
});

describe("defaultHoodieTypeForBlueprint", () => {
  it("maps known blueprints", () => {
    expect(defaultHoodieTypeForBlueprint(450)).toBe("pullover-hoodie-aop");
    expect(defaultHoodieTypeForBlueprint(451)).toBe("zip-hoodie-aop");
    expect(defaultHoodieTypeForBlueprint(LEGGINGS_CASUAL_BLUEPRINT_ID)).toBe("leggings-aop");
    expect(defaultHoodieTypeForBlueprint(1604)).toBe("aop-bp-1604");
  });
});

describe("leggings panels (bp 256 / 1050)", () => {
  it("offers only left/right side (waistband is part of the leg print file)", () => {
    const front = panelsEligibleForView("front", LEGGINGS_CASUAL_BLUEPRINT_ID, "hoodie");
    const back = panelsEligibleForView("back", LEGGINGS_CASUAL_BLUEPRINT_ID, "hoodie");
    expect(front).toEqual(["left_side", "right_side"]);
    expect(back).toEqual(["left_side", "right_side"]);
    expect(front).not.toContain("front_waistband");
    expect(front).not.toContain("front");
  });

  it("capri matches casual print panels", () => {
    const front = panelsEligibleForView("front", LEGGINGS_CAPRI_BLUEPRINT_ID, "hoodie");
    expect(front).toEqual(["left_side", "right_side"]);
  });

  it("hides leggings keys from hoodie blueprints", () => {
    const zip = panelsEligibleForView("front", ZIP_HOODIE_BLUEPRINT_ID);
    expect(zip).not.toContain("left_side");
    expect(zip).not.toContain("front_waistband");
  });

  it("seeds left-leg/right-leg design groups and heals pillow-style saves", () => {
    const fresh = createFreshAopTemplate({
      name: "leggings-aop-L",
      blueprintId: LEGGINGS_CASUAL_BLUEPRINT_ID,
    });
    expect(fresh.hoodieType).toBe("leggings-aop");
    expect(fresh.placerEditor).toBe("hoodie");
    expect(fresh.designGroups?.map((g) => g.id)).toEqual(["right-leg", "left-leg"]);
    expect(fresh.designGroups?.find((g) => g.id === "right-leg")?.panelKeys).toEqual([
      "right_side",
    ]);
    expect(fresh.designGroups?.find((g) => g.id === "left-leg")?.panelKeys).toEqual([
      "left_side",
    ]);

    const healed = normalizeHoodieTemplate({
      ...fresh,
      placerEditor: "front-back-face",
      designGroups: [
        {
          id: "front-face",
          name: "Front face",
          panelKeys: ["front"],
          placement: {
            front: { scale: 1, offsetX: 0, offsetY: 0 },
            back: { scale: 1, offsetX: 0, offsetY: 0 },
          },
          seamAllowance: 0,
          lockedRatio: null,
          enabled: true,
        },
      ],
    });
    expect(healed.placerEditor).toBe("hoodie");
    expect(healed.designGroups?.map((g) => g.id)).toEqual(["right-leg", "left-leg"]);
    expect(hoodiePanelKeyToPrintifyPosition("left_side")).toBe("left_side");
  });

  it("heals unified legs group into left-leg/right-leg", () => {
    const healed = normalizeHoodieTemplate({
      name: "leggings-unified",
      blueprintId: LEGGINGS_CASUAL_BLUEPRINT_ID,
      designGroups: [
        {
          id: "legs",
          name: "Legs",
          panelKeys: ["left_side", "right_side"],
          placement: {
            front: { scale: 1, offsetX: 0, offsetY: 0 },
            back: { scale: 1, offsetX: 0, offsetY: 0 },
          },
          seamAllowance: 0,
          lockedRatio: null,
          enabled: true,
        },
      ],
    });
    expect(healed.designGroups?.map((g) => g.id)).toEqual(["right-leg", "left-leg"]);
  });
});

describe("pullover hoodie panel keys (bp 450)", () => {
  it("offers full front panel, not zip L/R split", () => {
    const eligible = panelsEligibleForView("front", PULOVER_HOODIE_BLUEPRINT_ID);
    expect(eligible).toContain("front");
    expect(eligible).toContain("front_pocket");
    expect(eligible).not.toContain("front_left");
    expect(eligible).not.toContain("front_right");
    expect(eligible).not.toContain("pocket_left");
    expect(eligible).not.toContain("pocket_right");
  });

  it("zip hoodie hides full front panel", () => {
    const eligible = panelsEligibleForView("front", ZIP_HOODIE_BLUEPRINT_ID);
    expect(eligible).not.toContain("front");
    expect(eligible).toContain("front_left");
    expect(eligible).toContain("front_right");
  });

  it("front-body design group is the front panel plus kangaroo pocket", () => {
    const groups = defaultPulloverDesignGroups();
    const frontBody = groups.find((g) => g.id === "front-body");
    // Pocket rides with front-body (like zip hoodie pocket halves) so toggling
    // Pockets on actually shows artwork — `trim` is always force-disabled.
    expect(frontBody?.panelKeys).toEqual(["front", "front_pocket"]);
    expect(groups.find((g) => g.id === "trim")?.panelKeys).toEqual(["waistband"]);
  });

  it("seeds pullover front-body + hood as independent Printify compose constants", () => {
    const groups = defaultPulloverDesignGroups();
    const front = groups.find((g) => g.id === "front-body")!.placement.front;
    const hood = groups.find((g) => g.id === "hood")!.placement.front;
    const pocketBias = groups.find((g) => g.id === "front-body")!.panelPlacementBias?.pocket;
    expect(front.scale).toBe(PULLOVER_FRONT_BODY_PLACE_SCALE);
    expect(front.offsetX).toBe(PULLOVER_FRONT_BODY_PLACE_OFFSET_X);
    expect(front.offsetY).toBe(PULLOVER_FRONT_BODY_PLACE_OFFSET_Y);
    expect(hood.scale).toBe(PULLOVER_HOOD_PLACE_SCALE);
    expect(hood.offsetY).toBe(PULLOVER_HOOD_PLACE_OFFSET_Y);
    expect(PULLOVER_FRONT_BODY_PLACE_SCALE).toBe(1.210335);
    expect(PULLOVER_HOOD_PLACE_SCALE).toBe(1.203771);
    expect(pocketBias).toEqual({
      offsetXPercent: PULLOVER_POCKET_BIAS_OFFSET_X_PERCENT,
      offsetYPercent: PULLOVER_POCKET_BIAS_OFFSET_Y_PERCENT,
    });
    expect(groups.find((g) => g.id === "back-body")!.placement.front.scale).toBe(1);
    expect(groups.find((g) => g.id === "back-body")!.placement.front.offsetY).toBe(0);
  });

  it("normalizeHoodieTemplate heals stale pullover front/hood framing, not zip", () => {
    const pullover = createFreshAopTemplate({
      name: "pullover-framing-heal",
      blueprintId: PULOVER_HOODIE_BLUEPRINT_ID,
    });
    const staleGroups = pullover.designGroups!.map((g) => {
      if (g.id === "front-body" || g.id === "hood") {
        return {
          ...g,
          placement: {
            front: { scale: 1, offsetX: 0, offsetY: 0, rotationDeg: 0 },
            back: { ...g.placement.back },
          },
        };
      }
      return g;
    });
    const healed = normalizeHoodieTemplate({ ...pullover, designGroups: staleGroups });
    const front = healed.designGroups!.find((g) => g.id === "front-body")!.placement.front;
    const hood = healed.designGroups!.find((g) => g.id === "hood")!.placement.front;
    const back = healed.designGroups!.find((g) => g.id === "back-body")!.placement;
    expect(front.scale).toBe(PULLOVER_FRONT_BODY_PLACE_SCALE);
    expect(front.offsetX).toBe(PULLOVER_FRONT_BODY_PLACE_OFFSET_X);
    expect(front.offsetY).toBe(PULLOVER_FRONT_BODY_PLACE_OFFSET_Y);
    expect(hood.scale).toBe(PULLOVER_HOOD_PLACE_SCALE);
    expect(hood.offsetY).toBe(PULLOVER_HOOD_PLACE_OFFSET_Y);
    expect(
      healed.designGroups!.find((g) => g.id === "front-body")!.panelPlacementBias?.pocket,
    ).toEqual({
      offsetXPercent: PULLOVER_POCKET_BIAS_OFFSET_X_PERCENT,
      offsetYPercent: PULLOVER_POCKET_BIAS_OFFSET_Y_PERCENT,
    });
    expect(back.front.scale).toBe(1);
    expect(back.front.offsetY).toBe(0);
    expect(back.back.scale).toBe(1);

    const zip = createFreshAopTemplate({
      name: "zip-framing-untouched",
      blueprintId: ZIP_HOODIE_BLUEPRINT_ID,
    });
    const zipStale = {
      ...zip,
      designGroups: zip.designGroups!.map((g) => {
        if (g.id === "front-body") {
          return {
            ...g,
            placement: {
              front: { scale: 1.05, offsetX: 0, offsetY: -278.85, rotationDeg: 0 },
              back: { ...g.placement.back },
            },
          };
        }
        if (g.id === "hood") {
          return {
            ...g,
            placement: {
              front: { scale: 1.49, offsetX: 0, offsetY: 59, rotationDeg: 0 },
              back: { ...g.placement.back },
            },
          };
        }
        return g;
      }),
    };
    const zipNorm = normalizeHoodieTemplate(zipStale);
    expect(zipNorm.designGroups!.find((g) => g.id === "front-body")!.placement.front).toEqual(
      zipStale.designGroups!.find((g) => g.id === "front-body")!.placement.front,
    );
    expect(zipNorm.designGroups!.find((g) => g.id === "hood")!.placement.front).toEqual(
      zipStale.designGroups!.find((g) => g.id === "hood")!.placement.front,
    );
  });

  it("heals front offsetX when scale and offsetY already match", () => {
    const pullover = createFreshAopTemplate({
      name: "pullover-offsetx-heal",
      blueprintId: PULOVER_HOODIE_BLUEPRINT_ID,
    });
    const partial = pullover.designGroups!.map((g) => {
      if (g.id === "front-body") {
        return {
          ...g,
          panelPlacementBias: {
            pocket: {
              offsetXPercent: PULLOVER_POCKET_BIAS_OFFSET_X_PERCENT,
              offsetYPercent: PULLOVER_POCKET_BIAS_OFFSET_Y_PERCENT,
            },
          },
          placement: {
            front: {
              scale: PULLOVER_FRONT_BODY_PLACE_SCALE,
              offsetX: 0,
              offsetY: PULLOVER_FRONT_BODY_PLACE_OFFSET_Y,
              rotationDeg: 0,
            },
            back: { ...g.placement.back },
          },
        };
      }
      return g;
    });
    const healed = normalizeHoodieTemplate({ ...pullover, designGroups: partial });
    expect(
      healed.designGroups!.find((g) => g.id === "front-body")!.placement.front.offsetX,
    ).toBe(PULLOVER_FRONT_BODY_PLACE_OFFSET_X);
  });

  it("designGroupsForBlueprint picks pullover defaults for 450", () => {
    const groups = designGroupsForBlueprint(PULOVER_HOODIE_BLUEPRINT_ID);
    expect(groups.find((g) => g.id === "front-body")?.panelKeys).toEqual([
      "front",
      "front_pocket",
    ]);
  });

  it("fills missing pullover front left and right sleeve sourceRects (bp 450)", () => {
    const sleeve = (
      view: "front" | "back",
      panelKey: "left_sleeve" | "right_sleeve",
      sourceRect: { x: number; y: number; width: number; height: number } | null,
    ) => ({
      id: `lyr_${view}_${panelKey}`,
      view,
      panelKey,
      kind: "panel" as const,
      name: panelKey,
      visible: true,
      locked: false,
      zIndex: 1,
      opacity: 1,
      blendMode: "normal" as const,
      maskPath: "",
      cornerPins: null,
      mesh: createDefaultMesh({ x: 0, y: 0, width: 80, height: 200 }, 4, 4, sourceRect),
      transform: { ...IDENTITY_TRANSFORM_2D },
      productionPanelAssignment: null,
      productionPanelSrc: null,
      isExclusion: false,
    });
    const raw = createFreshAopTemplate({
      name: "pullover-sleeve-sr-test",
      blueprintId: PULOVER_HOODIE_BLUEPRINT_ID,
    });
    const stale = {
      ...raw,
      views: {
        front: {
          ...raw.views.front,
          layers: [
            sleeve("front", "left_sleeve", null),
            sleeve("front", "right_sleeve", null),
          ],
        },
        back: {
          ...raw.views.back,
          layers: [
            sleeve("back", "left_sleeve", { ...PULLOVER_SLEEVE_CALIBRATION_SOURCE_RECT }),
            sleeve("back", "right_sleeve", { ...PULLOVER_SLEEVE_CALIBRATION_SOURCE_RECT }),
          ],
        },
      },
    };
    const normalized = normalizeHoodieTemplate(stale);
    const frontRight = normalized.views.front.layers.find((l) => l.panelKey === "right_sleeve");
    const frontLeft = normalized.views.front.layers.find((l) => l.panelKey === "left_sleeve");
    const backRight = normalized.views.back.layers.find((l) => l.panelKey === "right_sleeve");
    const backLeft = normalized.views.back.layers.find((l) => l.panelKey === "left_sleeve");
    expect(frontRight?.mesh?.sourceRect).toEqual(PULLOVER_SLEEVE_CALIBRATION_SOURCE_RECT);
    expect(frontLeft?.mesh?.sourceRect).toEqual(PULLOVER_SLEEVE_CALIBRATION_SOURCE_RECT);
    expect(backRight?.mesh?.sourceRect).toEqual(PULLOVER_SLEEVE_CALIBRATION_SOURCE_RECT);
    expect(backLeft?.mesh?.sourceRect).toEqual(PULLOVER_SLEEVE_CALIBRATION_SOURCE_RECT);
    expect(frontLeft?.mesh?.targetPoints).toEqual(stale.views.front.layers[0].mesh?.targetPoints);
    expect(frontRight?.mesh?.targetPoints).toEqual(stale.views.front.layers[1].mesh?.targetPoints);
    expect(backLeft?.mesh?.targetPoints).toEqual(stale.views.back.layers[0].mesh?.targetPoints);
    expect(backRight?.mesh?.targetPoints).toEqual(stale.views.back.layers[1].mesh?.targetPoints);
  });

  it("does not rewrite zip 451 sleeve sourceRects", () => {
    const raw = createFreshAopTemplate({
      name: "zip-sleeve-sr-test",
      blueprintId: ZIP_HOODIE_BLUEPRINT_ID,
    });
    const withSleeve = {
      ...raw,
      views: {
        ...raw.views,
        front: {
          ...raw.views.front,
          layers: [
            {
              id: "lyr_zip_front_left",
              view: "front" as const,
              panelKey: "left_sleeve" as const,
              kind: "panel" as const,
              name: "left_sleeve",
              visible: true,
              locked: false,
              zIndex: 1,
              opacity: 1,
              blendMode: "normal" as const,
              maskPath: "",
              cornerPins: null,
              mesh: createDefaultMesh({ x: 0, y: 0, width: 80, height: 200 }, 4, 4, null),
              transform: { ...IDENTITY_TRANSFORM_2D },
              productionPanelAssignment: null,
              productionPanelSrc: null,
              isExclusion: false,
            },
            {
              id: "lyr_zip_front_right",
              view: "front" as const,
              panelKey: "right_sleeve" as const,
              kind: "panel" as const,
              name: "right_sleeve",
              visible: true,
              locked: false,
              zIndex: 1,
              opacity: 1,
              blendMode: "normal" as const,
              maskPath: "",
              cornerPins: null,
              mesh: createDefaultMesh({ x: 0, y: 0, width: 80, height: 200 }, 4, 4, null),
              transform: { ...IDENTITY_TRANSFORM_2D },
              productionPanelAssignment: null,
              productionPanelSrc: null,
              isExclusion: false,
            },
          ],
        },
      },
    };
    expect(restorePulloverFrontSleeveSourceRects(withSleeve)).toBe(withSleeve);
    const zipNorm = normalizeHoodieTemplate(withSleeve);
    expect(zipNorm.views.front.layers[0].mesh?.sourceRect).toBeNull();
    expect(zipNorm.views.front.layers[1].mesh?.sourceRect).toBeNull();
  });

  it("normalizeHoodieTemplate migrates stale pullover templates with front_pocket in trim", () => {
    const raw = createFreshAopTemplate({
      name: "pullover-pocket-migration-test",
      blueprintId: PULOVER_HOODIE_BLUEPRINT_ID,
    });
    // Simulate a pre-fix persisted template: pocket still in `trim`.
    const staleGroups = raw.designGroups!.map((g) => {
      if (g.id === "front-body") return { ...g, panelKeys: ["front"] };
      if (g.id === "trim") return { ...g, panelKeys: ["waistband", "front_pocket"] };
      return g;
    });
    const stale = { ...raw, designGroups: staleGroups };
    const normalized = normalizeHoodieTemplate(stale);
    expect(normalized.designGroups?.find((g) => g.id === "front-body")?.panelKeys).toEqual([
      "front",
      "front_pocket",
    ]);
    expect(normalized.designGroups?.find((g) => g.id === "trim")?.panelKeys).toEqual([
      "waistband",
    ]);
  });

  it("migrateFrontPocketOutOfTrimGroup runs without a blueprint id (stale Supabase JSON)", () => {
    const groups = defaultPulloverDesignGroups().map((g) => {
      if (g.id === "front-body") return { ...g, panelKeys: ["front"] as const };
      if (g.id === "trim") return { ...g, panelKeys: ["waistband", "front_pocket"] as const };
      return g;
    });
    const migrated = migrateFrontPocketOutOfTrimGroup(groups);
    expect(migrated.find((g) => g.id === "front-body")?.panelKeys).toContain("front_pocket");
    expect(migrated.find((g) => g.id === "trim")?.panelKeys).not.toContain("front_pocket");
  });

  it("migrateFrontPocketOutOfTrimGroup strips trim duplicate when front-body already has pocket", () => {
    const groups = defaultPulloverDesignGroups().map((g) => {
      if (g.id === "trim") return { ...g, panelKeys: ["waistband", "front_pocket"] as const };
      return g;
    });
    const migrated = migrateFrontPocketOutOfTrimGroup(groups);
    expect(migrated.find((g) => g.id === "front-body")?.panelKeys).toContain("front_pocket");
    expect(migrated.find((g) => g.id === "trim")?.panelKeys).toEqual(["waistband"]);
  });

  it("findGroupForPanel prefers front-body over trim for front_pocket", () => {
    const groups = defaultPulloverDesignGroups().map((g) => {
      if (g.id === "trim") return { ...g, panelKeys: ["waistband", "front_pocket"] as const };
      return g;
    });
    const group = findGroupForPanel(groups, "front_pocket");
    expect(group?.id).toBe("front-body");
  });

  it("mockupDrawRect applies x/y/scale", () => {
    const rect = mockupDrawRect({
      src: "/x.png",
      width: 2048,
      height: 2048,
      x: 10,
      y: 20,
      scale: 0.9,
    });
    expect(rect).toEqual({
      x: 10,
      y: 20,
      scale: 0.9,
      renderWidth: 2048 * 0.9,
      renderHeight: 2048 * 0.9,
    });
  });

  it("drawMockupImageInCanvas uses transformed rect when mockup asset present", () => {
    const asset = {
      src: "/x.png",
      width: 1024,
      height: 1024,
      x: 27,
      y: 19,
      scale: 0.94,
    };
    const calls: { x: number; y: number; w: number; h: number }[] = [];
    const ctx = {
      drawImage: (_img: unknown, x: number, y: number, w: number, h: number) => {
        calls.push({ x, y, w, h });
      },
    } as unknown as CanvasRenderingContext2D;

    drawMockupImageInCanvas(ctx, {} as CanvasImageSource, asset, 1024, 1024);

    expect(calls).toEqual([{ x: 27, y: 19, w: 1024 * 0.94, h: 1024 * 0.94 }]);
  });
});

describe("sweatshirt hoodie panel keys (bp 449)", () => {
  it("offers collar keys and hides hoodie-only panels", () => {
    const front = panelsEligibleForView("front", SWEATSHIRT_BLUEPRINT_ID);
    expect(front).toContain("front");
    expect(front).toContain("collar_front");
    expect(front).toContain("collar_back");
    expect(front).not.toContain("left_hood");
    expect(front).not.toContain("front_left");

    const back = panelsEligibleForView("back", SWEATSHIRT_BLUEPRINT_ID);
    expect(back).toContain("collar_back");
    expect(back).not.toContain("collar_front");
    expect(back).not.toContain("left_hood");
  });

  it("trim group includes cuffs, waistband, and neck rib", () => {
    const groups = defaultSweatshirtDesignGroups();
    expect(groups.find((g) => g.id === "trim")?.panelKeys).toEqual([
      ...SWEATSHIRT_TRIM_PANEL_KEYS,
    ]);
    expect(groups.find((g) => g.id === "left-sleeve")?.panelKeys).toEqual(["left_sleeve"]);
    expect(groups.find((g) => g.id === "right-sleeve")?.panelKeys).toEqual(["right_sleeve"]);
    expect(groups.find((g) => g.id === "collar")).toBeUndefined();
  });

  it("designGroupsForBlueprint picks sweatshirt defaults for 449", () => {
    const groups = designGroupsForBlueprint(SWEATSHIRT_BLUEPRINT_ID);
    expect(groups.find((g) => g.id === "trim")?.panelKeys).toEqual([
      ...SWEATSHIRT_TRIM_PANEL_KEYS,
    ]);
  });

  it("migrateSweatshirtDesignGroups strips hood and merges collar into trim", () => {
    const migrated = migrateSweatshirtDesignGroups([
      ...defaultSweatshirtDesignGroups(),
      {
        id: "hood",
        name: "Hood",
        panelKeys: ["left_hood", "right_hood"],
        placement: { front: { scale: 1, offsetX: 0, offsetY: 0 }, back: { scale: 1, offsetX: 0, offsetY: 0 } },
        seamAllowance: 0,
        lockedRatio: null,
        enabled: true,
      },
      {
        id: "collar",
        name: "Collar",
        panelKeys: ["collar_front", "collar_back"],
        placement: { front: { scale: 1, offsetX: 0, offsetY: 0 }, back: { scale: 1, offsetX: 0, offsetY: 0 } },
        seamAllowance: 0,
        lockedRatio: null,
        enabled: true,
      },
    ]);
    expect(migrated.find((g) => g.id === "hood")).toBeUndefined();
    expect(migrated.find((g) => g.id === "collar")).toBeUndefined();
    expect(migrated.find((g) => g.id === "trim")?.panelKeys).toEqual([
      ...SWEATSHIRT_TRIM_PANEL_KEYS,
    ]);
  });

  it("normalizeHoodieTemplate migrates stale bp 449 templates on load", () => {
    const raw = createFreshAopTemplate({ name: "sweatshirt-aop-L", blueprintId: 449 });
    raw.designGroups = [
      ...raw.designGroups!,
      {
        id: "hood",
        name: "Hood",
        panelKeys: ["left_hood", "right_hood"],
        placement: { front: { scale: 1, offsetX: 0, offsetY: 0 }, back: { scale: 1, offsetX: 0, offsetY: 0 } },
        seamAllowance: 0,
        lockedRatio: null,
        enabled: true,
      },
    ];
    const normalized = normalizeHoodieTemplate(raw);
    expect(normalized.designGroups?.find((g) => g.id === "hood")).toBeUndefined();
    expect(normalized.designGroups?.find((g) => g.id === "trim")?.panelKeys).toEqual([
      ...SWEATSHIRT_TRIM_PANEL_KEYS,
    ]);
  });
});

describe("bomber jacket blueprint", () => {
  it("registers bp 433 — preview may use split fronts; Printify catalog is single front", () => {
    expect(BOMBER_JACKET_BLUEPRINT_ID).toBe(433);
    expect(isBomberJacketBlueprint(433)).toBe(true);
    expect(isBomberJacketBlueprint(451)).toBe(false);
    expect(defaultHoodieTypeForBlueprint(433)).toBe("bomber-jacket-aop");
    expect(BOMBER_FRONT_BODY_ASPECT_X_SCALE).toBe(1);
    expect(BOMBER_FRONT_BODY_PLACEMENT_SCALE).toBe(1.42);
    expect(BOMBER_FRONT_BODY_OFFSET_Y_FRAC).toBe(-0.18);
    expect(BOMBER_FRONT_BODY_PREVIEW_PLACEMENT_SCALE).toBe(1.07);
    expect(BOMBER_FRONT_BODY_PREVIEW_OFFSET_Y_FRAC).toBe(0.045);
    expect(BOMBER_FRONT_BODY_PREVIEW_HEIGHT_SCALE).toBe(0.95);
    expect(BOMBER_BACK_PREVIEW_PLACEMENT_SCALE).toBe(1.144);
    expect(BOMBER_SLEEVES_PREVIEW_PLACEMENT_SCALE).toBe(1.7505);
    expect(BOMBER_PATTERN_FRONT_PRINT_TILE_SCALE).toBe(5.25);
    expect(BOMBER_PATTERN_BACK_PRINT_TILE_SCALE).toBe(0.947625);
    expect(BOMBER_PATTERN_SLEEVES_PRINT_TILE_SCALE).toBe(0.64);
    expect(bomberPatternPrintTileScaleForPanel("front")).toBe(5.25);
    expect(bomberPatternPrintTileScaleForPanel("back")).toBe(0.947625);
    expect(bomberPatternPrintTileScaleForPanel("left_sleeve")).toBe(0.64);
    // Mapper/preview templates still use zip-style L/R meshes; export composites to `front`.
    const eligible = panelsEligibleForView("front", BOMBER_JACKET_BLUEPRINT_ID);
    expect(eligible).not.toContain("front");
    expect(eligible).toContain("front_left");
    expect(eligible).toContain("front_right");
    const groups = designGroupsForBlueprint(BOMBER_JACKET_BLUEPRINT_ID);
    expect(groups.some((g) => g.id === "front-body")).toBe(true);
  });
});

describe("beanie blueprint 576", () => {
  it("is keyed to Printify baby beanie only — preview scale is 1.15", () => {
    expect(BEANIE_BLUEPRINT_ID).toBe(576);
    expect(BEANIE_PREVIEW_PLACEMENT_SCALE).toBe(1.15);
    expect(isBeanieBlueprint(576)).toBe(true);
    expect(isBeanieBlueprint(450)).toBe(false);
    expect(isBeanieBlueprint(241)).toBe(false);
    expect(isBeanieBlueprint(null)).toBe(false);
    expect(flatArtFitForBlueprint(576)).toBe("contain");
    expect(flatArtFitForBlueprint(241)).toBe("contain");
    expect(flatArtFitForBlueprint(759)).toBe("contain");
    expect(flatArtFitForBlueprint(450)).toBe("cover");
  });
});

describe("hoodiePanelKeyToPrintifyPosition", () => {
  it("maps cuff and collar keys to Printify placeholder names", () => {
    expect(hoodiePanelKeyToPrintifyPosition("left_cuff")).toBe("left_cuff_panel");
    expect(hoodiePanelKeyToPrintifyPosition("collar_front")).toBe("Collar");
    expect(hoodiePanelKeyToPrintifyPosition("collar_back")).toBe("Collar");
    expect(hoodiePanelKeyToPrintifyPosition("front")).toBe("front");
  });

  it("forces solid collar fill for sweatshirt / jumper-no-hood", () => {
    expect(SWEATSHIRT_BODY_PREVIEW_PLACEMENT_SCALE).toBe(0.9765);
    expect(
      shouldForceSolidSweatshirtCollar({
        blueprintId: SWEATSHIRT_BLUEPRINT_ID,
        placerEditor: "hoodie",
      }),
    ).toBe(true);
    expect(
      shouldForceSolidSweatshirtCollar({
        blueprintId: ZIP_HOODIE_BLUEPRINT_ID,
        garmentLayout: "jumper-no-hood",
        placerEditor: "hoodie",
      }),
    ).toBe(true);
    expect(
      shouldForceSolidSweatshirtCollar({
        blueprintId: ZIP_HOODIE_BLUEPRINT_ID,
        garmentLayout: "hoodie",
        placerEditor: "hoodie",
      }),
    ).toBe(false);
  });

  it("maps pullover kangaroo front_pocket to Printify pocket", () => {
    expect(hoodiePanelKeyToPrintifyPosition("front_pocket")).toBe("pocket");
  });
});

describe("mesh grid limits", () => {
  it("allows up to 24 columns for wide collar strips", () => {
    expect(MAX_MESH_COLS).toBe(24);
    const mesh = createDefaultMesh({ x: 0, y: 0, width: 100, height: 10 }, 24, 3);
    expect(mesh.cols).toBe(24);
    expect(mesh.rows).toBe(3);
    expect(mesh.targetPoints).toHaveLength(72);
  });
});

describe("front-body panel placement bias", () => {
  it("merges stored and override bias per chest/pocket subset", () => {
    const merged = mergeFrontBodyPanelPlacementBias(
      { chest: { offsetXPercent: 1, offsetYPercent: 2 } },
      { pocket: { offsetXPercent: -3, offsetYPercent: 4 } },
    );
    expect(merged.chest).toEqual({ offsetXPercent: 1, offsetYPercent: 2 });
    expect(merged.pocket).toEqual({ offsetXPercent: -3, offsetYPercent: 4 });
  });

  it("override wins for the same subset field", () => {
    const merged = mergePanelPlacementBiasPercent(
      { offsetXPercent: 1, offsetYPercent: 2 },
      { offsetYPercent: 5 },
    );
    expect(merged).toEqual({ offsetXPercent: 1, offsetYPercent: 5 });
  });

  it("resolves chest vs pocket panel keys from front-body group", () => {
    const group = {
      panelPlacementBias: {
        chest: { offsetXPercent: 0.5, offsetYPercent: 1.5 },
        pocket: { offsetXPercent: -0.5, offsetYPercent: -1.5 },
      },
    };
    expect(resolveFrontBodyPanelBias(group, FRONT_CHEST_PANEL_KEYS[0])).toEqual({
      offsetXPercent: 0.5,
      offsetYPercent: 1.5,
    });
    expect(resolveFrontBodyPanelBias(group, FRONT_POCKET_PANEL_KEYS[1])).toEqual({
      offsetXPercent: -0.5,
      offsetYPercent: -1.5,
    });
    expect(resolveFrontBodyPanelBias(group, "back")).toBeNull();
  });

  it("falls back to zero bias when group has no stored defaults", () => {
    expect(resolveFrontBodyPanelBias({}, "front_left")).toEqual(ZERO_PANEL_PLACEMENT_BIAS);
  });
});
