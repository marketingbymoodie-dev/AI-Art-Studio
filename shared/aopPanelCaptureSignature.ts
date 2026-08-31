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
  });
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
  const storedForCompare =
    !("trimEnabled" in storedRec) && currentRec.trimEnabled !== undefined
      ? { ...storedRec, trimEnabled: currentRec.trimEnabled }
      : storedRec;
  const a = canonicalAopPanelCaptureSignature(storedForCompare);
  const b = canonicalAopPanelCaptureSignature(currentRec);
  return !!a && !!b && a === b;
}
