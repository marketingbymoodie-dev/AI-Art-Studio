import { describe, expect, it } from "vitest";
import { getDefaultPanelRenderConfig } from "./PatternCustomizer";

describe("getDefaultPanelRenderConfig", () => {
  it("defaults hoodie front panels to artwork enabled", () => {
    const cfg = getDefaultPanelRenderConfig("front_left", "hoodie", "hoodie_v1");
    expect(cfg.enabled).toBe(true);
    expect(cfg.mode).toBe("artwork");
  });

  it("defaults hoodie back panels to artwork off", () => {
    const back = getDefaultPanelRenderConfig("back", "hoodie", "hoodie_v1");
    expect(back.enabled).toBe(false);
    expect(back.mode).toBe("solid");
  });

  it("defaults hoodie hood panels to artwork on", () => {
    // Hood prints by default so the customer gets the reveal; it stays movable
    // and can be switched off per panel.
    const hood = getDefaultPanelRenderConfig("left_hood", "hoodie", "hoodie_v1");
    expect(hood.enabled).toBe(true);
    expect(hood.mode).toBe("artwork");
  });

  it("defaults hoodie supporting panels to background color", () => {
    const cfg = getDefaultPanelRenderConfig("right_cuff_panel", "hoodie", "hoodie_v1");
    expect(cfg.enabled).toBe(false);
    expect(cfg.mode).toBe("solid");
  });

  it("defaults hoodie sleeves to background color", () => {
    const cfg = getDefaultPanelRenderConfig("right_sleeve", "hoodie", "hoodie_v1");
    expect(cfg.enabled).toBe(false);
    expect(cfg.mode).toBe("solid");
  });
});

