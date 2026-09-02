import { describe, expect, it } from "vitest";
import {
  aopCanReuseStoredPanels,
  aopPanelCaptureSignaturesMatch,
  canonicalAopPanelCaptureSignature,
  parseStoredAopPanelCaptureSignature,
} from "./aopPanelCaptureSignature";

const baseState = {
  mode: "place" as const,
  artworkUrl: "https://cdn.example/art.png",
  backgroundColor: "#111111",
  tileSettings: { tileInches: 4 },
  trimEnabled: true,
  pocketsEnabled: false,
  placements: { "front-body": { front: { x: 0.1, y: 0.2 } } },
  enabled: { "front-body": true, "back-body": true },
  sleevesMirrored: true,
  legsSynced: true,
  legsMirrored: false,
  wrapBackMode: "wrap",
};

describe("canonicalAopPanelCaptureSignature", () => {
  it("returns null for missing / unparseable input", () => {
    expect(canonicalAopPanelCaptureSignature(null)).toBeNull();
    expect(canonicalAopPanelCaptureSignature({})).toBeNull();
    expect(canonicalAopPanelCaptureSignature({ mode: "place" })).toBeNull();
    expect(parseStoredAopPanelCaptureSignature("not-json")).toBeNull();
    expect(parseStoredAopPanelCaptureSignature("")).toBeNull();
  });

  it("matches persist-then-compare through the same serializer", () => {
    const persisted = canonicalAopPanelCaptureSignature(baseState);
    expect(persisted).toBeTruthy();
    expect(parseStoredAopPanelCaptureSignature(persisted)).toBe(persisted);
    expect(aopPanelCaptureSignaturesMatch(persisted, baseState)).toBe(true);
  });

  it("re-canonicalizes legacy persist JSON (different key order, no trimEnabled)", () => {
    const legacy = JSON.stringify({
      mode: baseState.mode,
      artworkUrl: baseState.artworkUrl,
      backgroundColor: baseState.backgroundColor,
      tileSettings: baseState.tileSettings,
      pocketsEnabled: baseState.pocketsEnabled,
      placements: baseState.placements,
      enabled: baseState.enabled,
      sleevesMirrored: baseState.sleevesMirrored,
      legsSynced: baseState.legsSynced,
      legsMirrored: baseState.legsMirrored,
      wrapBackMode: baseState.wrapBackMode,
    });
    expect(aopPanelCaptureSignaturesMatch(legacy, baseState)).toBe(true);
  });

  it("does not match when placement changed", () => {
    const persisted = canonicalAopPanelCaptureSignature(baseState);
    const moved = {
      ...baseState,
      placements: { "front-body": { front: { x: 0.5, y: 0.5 } } },
    };
    expect(aopPanelCaptureSignaturesMatch(persisted, moved)).toBe(false);
  });
});

describe("aopCanReuseStoredPanels", () => {
  const persisted = canonicalAopPanelCaptureSignature(baseState);

  it("reuses when live still matches persist (same-session Apply → ATC)", () => {
    expect(
      aopCanReuseStoredPanels({
        storedSignature: persisted,
        liveState: baseState,
        lastPersistedState: baseState,
        hasRestoredPanels: true,
        hasPendingChanges: false,
      }),
    ).toBe(true);
  });

  it("reuses after remount seed-fill when the customer has not edited", () => {
    const seededLive = {
      ...baseState,
      enabled: {
        ...baseState.enabled,
        trim: false,
        "left-sleeve": false,
        "right-sleeve": false,
      },
      trimEnabled: false,
    };
    expect(aopPanelCaptureSignaturesMatch(persisted, seededLive)).toBe(false);
    expect(
      aopCanReuseStoredPanels({
        storedSignature: persisted,
        liveState: seededLive,
        lastPersistedState: baseState,
        hasRestoredPanels: true,
        hasPendingChanges: false,
      }),
    ).toBe(true);
  });

  it("rebuilds when the customer edited since load/apply", () => {
    const moved = {
      ...baseState,
      placements: { "front-body": { front: { x: 0.5, y: 0.5 } } },
    };
    expect(
      aopCanReuseStoredPanels({
        storedSignature: persisted,
        liveState: moved,
        lastPersistedState: baseState,
        hasRestoredPanels: true,
        hasPendingChanges: true,
      }),
    ).toBe(false);
  });

  it("rebuilds when panels or signature are missing / unparseable", () => {
    expect(
      aopCanReuseStoredPanels({
        storedSignature: persisted,
        liveState: baseState,
        lastPersistedState: baseState,
        hasRestoredPanels: false,
        hasPendingChanges: false,
      }),
    ).toBe(false);
    expect(
      aopCanReuseStoredPanels({
        storedSignature: "not-json",
        liveState: baseState,
        lastPersistedState: baseState,
        hasRestoredPanels: true,
        hasPendingChanges: false,
      }),
    ).toBe(false);
  });
});
