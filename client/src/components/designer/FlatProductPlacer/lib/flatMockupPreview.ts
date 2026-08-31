import type { ArtworkPlacement } from "@/components/hoodie-template-mapper/lib/aopPreview";
import type { FlatCalibrationManifest } from "@/pages/embed-design";
import { shouldProbeCatalogBlankGuide } from "@shared/catalogSizeBlanks";
import type { FlatProductPlacerState } from "../index";
import {
  loadFlatImageRelaxed,
  loadFlatViewAssets,
  resolveFlatBlank,
  resolveFlatViewCalibration,
  type FlatViewName,
} from "./flatAssets";
import { renderFlatView } from "./flatRender";

/**
 * Client-side flat mockup raster for a single view — no upload. Used when the
 * customer swaps frame colour in preview mode (outside the placement editor).
 */
export async function renderFlatMockupDataUrl(
  manifest: FlatCalibrationManifest,
  colorId: string,
  placerState: FlatProductPlacerState,
  view: FlatViewName,
  artworkUrl: string,
  opts?: {
    decorMode?: boolean;
    fabricWeave?: boolean;
    landscapeOrientation?: boolean;
    blankUrlOverride?: string | null;
    catalogSizeAspectRatio?: string | null;
    catalogBlueprintId?: number | null;
    catalogSizeKey?: string | null;
    garmentColorHex?: string | null;
  },
): Promise<string | null> {
  const refitCatalogSizeGuide =
    !!opts?.blankUrlOverride &&
    !!(opts?.catalogSizeAspectRatio || opts?.catalogSizeKey);
  const assets = await loadFlatViewAssets(manifest, colorId, view, {
    landscapeOrientation: opts?.landscapeOrientation,
    blankUrlOverride: opts?.blankUrlOverride,
    sizeAspectRatio: opts?.catalogSizeAspectRatio,
    refitCatalogSizeGuide,
    catalogBlueprintId: opts?.catalogBlueprintId,
    catalogSizeKey: opts?.catalogSizeKey,
  });
  const calibBase = resolveFlatViewCalibration(manifest, colorId, view, {
    landscapeOrientation: !!opts?.landscapeOrientation,
    sizeAspectRatio: opts?.catalogSizeAspectRatio,
    refitCatalogSizeGuide,
    catalogBlueprintId: opts?.catalogBlueprintId,
    catalogSizeKey: opts?.catalogSizeKey,
  });
  if (!assets?.blank || !calibBase) return null;
  const calib = calibBase;

  const includeArtwork = !!placerState.enabled[view];
  const artwork =
    includeArtwork && artworkUrl ? await loadFlatImageRelaxed(artworkUrl) : null;
  if (includeArtwork && !artwork) return null;

  const canvas = document.createElement("canvas");
  const bg =
    typeof placerState.backgroundColor === "string" &&
    /^#[0-9a-fA-F]{6}$/.test(placerState.backgroundColor.trim())
      ? placerState.backgroundColor.trim()
      : null;
  renderFlatView({
    target: canvas,
    blank: assets.blank,
    mask: assets.mask,
    shading: assets.shading,
    artwork,
    view: calib,
    placement: placerState.placements[view] as ArtworkPlacement,
    tier: manifest.tier,
    forceShadingMap: !!manifest.edgeWrap,
    edgeWrapMode: !!manifest.edgeWrap,
    decorMode: opts?.decorMode === true || !!manifest.decorPerSize,
    fabricWeave: opts?.fabricWeave === true,
    catalogBlankShade: shouldProbeCatalogBlankGuide(opts?.catalogBlueprintId),
    // Phone cases: customer BG colour must survive colour-swap re-bake.
    printCanvasBackgroundColor: bg,
    garmentColorHex: opts?.garmentColorHex ?? null,
  });

  try {
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}

/** Views that have both calibration + a blank for this colour. */
export function flatViewsForColor(
  manifest: FlatCalibrationManifest,
  colorId: string,
): FlatViewName[] {
  const blank = resolveFlatBlank(manifest, colorId);
  const views: FlatViewName[] = [];
  (["front", "back"] as FlatViewName[]).forEach((v) => {
    if (manifest.views[v] && blank[v]) views.push(v);
  });
  return views;
}
