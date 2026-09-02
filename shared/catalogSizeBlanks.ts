/**
 * Size-keyed catalog blanks for mixed-orientation products (Cotton Comforter,
 * Wall Decals, Indoor Wall Tapestry). Printify placeholder PNGs are often
 * square canvases — match by product size token from the filename (68x88),
 * not image pixel aspect.
 */

import {
  canvasOrientationFromAspect,
  extractDimensionalKey,
  resolveSizeAspectRatio,
  type CanvasOrientation,
  type SizeLike,
} from "./productVariantOptions";
import { isGptImage2Model } from "./styleGeneration";

/** Printify blueprint IDs with shared size blanks. */
export const CATALOG_SIZE_BLANK_BLUEPRINTS = {
  cottonComforter: 2706,
  wallDecals: 759,
  indoorWallTapestry: 241,
} as const;

export type CatalogSizeBlankBlueprintId =
  (typeof CATALOG_SIZE_BLANK_BLUEPRINTS)[keyof typeof CATALOG_SIZE_BLANK_BLUEPRINTS];

export function isCatalogSizeBlankBlueprint(
  blueprintId: number | null | undefined,
): blueprintId is CatalogSizeBlankBlueprintId {
  if (blueprintId == null) return false;
  return (Object.values(CATALOG_SIZE_BLANK_BLUEPRINTS) as number[]).includes(
    blueprintId,
  );
}

/** One calibrator model per seeded catalog size (26×36, 36×26, …). */
export function catalogSizeCalibratorModels(
  blueprintId: number | null | undefined,
): Array<{ id: string; name: string }> | null {
  if (!isCatalogSizeBlankBlueprint(blueprintId)) return null;
  return Object.keys(CATALOG_SIZE_BLANK_STORAGE_PATHS[blueprintId]).map((id) => ({
    id,
    name: id.replace(/x/i, " × "),
  }));
}

/** Build size→URL map using a public-URL resolver (e.g. Supabase getPublicUrl). */
export function resolveCatalogSizeBlankUrlMap(
  blueprintId: number | null | undefined,
  getPublicUrl: (storagePath: string) => string | null | undefined,
): Record<string, string> | null {
  if (!isCatalogSizeBlankBlueprint(blueprintId)) return null;
  const paths = CATALOG_SIZE_BLANK_STORAGE_PATHS[blueprintId];
  const out: Record<string, string> = {};
  for (const [sizeKey, storagePath] of Object.entries(paths)) {
    const url = getPublicUrl(storagePath);
    if (url) out[sizeKey] = url;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** Stable Supabase paths under the designs bucket (seeded by scripts/seed-catalog-size-blanks.ts). */
export const CATALOG_SIZE_BLANK_STORAGE_PATHS: Record<
  CatalogSizeBlankBlueprintId,
  Record<string, string>
> = {
  [CATALOG_SIZE_BLANK_BLUEPRINTS.cottonComforter]: {
    "68x88": "catalog-blanks/comforter/68x88.png",
    "68x92": "catalog-blanks/comforter/68x92.png",
    "104x88": "catalog-blanks/comforter/104x88.png",
    "88x88": "catalog-blanks/comforter/88x88.png",
  },
  [CATALOG_SIZE_BLANK_BLUEPRINTS.wallDecals]: {
    "12x18": "catalog-blanks/wall-decals/12x18.png",
    "18x12": "catalog-blanks/wall-decals/18x12.png",
    "18x24": "catalog-blanks/wall-decals/18x24.png",
    "24x18": "catalog-blanks/wall-decals/24x18.png",
    "24x36": "catalog-blanks/wall-decals/24x36.png",
    "36x24": "catalog-blanks/wall-decals/36x24.png",
  },
  [CATALOG_SIZE_BLANK_BLUEPRINTS.indoorWallTapestry]: {
    "26x36": "catalog-blanks/indoor-wall-tapestry/26x36.png",
    "36x26": "catalog-blanks/indoor-wall-tapestry/36x26.png",
    "50x60": "catalog-blanks/indoor-wall-tapestry/50x60.png",
    "60x50": "catalog-blanks/indoor-wall-tapestry/60x50.png",
    "68x80": "catalog-blanks/indoor-wall-tapestry/68x80.png",
    "80x68": "catalog-blanks/indoor-wall-tapestry/80x68.png",
    "88x104": "catalog-blanks/indoor-wall-tapestry/88x104.png",
    "104x88": "catalog-blanks/indoor-wall-tapestry/104x88.png",
  },
};

export type BaseMockupImagesLike = {
  primary?: string | null;
  front?: string | null;
  gallery?: string[] | null;
  custom?: string[] | null;
  available?: unknown;
  blanksBySize?: Record<string, string> | null;
  [key: string]: unknown;
};

/**
 * Catalog size blanks are square PNGs with the sticker letterboxed + drop-shadow.
 * Empirically the outer sticker+shadow bbox is ~75% of a full edge-touching letterbox
 * (all 759 sizes). Print guide then shrinks further by PRINT_INSET so art/clip stay
 * on the printable face and do not fill the wall-shadow fringe.
 */
export const CATALOG_SIZE_BLANK_SHEET_SCALE = 0.75;

/**
 * Extra shrink of the print guide inside the outer sheet bbox (~3.5%).
 * Matches ~12–16px drop-shadow fringe on 1024² wall-decal catalog blanks.
 */
export const CATALOG_SIZE_BLANK_PRINT_INSET = 0.965;

export type NormRect = { x: number; y: number; width: number; height: number };

function aspectRatioFromSizeKey(
  sizeKey: string | null | undefined,
): string | null {
  if (!sizeKey) return null;
  const dim = extractDimensionalKey(sizeKey) || sizeKey;
  const [w, h] = dim.split("x").map(Number);
  return w > 0 && h > 0 ? `${w}:${h}` : null;
}

/**
 * Catalog-size-blank print-shape path (241 tapestry + 759 wall decals):
 * size-only magenta mask, contain-fit, bg-fill, per-pixel coverage warning,
 * persist crop-skip. Dashed box traces the probed mask, not the inch letterbox.
 * Comforter (2706) stays off.
 */
export function shouldProbeCatalogBlankGuide(
  blueprintId: number | null | undefined,
): boolean {
  return (
    blueprintId === CATALOG_SIZE_BLANK_BLUEPRINTS.indoorWallTapestry ||
    blueprintId === CATALOG_SIZE_BLANK_BLUEPRINTS.wallDecals
  );
}

/** 241 only — hanging cloth folds. 759 vinyl/fabric sheet is flat. */
export function shouldApplyCatalogBlankShading(
  blueprintId: number | null | undefined,
): boolean {
  return blueprintId === CATALOG_SIZE_BLANK_BLUEPRINTS.indoorWallTapestry;
}

/**
 * Preview-only: 241 Place-on-item art renders 15% larger so the editor
 * matches Printify's printed size. Bake / `bakeFlatPrintFile` stay at 1.0.
 */
export const TAPESTRY_PREVIEW_PLACEMENT_SCALE = 1.15;
/** Per-model hook — both models use +15% until a split is needed again. */
export const TAPESTRY_PREVIEW_PLACEMENT_SCALE_GPT_IMAGE_2 = 1.15;

export function tapestryPreviewPlacementScale(
  generationModel?: string | null,
): number {
  return isGptImage2Model(generationModel)
    ? TAPESTRY_PREVIEW_PLACEMENT_SCALE_GPT_IMAGE_2
    : TAPESTRY_PREVIEW_PLACEMENT_SCALE;
}

/**
 * Preview-only 759 bump. 1.0 until a test order shows editor ≠ Printify.
 * Bake must stay at 1.0.
 */
export const DECAL_PREVIEW_PLACEMENT_SCALE = 1.0;

export function decalPreviewPlacementScale(
  _generationModel?: string | null,
): number {
  return DECAL_PREVIEW_PLACEMENT_SCALE;
}

/**
 * Bounding box of fabric/shadow pixels in a white-studio catalog blank.
 * Not a hand-tuned table — derived from the same image the customer sees.
 */
export function probeSilhouetteRectFromRgba(
  data: ArrayLike<number>,
  width: number,
  height: number,
  opts?: { whiteThreshold?: number; printInset?: number },
): NormRect | null {
  if (!(width > 0) || !(height > 0)) return null;
  const white = opts?.whiteThreshold ?? 248;
  const printInset = opts?.printInset ?? CATALOG_SIZE_BLANK_PRINT_INSET;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const a = data[i + 3] ?? 255;
      if (a < 10) continue;
      const r = data[i] ?? 0;
      const g = data[i + 1] ?? 0;
      const b = data[i + 2] ?? 0;
      if (r > white && g > white && b > white) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < minX || maxY < minY) return null;
  const bw = (maxX - minX + 1) / width;
  const bh = (maxY - minY + 1) / height;
  if (!(bw > 0.05) || !(bh > 0.05)) return null;
  const insetW = bw * printInset;
  const insetH = bh * printInset;
  const round = (n: number) => +n.toFixed(5);
  return {
    x: round(minX / width + (bw - insetW) / 2),
    y: round(minY / height + (bh - insetH) / 2),
    width: round(insetW),
    height: round(insetH),
  };
}

/**
 * Print guide for catalog-size-blank products (wall decals, comforter, tapestry).
 * Inch-aspect letterbox is the fallback when the blank cannot be probed (241
 * prefers a live silhouette probe of the hanging photo).
 */
export function visibleRectForCatalogSizeBlank(
  _blueprintId: number | null | undefined,
  sizeKey: string | null | undefined,
  aspectRatio?: string | null,
): NormRect | null {
  return visibleRectForCatalogSizeAspect(aspectRatio || aspectRatioFromSizeKey(sizeKey));
}

/**
 * Normalized print guide for a size aspect inside a square catalog blank.
 * Matches `scripts/assets/catalog-blanks/wall-decals/*.png` framing so the
 * dashed placer outline reaches the sticker's long edges (fixes 18×24 / 24×18
 * when harvest only stored a shared 2:3 visibleRect), then insets past the
 * mockup drop-shadow so print preview does not spill into non-print area.
 */
export function visibleRectForCatalogSizeAspect(
  aspectRatio: string | null | undefined,
  sheetScale: number = CATALOG_SIZE_BLANK_SHEET_SCALE,
  printInset: number = CATALOG_SIZE_BLANK_PRINT_INSET,
): NormRect | null {
  if (!aspectRatio) return null;
  const [aw, ah] = String(aspectRatio).split(":").map(Number);
  if (!(aw > 0 && ah > 0) || !(sheetScale > 0 && sheetScale <= 1)) return null;
  if (!(printInset > 0 && printInset <= 1)) return null;
  const ar = aw / ah;
  const round = (n: number) => +n.toFixed(5);
  let width: number;
  let height: number;
  if (ar >= 1) {
    // Landscape: full letterbox fills width, then shrink for outer sheet margin.
    width = sheetScale;
    height = (1 / ar) * sheetScale;
  } else {
    // Portrait: full letterbox fills height.
    width = ar * sheetScale;
    height = sheetScale;
  }
  // Inset from center so the guide/clip exclude the catalog blank's wall shadow.
  width *= printInset;
  height *= printInset;
  return {
    x: round((1 - width) / 2),
    y: round((1 - height) / 2),
    width: round(width),
    height: round(height),
  };
}

/** Printify-style print dims from a w:h aspect (long side ≈ 3600). */
export function printFileDimsForAspectRatio(
  aspectRatio: string | null | undefined,
): { width: number; height: number } | null {
  if (!aspectRatio) return null;
  const [aw, ah] = String(aspectRatio).split(":").map(Number);
  if (!(aw > 0 && ah > 0)) return null;
  const long = 3600;
  if (aw >= ah) {
    return { width: long, height: Math.max(1, Math.round((long * ah) / aw)) };
  }
  return { width: Math.max(1, Math.round((long * aw) / ah)), height: long };
}

/** Resolve a blank URL for a selected size from blanksBySize (+ orientation fallback). */
export function resolveBlankUrlForSize(
  images: BaseMockupImagesLike | null | undefined,
  size: SizeLike | null | undefined,
  productAspectRatio?: string | null,
): string | null {
  if (!images?.blanksBySize || !size) return null;
  const map = images.blanksBySize;
  const dim =
    extractDimensionalKey(size.id) ||
    extractDimensionalKey(size.name) ||
    (size.width && size.height ? `${Math.round(size.width)}x${Math.round(size.height)}` : null);
  if (dim && map[dim]) return map[dim];

  const orient = canvasOrientationFromAspect(
    resolveSizeAspectRatio(size, productAspectRatio),
  );
  if (!orient) return null;

  for (const [key, url] of Object.entries(map)) {
    const [w, h] = key.split("x").map(Number);
    if (!(w > 0 && h > 0) || !url) continue;
    const o = canvasOrientationFromAspect(`${w}:${h}`);
    if (o === orient) return url;
  }
  return null;
}

/** Prefer vertical, then square, then horizontal for Primary. */
function pickPrimaryFromBlanksBySize(blanksBySize: Record<string, string>): string | null {
  const entries = Object.entries(blanksBySize).filter(([, u]) => !!u);
  if (entries.length === 0) return null;
  const order: CanvasOrientation[] = ["vertical", "square", "horizontal"];
  for (const want of order) {
    for (const [key, url] of entries) {
      const [w, h] = key.split("x").map(Number);
      if (!(w > 0 && h > 0)) continue;
      if (canvasOrientationFromAspect(`${w}:${h}`) === want) return url;
    }
  }
  return entries[0][1];
}

/**
 * Merge size blanks into baseMockupImages: set blanksBySize, primary, gallery
 * (one URL per orientation for the carousel). Keeps available/custom.
 */
export function applyCatalogSizeBlanks(
  images: BaseMockupImagesLike,
  blanksBySize: Record<string, string>,
): BaseMockupImagesLike {
  const cleaned: Record<string, string> = {};
  for (const [k, v] of Object.entries(blanksBySize)) {
    if (k && v) cleaned[k] = v;
  }
  if (Object.keys(cleaned).length === 0) return images;

  const primary = pickPrimaryFromBlanksBySize(cleaned) || images.primary || images.front || undefined;
  const used = new Set<string>();
  const gallery: string[] = [];
  if (primary) used.add(primary);

  const seenOrient = new Set<CanvasOrientation>();
  if (primary) {
    for (const [key, url] of Object.entries(cleaned)) {
      if (url === primary) {
        const [w, h] = key.split("x").map(Number);
        const o = canvasOrientationFromAspect(`${w}:${h}`);
        if (o) seenOrient.add(o);
        break;
      }
    }
  }
  for (const [key, url] of Object.entries(cleaned)) {
    if (used.has(url)) continue;
    const [w, h] = key.split("x").map(Number);
    const o = w && h ? canvasOrientationFromAspect(`${w}:${h}`) : null;
    if (o && seenOrient.has(o)) continue;
    if (o) seenOrient.add(o);
    gallery.push(url);
    used.add(url);
    if (gallery.length >= 4) break;
  }

  const customSet = new Set<string>([
    ...(Array.isArray(images.custom) ? images.custom.filter(Boolean) : []),
    ...Object.values(cleaned),
  ]);

  return {
    ...images,
    blanksBySize: cleaned,
    ...(primary ? { primary, front: primary } : {}),
    gallery,
    custom: Array.from(customSet).slice(0, 12),
  };
}
