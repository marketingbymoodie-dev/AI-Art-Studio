import type { FlatCalibrationManifest } from "@/pages/embed-design";
import { swapDecorSizeDimensionId } from "@shared/productVariantOptions";
import { normalizePrintifyColorKey, slugPrintifyColorId } from "@shared/printifyColorSlug";

function normalizeFlatColorKey(id: string): string {
  return normalizePrintifyColorKey(id);
}

function colorKeyAliases(id: string, name?: string): string[] {
  const out = new Set<string>();
  const add = (value?: string) => {
    const v = String(value || "").trim();
    if (!v) return;
    out.add(v);
    out.add(normalizePrintifyColorKey(v));
    out.add(slugPrintifyColorId(v));
    out.add(normalizePrintifyColorKey(slugPrintifyColorId(v)));
    const noSolid = v.replace(/^solid\s+/i, "").trim();
    if (noSolid && noSolid.toLowerCase() !== v.toLowerCase()) {
      out.add(noSolid);
      out.add(normalizePrintifyColorKey(noSolid));
      out.add(slugPrintifyColorId(noSolid));
    }
  };
  add(id);
  add(name);
  return [...out].filter(Boolean);
}

function blankColorSegment(key: string): string {
  const colon = key.lastIndexOf(":");
  return colon >= 0 ? key.slice(colon + 1) : key;
}

function blankKeyMatches(manifest: FlatCalibrationManifest, key: string): boolean {
  const entry = manifest.blanks?.[key];
  return !!(entry?.front || entry?.back);
}

function findBlankKey(manifest: FlatCalibrationManifest, id: string, name?: string): string | null {
  if (!id && !name) return null;
  if (id && blankKeyMatches(manifest, id)) return id;
  const aliases = new Set(colorKeyAliases(id, name).map((a) => normalizeFlatColorKey(a)));
  for (const k of Object.keys(manifest.blanks || {})) {
    if (!blankKeyMatches(manifest, k)) continue;
    const kn = normalizeFlatColorKey(k);
    const seg = normalizeFlatColorKey(blankColorSegment(k));
    if (aliases.has(kn) || aliases.has(seg)) return k;
  }
  return null;
}

/** Prefer `default`, else first blank with front/back URLs. */
export function firstUsableBlankKey(manifest: FlatCalibrationManifest): string | null {
  if (blankKeyMatches(manifest, "default")) return "default";
  for (const k of Object.keys(manifest.blanks || {})) {
    if (blankKeyMatches(manifest, k)) return k;
  }
  return null;
}

/** True when harvest has distinct colour/model blanks (not a single default-only manifest). */
export function manifestHasMultipleColorBlanks(manifest: FlatCalibrationManifest): boolean {
  const keys = Object.keys(manifest.blanks || {}).filter((k) => blankKeyMatches(manifest, k));
  if (keys.length <= 1) return false;
  if (keys.length === 1 && keys[0] === "default") return false;
  return true;
}

const APPAREL_SIZE_SEGMENTS = new Set([
  "xxs",
  "xs",
  "s",
  "m",
  "l",
  "xl",
  "2xl",
  "3xl",
  "4xl",
  "5xl",
  "xxl",
  "xxxl",
]);

/** Left side of `size:color` looks like apparel (S/M/L), not decor inches (16x20). */
function isApparelSizeSegment(seg: string): boolean {
  const raw = seg.toLowerCase().trim();
  if (!raw) return false;
  // Dimensional inch tokens: 16x20, 11x8, 16''×20'', etc.
  if (/\d+\s*[x×]\s*\d+/i.test(raw)) return false;
  const compact = raw.replace(/[^a-z0-9]/g, "");
  return APPAREL_SIZE_SEGMENTS.has(compact);
}

/**
 * True when every blank key is `{apparelSize}:{color}` (legacy mis-harvested sweaters).
 * Must NOT treat framed-poster `16x20:white` keys as apparel — that skips size:color
 * candidates and breaks frame-colour swaps.
 */
export function blanksLookLikeApparelSizeColor(manifest: FlatCalibrationManifest): boolean {
  const keys = Object.keys(manifest.blanks || {}).filter((k) => blankKeyMatches(manifest, k));
  if (keys.length === 0) return false;
  return keys.every((k) => {
    const colon = k.indexOf(":");
    if (colon <= 0 || colon !== k.lastIndexOf(":")) return false;
    const sizeSeg = k.slice(0, colon);
    const colorSeg = k.slice(colon + 1);
    if (!colorSeg || !/^[a-z0-9_]+$/i.test(colorSeg)) return false;
    return isApparelSizeSegment(sizeSeg);
  });
}

/** Match harvested blank keys by frame colour when size×colour keys omit the current size. */
function findBlankKeyForColor(
  manifest: FlatCalibrationManifest,
  frameColorId: string,
  frameColorName?: string,
): string | null {
  return findBlankKey(manifest, frameColorId, frameColorName);
}

/**
 * Resolve which harvested blank set to use for the current size / frame colour.
 *
 * Order matters: for decorPerSize manifests (`16x20:white` keys) we must try
 * combined keys before bare frame colour (`white`), otherwise every size falls
 * back to the same single-colour blank.
 */
export function resolveFlatBlankColorId(
  manifest: FlatCalibrationManifest,
  opts: { sizeId?: string; frameColorId?: string; frameColorName?: string; isApparel?: boolean },
): string {
  const apparelColorOnly =
    !!opts.isApparel ||
    (manifest.decorPerSize && blanksLookLikeApparelSizeColor(manifest));
  const candidates: string[] = [];

  if (!apparelColorOnly && opts.sizeId && opts.frameColorId) {
    candidates.push(`${opts.sizeId}:${opts.frameColorId}`, `${opts.frameColorId}:${opts.sizeId}`);
    // HFP landscape sizes often need the swapped portrait harvest key (18x24 for 24x18).
    const swappedSize = swapDecorSizeDimensionId(opts.sizeId);
    if (swappedSize) {
      candidates.push(
        `${swappedSize}:${opts.frameColorId}`,
        `${opts.frameColorId}:${swappedSize}`,
      );
    }
  }
  if (!apparelColorOnly && opts.sizeId) {
    candidates.push(opts.sizeId);
    const swappedSize = swapDecorSizeDimensionId(opts.sizeId);
    if (swappedSize) candidates.push(swappedSize);
  }
  if (opts.frameColorId) candidates.push(opts.frameColorId);
  if (opts.frameColorName) candidates.push(opts.frameColorName);

  for (const id of candidates) {
    const hit = findBlankKey(manifest, id, opts.frameColorName);
    if (hit) return hit;
  }

  // Apparel + legacy size×colour harvest: garment colour is size-independent.
  if ((manifest.decorPerSize || apparelColorOnly || opts.frameColorId) && opts.frameColorId) {
    const colorHit = findBlankKeyForColor(manifest, opts.frameColorId, opts.frameColorName);
    if (colorHit) return colorHit;
    const direct = findBlankKey(manifest, opts.frameColorId, opts.frameColorName);
    if (direct) return direct;
    // Never swap in a different colour's blank. A single harvest blank is only
    // reused when it actually matches this colour (Navy ≠ first brown PNG).
    if (manifestHasMultipleColorBlanks(manifest)) return opts.frameColorId;
    const singleBlank = firstUsableBlankKey(manifest);
    if (singleBlank && findBlankKey(manifest, opts.frameColorId, opts.frameColorName) === singleBlank) {
      return singleBlank;
    }
    return opts.frameColorId;
  }

  if (manifest.edgeWrap && opts.sizeId) {
    const sizeNorm = normalizeFlatColorKey(opts.sizeId);
    for (const k of Object.keys(manifest.blanks || {})) {
      if (!blankKeyMatches(manifest, k)) continue;
      if (normalizeFlatColorKey(k) === sizeNorm) return k;
    }
  }

  const fallback =
    opts.sizeId && opts.frameColorId
      ? `${opts.sizeId}:${opts.frameColorId}`
      : opts.frameColorId || opts.sizeId || "";
  const resolved = findBlankKey(manifest, fallback, opts.frameColorName);
  if (resolved) return resolved;

  // Never silently show another colour's blank when the customer picked one.
  if (opts.frameColorId && manifestHasMultipleColorBlanks(manifest)) {
    return opts.frameColorId;
  }

  for (const k of Object.keys(manifest.blanks || {})) {
    if (blankKeyMatches(manifest, k)) return k;
  }
  return fallback;
}

/** Exact harvest key for the selected colour, or null when no blank matches. */
export function harvestBlankMatchesSelection(
  manifest: FlatCalibrationManifest,
  opts: { sizeId?: string; frameColorId?: string; frameColorName?: string; isApparel?: boolean },
): string | null {
  if (!opts.frameColorId && !opts.frameColorName && !opts.sizeId) return null;
  const resolved = resolveFlatBlankColorId(manifest, opts);
  if (!resolved || !blankKeyMatches(manifest, resolved)) return null;
  if (opts.frameColorId || opts.frameColorName) {
    const aliases = new Set(
      colorKeyAliases(opts.frameColorId || "", opts.frameColorName).map((a) =>
        normalizeFlatColorKey(a),
      ),
    );
    const kn = normalizeFlatColorKey(resolved);
    const seg = normalizeFlatColorKey(blankColorSegment(resolved));
    if (!aliases.has(kn) && !aliases.has(seg)) return null;
  }
  return resolved;
}

export function matchHarvestBlankKey(
  manifest: FlatCalibrationManifest,
  id: string,
  name?: string,
): string | null {
  return findBlankKey(manifest, id, name);
}

/** Hoodies/tees imported as `generic` still need apparel blank matching. */
export function productLooksLikeApparel(opts: {
  designerType?: string | null;
  name?: string | null;
  sizes?: Array<{ id?: string; name?: string }> | null;
}): boolean {
  const dt = String(opts.designerType || "").toLowerCase();
  if (dt === "apparel") return true;
  if (dt === "framed-print" || dt === "pillow" || dt === "mug") return false;
  if (
    /\b(hoodie|sweatshirt|crewneck|t-shirt|\btee\b|apparel|garment|zip[- ]?up)\b/i.test(
      opts.name || "",
    )
  ) {
    return true;
  }
  const sizes = opts.sizes || [];
  if (sizes.length === 0) return false;
  return sizes.every(
    (s) =>
      isApparelSizeSegment(String(s.id || "")) ||
      isApparelSizeSegment(String(s.name || "")),
  );
}

/**
 * Key for placement persistence — blank photo may change (frame colour) while
 * print geometry stays the same (decor per size, phone model).
 */
export function resolveFlatPlacementGeometryKey(
  manifest: FlatCalibrationManifest,
  opts: { sizeId?: string; frameColorId?: string; frameColorName?: string; isApparel?: boolean },
): string {
  const apparelColorOnly =
    !!opts.isApparel ||
    (manifest.decorPerSize && blanksLookLikeApparelSizeColor(manifest));
  if (!apparelColorOnly && (manifest.decorPerSize || manifest.edgeWrap) && opts.sizeId) {
    return opts.sizeId;
  }
  return resolveFlatBlankColorId(manifest, opts);
}
