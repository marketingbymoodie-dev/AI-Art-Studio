import { API_BASE } from "@/lib/urlBase";
import {
  printFileDimsForAspectRatio,
  probeSilhouetteRectFromRgba,
  shouldProbeCatalogBlankGuide,
  visibleRectForCatalogSizeBlank,
  type NormRect,
} from "@shared/catalogSizeBlanks";
import { featherMaskAlphaFromRgba, maskAlphaLooksBinary } from "@shared/maskFeather";
import {
  extractDimensionalKey,
  swapDecorSizeDimensionId,
} from "@shared/productVariantOptions";
import type { FlatCalibrationManifest, FlatViewCalibration } from "@/pages/embed-design";
import type { CalibratorLayerAdjust, FlatRenderInput } from "./flatRender";

export type FlatViewName = "front" | "back";

export type FlatLoadedViewAssets = {
  blank: HTMLImageElement | null;
  mask: HTMLImageElement | null;
  shading: HTMLImageElement | null;
};

/** Resolve absolute URL (manifest urls are usually Supabase absolutes already). */
export function toAbsFlatAssetUrl(url: string): string {
  if (!url) return url;
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  return `${API_BASE}${url.startsWith("/") ? "" : "/"}${url}`;
}

export function normalizeFlatColorKey(id: string): string {
  return id.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
}

export function flatBlankHasViews(
  entry: Partial<Record<FlatViewName, string>> | undefined,
): entry is Partial<Record<FlatViewName, string>> {
  return !!(entry?.front || entry?.back);
}

import {
  resolveFlatBlankColorId,
  resolveFlatPlacementGeometryKey,
  firstUsableBlankKey,
  manifestHasMultipleColorBlanks,
  matchHarvestBlankKey,
  harvestBlankMatchesSelection,
  productLooksLikeApparel,
} from "./flatBlankResolve";

export {
  resolveFlatBlankColorId,
  resolveFlatPlacementGeometryKey,
  firstUsableBlankKey,
  manifestHasMultipleColorBlanks,
  matchHarvestBlankKey,
  harvestBlankMatchesSelection,
  productLooksLikeApparel,
};

function findBlankKey(manifest: FlatCalibrationManifest, id: string): string | null {
  return matchHarvestBlankKey(manifest, id);
}

/**
 * Resolve a geometryByBlank / blank key for calibration lookup.
 *
 * decorPerSize harvests store geometry under `size:color` (e.g. `20x30:white`),
 * while FlatProductPlacer passes a size-only placement key (`20x30`). Without a
 * prefix match we fall back to the shared 11×14 mask and white mat bars appear.
 */
export function findGeometryBlankKey(
  manifest: FlatCalibrationManifest,
  id: string,
  opts?: { allowDimensionSwap?: boolean },
): string | null {
  if (!id) return null;
  const geo = (manifest as FlatCalibrationManifestWithGeometry).geometryByBlank || {};
  if (geo[id]) return id;
  const blankHit = findBlankKey(manifest, id);
  if (blankHit && geo[blankHit]) return blankHit;
  if (blankHit) return blankHit;

  const norm = normalizeFlatColorKey(id);
  // Prefer an exact size:color geometry key whose size prefix matches.
  const geoKeys = Object.keys(geo);
  for (const k of geoKeys) {
    const kn = normalizeFlatColorKey(k);
    if (kn === norm) return k;
  }
  for (const k of geoKeys) {
    const kn = normalizeFlatColorKey(k);
    // `20x30-white` starts with `20x30-` when id is size-only `20x30`
    if (kn.startsWith(`${norm}-`)) return k;
  }
  // Same prefix scan on blank keys (geometry may share ids).
  for (const k of Object.keys(manifest.blanks || {})) {
    if (!flatBlankHasViews(manifest.blanks?.[k])) continue;
    const kn = normalizeFlatColorKey(k);
    if (kn === norm || kn.startsWith(`${norm}-`)) return k;
  }

  // Landscape HFP size with only portrait harvest (24x18 → try 18x24:*).
  if (opts?.allowDimensionSwap !== false) {
    const swapped = swapDecorSizeDimensionId(id);
    if (swapped && swapped !== id) {
      return findGeometryBlankKey(manifest, swapped, { allowDimensionSwap: false });
    }
  }
  return null;
}

/**
 * 241 droop mask: exact `catalogSizeKey` on geometryByBlank only.
 * Never axis-swap, never views.front / findGeometryBlankKey (those ghost).
 */
export function catalogSizeExactMaskUrl(
  manifest: FlatCalibrationManifest,
  catalogSizeKey: string | null | undefined,
  view: FlatViewName,
): string | null {
  if (!catalogSizeKey) return null;
  const geo = (manifest as FlatCalibrationManifestWithGeometry).geometryByBlank;
  if (!geo) return null;
  const keys = [catalogSizeKey];
  const dim =
    extractDimensionalKey(catalogSizeKey) ||
    (catalogSizeKey.match(/^(\d+)-(\d+)$/)
      ? `${catalogSizeKey.split("-")[0]}x${catalogSizeKey.split("-")[1]}`
      : null);
  if (dim && dim !== catalogSizeKey) keys.push(dim);
  for (const key of keys) {
    const url = geo[key]?.[view]?.maskUrl;
    if (typeof url === "string" && url.trim()) return url.trim();
  }
  return null;
}

/**
 * Pick the blank photo set for `colorId`, with graceful fallback: exact key →
 * normalized-key match → first entry with usable URLs.
 *
 * Empty `{}` entries (failed harvest for that colour) are skipped — treating
 * them as missing avoids blocking fallback and breaking the placer.
 */
/** Per-model geometry overrides (phone cases — camera cutout differs per model). */
export type FlatViewGeometryOverride = Pick<
  FlatViewCalibration,
  | "visibleRectNormalized"
  | "printBoundsNormalized"
  | "backFaceCropNormalized"
  | "phoneBackNormalized"
  | "safeZoneNormalized"
  | "sideProfileCropped"
  | "sideProfileSourceCropNormalized"
  | "printFileDims"
  | "mockupDims"
  | "maskUrl"
  | "shadingUrl"
  | "shadingMode"
>;

export type FlatCalibrationManifestWithGeometry = FlatCalibrationManifest & {
  geometryByBlank?: Record<string, Partial<Record<FlatViewName, FlatViewGeometryOverride>>>;
  calibratorGeometry?: {
    productTypeId: number;
    models: Record<
      string,
      Partial<
        Record<
          FlatViewName,
          {
            blank: CalibratorLayerAdjust;
            mask: CalibratorLayerAdjust;
            shading: CalibratorLayerAdjust;
          }
        >
      >
    >;
    updatedAt: string;
  };
};

/** Layer nudges saved by the flat calibrator admin tool (mask/shading relative to baked blank). */
export function resolveCalibratorLayerAdjust(
  manifest: FlatCalibrationManifestWithGeometry,
  geometryKey: string,
  view: FlatViewName,
): FlatRenderInput["layerAdjust"] | undefined {
  const resolvedKey =
    findGeometryBlankKey(manifest, geometryKey) || geometryKey;
  const entry =
    manifest.calibratorGeometry?.models?.[resolvedKey]?.[view] ||
    manifest.calibratorGeometry?.models?.[geometryKey]?.[view];
  if (!entry) return undefined;
  const hasMask =
    entry.mask.offsetX !== 0 || entry.mask.offsetY !== 0 || entry.mask.scale !== 1;
  const hasShade =
    entry.shading.offsetX !== 0 || entry.shading.offsetY !== 0 || entry.shading.scale !== 1;
  const hasBlank =
    entry.blank.offsetX !== 0 || entry.blank.offsetY !== 0 || entry.blank.scale !== 1;
  if (!hasMask && !hasShade && !hasBlank) return undefined;
  return {
    blank: hasBlank ? entry.blank : undefined,
    mask: hasMask ? entry.mask : undefined,
    shading: hasShade ? entry.shading : undefined,
  };
}

/**
 * Merge shared view calibration with optional per-blank-key overrides.
 * Falls back to shared `manifest.views[view]` when no override exists.
 *
 * `refitCatalogSizeGuide` + `sizeAspectRatio`: when the blank is a square
 * catalog size PNG (wall decals / tapestry) but harvest only stored one shared 2:3 guide,
 * synthesize the dashed print rect for the selected size AR (3:4 / 4:3 / …).
 */
export function resolveFlatViewCalibration(
  manifest: FlatCalibrationManifest,
  colorId: string,
  view: FlatViewName,
  opts?: {
    landscapeOrientation?: boolean;
    sizeAspectRatio?: string | null;
    refitCatalogSizeGuide?: boolean;
    catalogBlueprintId?: number | null;
    catalogSizeKey?: string | null;
  },
): FlatViewCalibration | undefined {
  const base = manifest.views[view];
  if (!base) return undefined;
  const blankKey = findGeometryBlankKey(manifest, colorId);
  const override = blankKey ? manifest.geometryByBlank?.[blankKey]?.[view] : undefined;
  let merged: FlatViewCalibration;
  if (!override) {
    merged = base;
  } else {
    merged = {
      ...base,
      ...override,
      visibleRectNormalized: override.visibleRectNormalized ?? base.visibleRectNormalized,
      printBoundsNormalized: override.printBoundsNormalized ?? base.printBoundsNormalized,
      backFaceCropNormalized: override.backFaceCropNormalized ?? base.backFaceCropNormalized,
      phoneBackNormalized: override.phoneBackNormalized ?? base.phoneBackNormalized,
      safeZoneNormalized: override.safeZoneNormalized ?? base.safeZoneNormalized,
      sideProfileCropped: override.sideProfileCropped ?? base.sideProfileCropped,
      sideProfileSourceCropNormalized:
        override.sideProfileSourceCropNormalized ?? base.sideProfileSourceCropNormalized,
      mockupDims: override.mockupDims ?? base.mockupDims,
      printFileDims: override.printFileDims ?? base.printFileDims,
      maskUrl: override.maskUrl ?? base.maskUrl,
      shadingUrl: override.shadingUrl ?? base.shadingUrl,
      shadingMode: override.shadingMode ?? base.shadingMode,
      meshNodes: base.meshNodes,
      meshGrid: base.meshGrid,
      planarityScore: base.planarityScore,
      coverage: base.coverage,
    };
  }

  // Square catalog blanks (wall decals / tapestry): harvest often only stored one shared
  // 2:3 guide. When the blank PNG is size-specific, rebuild the dashed rect
  // from the selected size AR so 18×24 / 24×18 aren't stuck on 2:3 / 3:2.
  if (opts?.refitCatalogSizeGuide && (opts.sizeAspectRatio || opts.catalogSizeKey)) {
    const rect = visibleRectForCatalogSizeBlank(
      opts.catalogBlueprintId,
      opts.catalogSizeKey,
      opts.sizeAspectRatio,
    );
    const dims = printFileDimsForAspectRatio(
      opts.sizeAspectRatio ||
        (opts.catalogSizeKey
          ? String(opts.catalogSizeKey).replace(/(\d+)x(\d+)/i, "$1:$2")
          : null),
    );
    if (rect) {
      const tapestry = shouldProbeCatalogBlankGuide(opts.catalogBlueprintId);
      const exactMask = tapestry
        ? catalogSizeExactMaskUrl(manifest, opts.catalogSizeKey, view)
        : null;
      return {
        ...merged,
        visibleRectNormalized: rect,
        printBoundsNormalized: rect,
        ...(dims ? { printFileDims: dims } : {}),
        mockupDims:
          merged.mockupDims?.width &&
          merged.mockupDims.width === merged.mockupDims.height
            ? merged.mockupDims
            : { width: 1024, height: 1024 },
        // 241: size-only droop mask. Never keep shared / axis-swapped maskUrl.
        ...(tapestry ? { maskUrl: exactMask, shadingUrl: null } : {}),
      };
    }
  }

  if (!opts?.landscapeOrientation) return merged;
  const pf = merged.printFileDims;
  if (!pf?.width || !pf?.height || pf.width >= pf.height) return merged;
  return orientFlatViewCalibrationLandscape(merged);
}

/** Overlay the live-probed fabric rect onto a catalog-size calibration. */
export function applyProbedCatalogGuide(
  calib: FlatViewCalibration,
  probed: NormRect | null | undefined,
): FlatViewCalibration {
  if (!probed || !(probed.width > 0) || !(probed.height > 0)) return calib;
  return {
    ...calib,
    visibleRectNormalized: probed,
    printBoundsNormalized: probed,
  };
}

/** Read fabric/shadow AABB from a loaded catalog blank (white studio backdrop). */
export function probeCatalogBlankSilhouette(
  img: HTMLImageElement | null,
): NormRect | null {
  if (!img) return null;
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  if (!(w > 0) || !(h > 0)) return null;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  try {
    ctx.drawImage(img, 0, 0, w, h);
    const { data } = ctx.getImageData(0, 0, w, h);
    return probeSilhouetteRectFromRgba(data, w, h);
  } catch {
    return null;
  }
}

export { shouldProbeCatalogBlankGuide };

export function resolveFlatBlank(
  manifest: FlatCalibrationManifest,
  colorId: string,
): Partial<Record<FlatViewName, string>> {
  const blanks = manifest.blanks || {};
  const hit = colorId ? findBlankKey(manifest, colorId) : null;
  if (hit && flatBlankHasViews(blanks[hit])) return blanks[hit];
  const usable = Object.keys(blanks).filter((k) => flatBlankHasViews(blanks[k]));
  if (colorId) {
    // One harvest (tote / single-colour apron): use it even if the size/option
    // id does not match the blank key. Multiple colours still refuse a swap.
    if (usable.length === 1) return blanks[usable[0]];
    if (usable.includes("default")) return blanks.default;
    // Never silently swap in another colour's blank (Navy must not show the
    // first harvested brown hoodie). Caller can override with a Shopify image.
    return {};
  }
  for (const k of Object.keys(blanks)) {
    if (flatBlankHasViews(blanks[k])) return blanks[k];
  }
  return {};
}

function swapNormRect(
  r: { x: number; y: number; width: number; height: number } | null | undefined,
): { x: number; y: number; width: number; height: number } | null | undefined {
  if (!r) return r;
  return { x: r.y, y: r.x, width: r.height, height: r.width };
}

/** Rotate harvested portrait geometry to landscape when size orientation differs. */
export function orientFlatViewCalibrationLandscape(
  calib: FlatViewCalibration,
): FlatViewCalibration {
  const pf = calib.printFileDims;
  return {
    ...calib,
    printFileDims: { width: pf.height, height: pf.width },
    visibleRectNormalized: swapNormRect(calib.visibleRectNormalized) ?? calib.visibleRectNormalized,
    printBoundsNormalized: swapNormRect(calib.printBoundsNormalized) ?? calib.printBoundsNormalized,
    backFaceCropNormalized: swapNormRect(calib.backFaceCropNormalized) ?? calib.backFaceCropNormalized,
    phoneBackNormalized: swapNormRect(calib.phoneBackNormalized) ?? calib.phoneBackNormalized,
    safeZoneNormalized: swapNormRect(calib.safeZoneNormalized) ?? calib.safeZoneNormalized,
    sideProfileSourceCropNormalized:
      swapNormRect(calib.sideProfileSourceCropNormalized) ?? calib.sideProfileSourceCropNormalized,
    mockupDims: calib.mockupDims
      ? { width: calib.mockupDims.height, height: calib.mockupDims.width }
      : calib.mockupDims,
  };
}

/**
 * Calibration assets (mask/shading/blanks) live at STABLE canonical URLs that
 * are overwritten in place on re-harvest (e.g. `canonical/77/v1/mask-front.png`).
 * Browser and CDN caches can keep serving the pre-harvest copy while the
 * manifest JSON is already new — the dashed guide and the pixel clip then
 * derive from different geometry and the placer visibly lies (art past the
 * guide). Pinning every asset request to the manifest generation guarantees a
 * re-harvest always busts those caches.
 */
export function withFlatAssetVersion(
  url: string | null | undefined,
  version: string | null | undefined,
): string {
  if (!url) return url ?? "";
  if (!version) return url;
  if (url.startsWith("data:") || url.startsWith("blob:")) return url;
  const v = encodeURIComponent(version.replace(/[^0-9A-Za-z]/g, "").slice(0, 24));
  if (!v) return url;
  return `${url}${url.includes("?") ? "&" : "?"}cv=${v}`;
}

export function loadFlatImage(
  url: string,
  opts?: { cors?: boolean },
): Promise<HTMLImageElement | null> {
  const cors = opts?.cors !== false;
  return new Promise((resolve) => {
    const img = new Image();
    if (cors) img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = toAbsFlatAssetUrl(url);
  });
}

/** Try CORS first (needed for canvas export); fall back to display-only load. */
export async function loadFlatImageRelaxed(url: string): Promise<HTMLImageElement | null> {
  const withCors = await loadFlatImage(url, { cors: true });
  if (withCors) return withCors;
  return loadFlatImage(url, { cors: false });
}

/**
 * 241 only: anti-alias a hard magenta mask so the droop edge is not jagged.
 * Skips already-soft masks (re-harvested). Hood / poster never call this.
 */
export async function featherCatalogGuideMask(
  mask: HTMLImageElement | null,
): Promise<HTMLImageElement | null> {
  if (!mask) return null;
  const w = mask.naturalWidth || mask.width;
  const h = mask.naturalHeight || mask.height;
  if (!(w > 0) || !(h > 0)) return mask;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return mask;
  try {
    ctx.drawImage(mask, 0, 0, w, h);
    const img = ctx.getImageData(0, 0, w, h);
    if (!maskAlphaLooksBinary(img.data, w, h)) return mask;
    const feathered = featherMaskAlphaFromRgba(img.data, w, h);
    img.data.set(feathered);
    ctx.putImageData(img, 0, 0);
  } catch {
    return mask;
  }
  const dataUrl = canvas.toDataURL("image/png");
  return new Promise((resolve) => {
    const out = new Image();
    out.onload = () => resolve(out);
    out.onerror = () => resolve(mask);
    out.src = dataUrl;
  });
}

function imagePixelSize(img: HTMLImageElement): { w: number; h: number } {
  return { w: img.naturalWidth || img.width, h: img.naturalHeight || img.height };
}

/** 90° clockwise — used when landscape sizes reuse a portrait harvest mask. */
export async function rotateFlatImage90Cw(img: HTMLImageElement): Promise<HTMLImageElement> {
  const { w, h } = imagePixelSize(img);
  if (w <= 0 || h <= 0) return img;
  const canvas = document.createElement("canvas");
  canvas.width = h;
  canvas.height = w;
  const ctx = canvas.getContext("2d");
  if (!ctx) return img;
  ctx.translate(h, 0);
  ctx.rotate(Math.PI / 2);
  ctx.drawImage(img, 0, 0, w, h);
  const dataUrl = canvas.toDataURL("image/png");
  return new Promise((resolve) => {
    const out = new Image();
    out.onload = () => resolve(out);
    out.onerror = () => resolve(img);
    out.src = dataUrl;
  });
}

/**
 * True when landscapeOrientation remapped portrait printFileDims → landscape.
 * Harvest masks are usually square (mockup px) with a tall opaque silhouette —
 * pixel aspect alone cannot detect that, so callers use this geometry check.
 */
export function flatCalibrationSwappedToLandscape(
  manifest: FlatCalibrationManifest,
  colorId: string,
  view: FlatViewName,
  landscapeOrientation: boolean,
): boolean {
  if (!landscapeOrientation) return false;
  const base = resolveFlatViewCalibration(manifest, colorId, view);
  if (!base?.printFileDims?.width || !base.printFileDims.height) return false;
  if (base.printFileDims.width >= base.printFileDims.height) return false;
  const oriented = resolveFlatViewCalibration(manifest, colorId, view, {
    landscapeOrientation: true,
  });
  if (!oriented?.printFileDims) return false;
  return oriented.printFileDims.width > oriented.printFileDims.height;
}

/**
 * When print geometry is swapped to landscape but mask/shading still encode a
 * portrait silhouette (often on a square mockup canvas), rotate 90° so
 * destination-in clip matches the wide placement box. Without this, blank white
 * shows as fixed side bars while art pans underneath.
 */
export async function orientFlatHarvestPixelsForLandscape(
  mask: HTMLImageElement | null,
  shading: HTMLImageElement | null,
): Promise<{ mask: HTMLImageElement | null; shading: HTMLImageElement | null }> {
  if (!mask && !shading) return { mask, shading };
  const [nextMask, nextShading] = await Promise.all([
    mask ? rotateFlatImage90Cw(mask) : Promise.resolve(null),
    shading ? rotateFlatImage90Cw(shading) : Promise.resolve(null),
  ]);
  return { mask: nextMask, shading: nextShading };
}

export async function loadFlatViewAssets(
  manifest: FlatCalibrationManifest,
  colorId: string,
  view: FlatViewName,
  opts?: {
    landscapeOrientation?: boolean;
    blankUrlOverride?: string | null;
    sizeAspectRatio?: string | null;
    refitCatalogSizeGuide?: boolean;
    catalogBlueprintId?: number | null;
    catalogSizeKey?: string | null;
  },
): Promise<FlatLoadedViewAssets | null> {
  const blank = resolveFlatBlank(manifest, colorId);
  const blankUrl =
    view === "front" && opts?.blankUrlOverride ? opts.blankUrlOverride : blank[view];
  const landscapeOrientation = !!opts?.landscapeOrientation;
  const refitCatalogSizeGuide =
    opts?.refitCatalogSizeGuide === true || !!opts?.blankUrlOverride;
  const calib = resolveFlatViewCalibration(manifest, colorId, view, {
    landscapeOrientation,
    sizeAspectRatio: opts?.sizeAspectRatio,
    refitCatalogSizeGuide,
    catalogBlueprintId: opts?.catalogBlueprintId,
    catalogSizeKey: opts?.catalogSizeKey,
  });
  if (!blankUrl || !calib) return null;

  const shouldLoadShading =
    !refitCatalogSizeGuide &&
    !!calib.shadingUrl &&
    (!!manifest.edgeWrap ||
      calib.shadingMode === "map" ||
      !!calib.printBoundsNormalized);

  // Version-pin harvest assets so a re-harvest can't pair a fresh manifest
  // with stale cached pixels (blankUrlOverride is a catalog photo — leave it).
  const assetVersion = manifest.generatedAt;
  const versionedBlankUrl =
    view === "front" && opts?.blankUrlOverride
      ? blankUrl
      : withFlatAssetVersion(blankUrl, assetVersion);
  const loadCatalogTapestryMask =
    shouldProbeCatalogBlankGuide(opts?.catalogBlueprintId) && refitCatalogSizeGuide;
  const [b, m, s] = await Promise.all([
    loadFlatImage(versionedBlankUrl),
    // 241: load the size-keyed droop mask (calib.maskUrl is exact-key only).
    // Other catalog-size-blank products still skip shared harvest masks.
    (loadCatalogTapestryMask || !refitCatalogSizeGuide) && calib.maskUrl
      ? loadFlatImage(withFlatAssetVersion(calib.maskUrl, assetVersion))
      : Promise.resolve(null),
    shouldLoadShading
      ? loadFlatImage(withFlatAssetVersion(calib.shadingUrl!, assetVersion))
      : Promise.resolve(null),
  ]);
  if (!b) return null;
  // Catalog-blank refit already has the correct AR — don't rotate harvest masks.
  const mask =
    loadCatalogTapestryMask && m ? await featherCatalogGuideMask(m) : m;
  if (
    !refitCatalogSizeGuide &&
    flatCalibrationSwappedToLandscape(manifest, colorId, view, landscapeOrientation)
  ) {
    const oriented = await orientFlatHarvestPixelsForLandscape(mask, s);
    return { blank: b, mask: oriented.mask, shading: oriented.shading };
  }
  return { blank: b, mask, shading: s };
}
