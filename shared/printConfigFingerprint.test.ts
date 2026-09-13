import { describe, expect, it } from "vitest";
import {
  PRINT_CONFIG_INPUT_MAX_JSON_BYTES,
  atcShadowDesignId,
  printConfigFingerprint,
  sanitizePrintConfigInput,
} from "./printConfigFingerprint";

const art = "https://cdn.example/art.png?token=1";

describe("printConfigFingerprint", () => {
  it("ignores artwork URL query strings", () => {
    const a = printConfigFingerprint({ artworkUrl: "https://cdn.example/art.png?a=1" });
    const b = printConfigFingerprint({ artworkUrl: "https://cdn.example/art.png?b=2" });
    expect(a).toBe(b);
  });

  it("treats different backgrounds as distinct", () => {
    const base = {
      artworkUrl: art,
      flat: {
        placements: { front: { scale: 1, offsetX: 0, offsetY: 0 } },
        enabled: { front: true, back: false },
      },
    };
    const a = printConfigFingerprint({
      ...base,
      flat: { ...base.flat, backgroundColor: "#FF0000" },
    });
    const b = printConfigFingerprint({
      ...base,
      flat: { ...base.flat, backgroundColor: "#00FF00" },
    });
    expect(a).not.toBe(b);
  });

  it("treats front-only vs both print sides as distinct", () => {
    const a = printConfigFingerprint({
      artworkUrl: art,
      flat: {
        placements: { front: { scale: 1, offsetX: 0, offsetY: 0 } },
        enabled: { front: true, back: false },
      },
    });
    const b = printConfigFingerprint({
      artworkUrl: art,
      flat: {
        placements: { front: { scale: 1, offsetX: 0, offsetY: 0 } },
        enabled: { front: true, back: true },
      },
    });
    expect(a).not.toBe(b);
  });

  it("hashes independent front vs back scale (BP 66/77 hoodie)", () => {
    const frontBig = printConfigFingerprint({
      artworkUrl: art,
      flat: {
        placements: {
          front: { scale: 1.4, offsetX: 0, offsetY: 0 },
          back: { scale: 0.8, offsetX: 0, offsetY: 0 },
        },
        enabled: { front: true, back: true },
      },
    });
    const backBig = printConfigFingerprint({
      artworkUrl: art,
      flat: {
        placements: {
          front: { scale: 0.8, offsetX: 0, offsetY: 0 },
          back: { scale: 1.4, offsetX: 0, offsetY: 0 },
        },
        enabled: { front: true, back: true },
      },
    });
    expect(frontBig).not.toBe(backBig);
  });

  it("hashes AOP front vs back placements independently", () => {
    const a = printConfigFingerprint({
      artworkUrl: art,
      aopHoodie: {
        placements: {
          "front-body": {
            front: { scale: 1.1, offsetX: 0, offsetY: 0 },
            back: { scale: 1, offsetX: 0, offsetY: 0 },
          },
        },
        enabled: { "front-body": true, back: true },
        backgroundColor: "#FFFFFF",
      },
    });
    const b = printConfigFingerprint({
      artworkUrl: art,
      aopHoodie: {
        placements: {
          "front-body": {
            front: { scale: 1.1, offsetX: 0, offsetY: 0 },
            back: { scale: 1.35, offsetX: 0.1, offsetY: 0 },
          },
        },
        enabled: { "front-body": true, back: true },
        backgroundColor: "#FFFFFF",
      },
    });
    expect(a).not.toBe(b);
  });

  it("ignores AOP UI-only fields (active view / group)", () => {
    const a = printConfigFingerprint({
      artworkUrl: art,
      aopHoodie: {
        view: "front",
        activeGroupId: "front-body",
        backgroundColor: "#111111",
        pocketsEnabled: true,
      },
    });
    const b = printConfigFingerprint({
      artworkUrl: art,
      aopHoodie: {
        view: "back",
        activeGroupId: "hood",
        backgroundColor: "#111111",
        pocketsEnabled: true,
      },
    });
    expect(a).toBe(b);
  });

  it("treats AOP pocket / background changes as distinct", () => {
    const a = printConfigFingerprint({
      artworkUrl: art,
      aopHoodie: { pocketsEnabled: true, backgroundColor: "#FFFFFF" },
    });
    const b = printConfigFingerprint({
      artworkUrl: art,
      aopHoodie: { pocketsEnabled: false, backgroundColor: "#FFFFFF" },
    });
    const c = printConfigFingerprint({
      artworkUrl: art,
      aopHoodie: { pocketsEnabled: true, backgroundColor: "#000000" },
    });
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });

  it("treats tote printBack as distinct", () => {
    const a = printConfigFingerprint({
      artworkUrl: art,
      tote: { scale: 100, x: 50, y: 50, printBack: true },
    });
    const b = printConfigFingerprint({
      artworkUrl: art,
      tote: { scale: 100, x: 50, y: 50, printBack: false },
    });
    expect(a).not.toBe(b);
  });

  it("is stable for the same snapshot", () => {
    const input = {
      artworkUrl: art,
      flat: {
        placements: { front: { scale: 0.9, offsetX: 0.1, offsetY: -0.2 } },
        enabled: { front: true, back: false },
        backgroundColor: "#ABCDEF",
      },
    };
    expect(printConfigFingerprint(input)).toBe(printConfigFingerprint(input));
  });
});

describe("sanitizePrintConfigInput (Apply pre-mint must hash like ATC)", () => {
  const liveFlat = {
    view: "front",
    artworkUrl: art,
    placements: {
      front: { scale: 1.2, offsetX: 0.05, offsetY: -0.1, rotationDeg: 0 },
      back: { scale: 0.9, offsetX: 0, offsetY: 0, rotationDeg: 0 },
    },
    enabled: { front: true, back: true },
    backgroundColor: "#FF0000",
    someUiOnlyFlag: true,
  };
  const liveHoodie = {
    view: "back",
    activeGroupId: "hood",
    placements: { "front-body": { front: { scale: 1.1, offsetX: 0, offsetY: 0 } } },
    enabled: { "front-body": true },
    backgroundColor: "#111111",
    pocketsEnabled: true,
  };

  it("hashes identically to the raw client object for flat + tote + AOP", () => {
    const raw = {
      artworkUrl: art,
      flat: liveFlat,
      tote: { scale: 100, x: 50, y: 50, printBack: true },
      aopHoodie: liveHoodie,
      aopPattern: { tileInches: 4, patternType: "grid", uiOpen: true },
    };
    const clean = sanitizePrintConfigInput(raw);
    expect(clean).not.toBeNull();
    expect(printConfigFingerprint(clean!)).toBe(printConfigFingerprint(raw));
    expect(atcShadowDesignId("job1", 123, clean!)).toBe(atcShadowDesignId("job1", 123, raw));
  });

  it("mirrors encoder coercion (numeric strings, null, non-boolean enabled)", () => {
    const raw = {
      artworkUrl: art,
      flat: {
        placements: { front: { scale: "1.3", offsetX: null, offsetY: 0.2 }, back: { scale: 0.7 } },
        enabled: { front: 1, back: "yes" },
        backgroundColor: "#00FF00",
      },
      tote: { scale: "120", x: 40, y: null, printBack: 1 },
    };
    const clean = sanitizePrintConfigInput(raw)!;
    expect(printConfigFingerprint(clean)).toBe(printConfigFingerprint(raw as any));
  });

  it("hashes identically when only artwork is set (poster / tee)", () => {
    const raw = { artworkUrl: art, flat: null, tote: null, aopHoodie: null, aopPattern: null };
    const clean = sanitizePrintConfigInput(raw)!;
    expect(printConfigFingerprint(clean)).toBe(printConfigFingerprint(raw));
  });

  it("drops unknown keys and non-object payloads", () => {
    const clean = sanitizePrintConfigInput({
      artworkUrl: art,
      flat: liveFlat,
      evil: { a: 1 },
    }) as Record<string, unknown>;
    expect(clean.evil).toBeUndefined();
    expect((clean.flat as Record<string, unknown>).someUiOnlyFlag).toBeUndefined();
    expect((clean.flat as Record<string, unknown>).view).toBeUndefined();
    expect(sanitizePrintConfigInput("nope")).toBeNull();
    expect(sanitizePrintConfigInput(null)).toBeNull();
    expect(sanitizePrintConfigInput([1, 2])).toBeNull();
  });

  it("rejects oversize payloads", () => {
    const big = {
      artworkUrl: art,
      aopHoodie: { tileSettings: { pad: "x".repeat(PRINT_CONFIG_INPUT_MAX_JSON_BYTES) } },
    };
    expect(sanitizePrintConfigInput(big)).toBeNull();
  });
});
