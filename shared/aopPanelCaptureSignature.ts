/**
 * Canonical AOP print-panel capture signature.
 * Persist and ATC reuse MUST use this — do not compare raw stored JSON
 * against HoodieAopPlacer outputSignature() (different fields / key order).
 *
 * Missing or unparseable input → null (caller must rebuild, never reuse).
 */

const CAPTURE_MODES = new Set(["place", "pattern"]);

export type AopPanelCaptureSource = {
  mode?: unknown;
  artworkUrl?: unknown;
  backgroundColor?: unknown;
  tileSettings?: unknown;
  trimEnabled?: unknown;
  pocketsEnabled?: unknown;
  placements?: unknown;
  enabled?: unknown;
  sleevesMirrored?: unknown;
  legsSynced?: unknown;
  legsMirrored?: unknown;
  wrapBackMode?: unknown;
  pocketSample?: unknown;
};

export function canonicalAopPanelCaptureSignature(
  raw: unknown,
): string | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as AopPanelCaptureSource;
  if (!CAPTURE_MODES.has(String(s.mode || ""))) return null;
  const artworkUrl = typeof s.artworkUrl === "string" ? s.artworkUrl.trim() : "";
  if (!artworkUrl) return null;
  if (s.placements != null && typeof s.placements !== "object") return null;
  if (s.enabled != null && typeof s.enabled !== "object") return null;

  return JSON.stringify({
    mode: s.mode,
    artworkUrl,
    backgroundColor: s.backgroundColor ?? null,
    tileSettings: s.tileSettings ?? null,
    trimEnabled: s.trimEnabled ?? null,
    pocketsEnabled: s.pocketsEnabled ?? null,
    placements: s.placements ?? null,
    enabled: s.enabled ?? null,
    sleevesMirrored: s.sleevesMirrored ?? null,
    legsSynced: s.legsSynced ?? null,
    legsMirrored: s.legsMirrored ?? null,
    wrapBackMode: s.wrapBackMode ?? null,
    pocketSample: s.pocketSample ?? null,
  });
}

/**
 * Short fingerprint of a *canonical* capture string for cart-line / snapshot
 * compare. Same djb2+length form as `hashPanelDataUrl` so theme JS and Node
 * stay in lockstep. Never hash raw placer JSON — canonicalize first.
 */
export function hashAopCaptureSignature(
  canonical: string | null | undefined,
): string | null {
  if (typeof canonical !== "string" || !canonical) return null;
  let h = 5381;
  for (let i = 0; i < canonical.length; i++) {
    h = ((h << 5) + h) ^ canonical.charCodeAt(i);
  }
  return `${canonical.length}:${h >>> 0}`;
}

/** ATC path: live placer state → canonical → hash. */
export function expectedAopCaptureHashFromLiveState(liveState: unknown): string | null {
  return hashAopCaptureSignature(canonicalAopPanelCaptureSignature(liveState));
}

/** Server path: stored persist signature → parse/canonicalize → hash. */
export function storedAopCaptureHash(storedSignature: unknown): string | null {
  return hashAopCaptureSignature(parseStoredAopPanelCaptureSignature(storedSignature));
}

export type AopSnapshotFreezeDecision =
  | { ok: true }
  | {
      ok: false;
      status: 409;
      code: "EXPECTED_CAPTURE_REQUIRED" | "CAPTURE_MISMATCH";
    };

/**
 * Authoritative freeze gate. Missing expected hash, unparseable job
 * signature, or hash mismatch → 409 (do not freeze stale panels).
 */
export function evaluateAopSnapshotFreeze(opts: {
  expectedCaptureHash?: unknown;
  storedSignature?: unknown;
}): AopSnapshotFreezeDecision {
  const expected =
    typeof opts.expectedCaptureHash === "string" ? opts.expectedCaptureHash.trim() : "";
  if (!expected) {
    return { ok: false, status: 409, code: "EXPECTED_CAPTURE_REQUIRED" };
  }
  const jobHash = storedAopCaptureHash(opts.storedSignature);
  if (!jobHash || jobHash !== expected) {
    return { ok: false, status: 409, code: "CAPTURE_MISMATCH" };
  }
  return { ok: true };
}

/** Re-canonicalize a stored string or object. Unparseable → null. */
export function parseStoredAopPanelCaptureSignature(
  raw: unknown,
): string | null {
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    try {
      return canonicalAopPanelCaptureSignature(JSON.parse(trimmed));
    } catch {
      return null;
    }
  }
  return canonicalAopPanelCaptureSignature(raw);
}

/**
 * ATC reuse: skip panel rebuild only on a definite signature match.
 *
 * After Saved-Design load the AOP fallback remounts HoodieAopPlacer, which
 * template-merges `enabled` / placements and overwrites parent live state.
 * Comparing stored vs that seeded live state falsely misses. If the customer
 * has not edited since resume/apply, match stored against the last persisted
 * capture state instead. Pending edits, missing panels, or unparseable /
 * legacy signatures always rebuild.
 */
export function aopCanReuseStoredPanels(opts: {
  storedSignature: unknown;
  liveState: unknown;
  lastPersistedState: unknown;
  hasRestoredPanels: boolean;
  hasPendingChanges: boolean;
}): boolean {
  if (!opts.hasRestoredPanels) return false;
  if (!parseStoredAopPanelCaptureSignature(opts.storedSignature)) return false;
  if (aopPanelCaptureSignaturesMatch(opts.storedSignature, opts.liveState)) {
    return true;
  }
  if (opts.hasPendingChanges) return false;
  return aopPanelCaptureSignaturesMatch(
    opts.storedSignature,
    opts.lastPersistedState,
  );
}

export function aopPanelCaptureSignaturesMatch(
  stored: unknown,
  current: unknown,
): boolean {
  let storedObj: unknown = stored;
  if (typeof stored === "string") {
    const trimmed = stored.trim();
    if (!trimmed) return false;
    try {
      storedObj = JSON.parse(trimmed);
    } catch {
      return false;
    }
  }
  if (!storedObj || typeof storedObj !== "object") return false;
  const storedRec = storedObj as AopPanelCaptureSource;
  const currentRec =
    current && typeof current === "object" ? (current as AopPanelCaptureSource) : null;
  if (!currentRec) return false;
  // Legacy persist omitted trimEnabled. Fill from live so unchanged saved
  // hoodies can reuse; once we persist the new form, trim edits rebuild.
  let storedForCompare: AopPanelCaptureSource = storedRec;
  // Legacy persist omitted trimEnabled / pocketSample. Fill from live so
  // unchanged saved hoodies can reuse; once we persist the new form, edits rebuild.
  if (!("trimEnabled" in storedRec) && currentRec.trimEnabled !== undefined) {
    storedForCompare = { ...storedForCompare, trimEnabled: currentRec.trimEnabled };
  }
  if (!("pocketSample" in storedRec) && currentRec.pocketSample !== undefined) {
    storedForCompare = { ...storedForCompare, pocketSample: currentRec.pocketSample };
  }
  const a = canonicalAopPanelCaptureSignature(storedForCompare);
  const b = canonicalAopPanelCaptureSignature(currentRec);
  return !!a && !!b && a === b;
}
