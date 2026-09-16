import { describe, expect, it } from "vitest";
import {
  aopCanReuseStoredPanels,
  aopPanelCaptureSignaturesMatch,
  canonicalAopPanelCaptureSignature,
  evaluateAopSnapshotFreeze,
  expectedAopCaptureHashFromLiveState,
  hashAopCaptureSignature,
  parseStoredAopPanelCaptureSignature,
  storedAopCaptureHash,
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

  it("does not match when pocketSample changed", () => {
    const withPocket = {
      ...baseState,
      pocketSample: { offsetX: 0, offsetY: 0, scale: 1 },
    };
    const persisted = canonicalAopPanelCaptureSignature(withPocket);
    expect(
      aopPanelCaptureSignaturesMatch(persisted, {
        ...withPocket,
        pocketSample: { offsetX: 4, offsetY: -2, scale: 1.1 },
      }),
    ).toBe(false);
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

/** Realistic HoodieAopPlacer live state — extra UI keys persist strips. */
const pulloverPlacerState = {
  mode: "place" as const,
  artworkUrl: "https://cdn.example.com/objects/gen_abc123/artwork.png?token=xyz",
  backgroundColor: "#1b2a41",
  tileSettings: { tileInches: 3.2, offsetX: 0.12, offsetY: -0.08 },
  trimEnabled: true,
  pocketsEnabled: true,
  placements: {
    hood: { front: { x: 0.02, y: -0.04, scale: 1.05, rotationDeg: 0 } },
    "front-body": { front: { x: 0.11, y: 0.18, scale: 1, rotationDeg: 0 } },
    "back-body": { back: { x: 0, y: 0.05, scale: 1, rotationDeg: 0 } },
    "left-sleeve": { front: { x: -0.2, y: 0.1, scale: 1, rotationDeg: 8 } },
    "right-sleeve": { front: { x: 0.2, y: 0.1, scale: 1, rotationDeg: -8 } },
  },
  enabled: {
    hood: true,
    "front-body": true,
    "back-body": true,
    "left-sleeve": true,
    "right-sleeve": true,
    trim: false,
  },
  sleevesMirrored: true,
  legsSynced: true,
  legsMirrored: false,
  wrapBackMode: "wrap",
  pocketSample: { offsetX: 0, offsetY: 2, scale: 1 },
  // UI-only — must not change the hash vs persist's canonical write
  modeBarOpen: true,
  lastSheet: "adjust",
};

describe("hashAopCaptureSignature round-trip (ATC vs persist-then-server)", () => {
  it("live ATC hash equals stored-signature-then-parsed server hash", () => {
    const atcHash = expectedAopCaptureHashFromLiveState(pulloverPlacerState);
    expect(atcHash).toMatch(/^\d+:\d+$/);

    // Persist writes the canonical JSON string onto the job.
    const persisted = canonicalAopPanelCaptureSignature(pulloverPlacerState);
    expect(persisted).toBeTruthy();
    const serverHash = storedAopCaptureHash(persisted);
    expect(serverHash).toBe(atcHash);

    // Re-parse as the snapshot route does (string in designState).
    const reparsed = parseStoredAopPanelCaptureSignature(persisted);
    expect(hashAopCaptureSignature(reparsed)).toBe(atcHash);

    // Shuffled key order in the stored JSON must not 409 a correct capture.
    const shuffled = JSON.stringify({
      pocketSample: pulloverPlacerState.pocketSample,
      wrapBackMode: pulloverPlacerState.wrapBackMode,
      legsMirrored: pulloverPlacerState.legsMirrored,
      legsSynced: pulloverPlacerState.legsSynced,
      sleevesMirrored: pulloverPlacerState.sleevesMirrored,
      enabled: pulloverPlacerState.enabled,
      placements: pulloverPlacerState.placements,
      pocketsEnabled: pulloverPlacerState.pocketsEnabled,
      trimEnabled: pulloverPlacerState.trimEnabled,
      tileSettings: pulloverPlacerState.tileSettings,
      backgroundColor: pulloverPlacerState.backgroundColor,
      artworkUrl: pulloverPlacerState.artworkUrl,
      mode: pulloverPlacerState.mode,
    });
    expect(storedAopCaptureHash(shuffled)).toBe(atcHash);
    expect(
      evaluateAopSnapshotFreeze({
        expectedCaptureHash: atcHash,
        storedSignature: shuffled,
      }),
    ).toEqual({ ok: true });
  });
});

describe("evaluateAopSnapshotFreeze fail-safe", () => {
  const liveHash = expectedAopCaptureHashFromLiveState(pulloverPlacerState);
  const stored = canonicalAopPanelCaptureSignature(pulloverPlacerState);

  it("409 EXPECTED_CAPTURE_REQUIRED when hash is missing, empty, or not a string", () => {
    expect(evaluateAopSnapshotFreeze({ storedSignature: stored })).toEqual({
      ok: false,
      status: 409,
      code: "EXPECTED_CAPTURE_REQUIRED",
    });
    expect(
      evaluateAopSnapshotFreeze({ expectedCaptureHash: "", storedSignature: stored }),
    ).toEqual({ ok: false, status: 409, code: "EXPECTED_CAPTURE_REQUIRED" });
    expect(
      evaluateAopSnapshotFreeze({ expectedCaptureHash: "   ", storedSignature: stored }),
    ).toEqual({ ok: false, status: 409, code: "EXPECTED_CAPTURE_REQUIRED" });
    expect(
      evaluateAopSnapshotFreeze({ expectedCaptureHash: null, storedSignature: stored }),
    ).toEqual({ ok: false, status: 409, code: "EXPECTED_CAPTURE_REQUIRED" });
  });

  it("409 CAPTURE_MISMATCH for previous persist, empty job signature, or unparseable", () => {
    const previous = canonicalAopPanelCaptureSignature({
      ...pulloverPlacerState,
      placements: {
        ...pulloverPlacerState.placements,
        "front-body": { front: { x: 0.9, y: 0.9, scale: 1, rotationDeg: 0 } },
      },
    });
    expect(
      evaluateAopSnapshotFreeze({
        expectedCaptureHash: liveHash,
        storedSignature: previous,
      }),
    ).toEqual({ ok: false, status: 409, code: "CAPTURE_MISMATCH" });
    expect(
      evaluateAopSnapshotFreeze({
        expectedCaptureHash: liveHash,
        storedSignature: null,
      }),
    ).toEqual({ ok: false, status: 409, code: "CAPTURE_MISMATCH" });
    expect(
      evaluateAopSnapshotFreeze({
        expectedCaptureHash: liveHash,
        storedSignature: "",
      }),
    ).toEqual({ ok: false, status: 409, code: "CAPTURE_MISMATCH" });
    expect(
      evaluateAopSnapshotFreeze({
        expectedCaptureHash: liveHash,
        storedSignature: "not-json",
      }),
    ).toEqual({ ok: false, status: 409, code: "CAPTURE_MISMATCH" });
  });

  it("does not treat hashAopCaptureSignature(null) as a freezeable expected hash", () => {
    expect(hashAopCaptureSignature(null)).toBeNull();
    expect(hashAopCaptureSignature("")).toBeNull();
    expect(expectedAopCaptureHashFromLiveState({})).toBeNull();
  });
});
