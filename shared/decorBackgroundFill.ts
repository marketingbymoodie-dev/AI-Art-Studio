import { isFloatingCatalogStyle, resolveCatalogSlug } from "./styleCatalog";
import {
  GENERATION_MODEL_GPT_IMAGE_2,
  isGptImage2Model,
  resolveStyleGeneration,
} from "./styleGeneration";

/** Default fill behind GPT-Image-2 floating artwork on decor (native alpha). */
export const DEFAULT_DECOR_BACKGROUND_FILL = "#FFFFFF";

export type DecorBackgroundFill = string | "none";

/** White when omitted / invalid. `"none"` leaves the PNG transparent. */
export function parseDecorBackgroundFill(raw: unknown): DecorBackgroundFill {
  if (raw == null) return DEFAULT_DECOR_BACKGROUND_FILL;
  const s = String(raw).trim();
  if (!s || s.toLowerCase() === "none") return "none";
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return `#${s.slice(1).toUpperCase()}`;
  return DEFAULT_DECOR_BACKGROUND_FILL;
}

/** Live layer hex, or `null` for none / transparent (not baked into the PNG). */
export function parseLiveFillHex(raw: unknown): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s || s.toLowerCase() === "none") return null;
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return `#${s.slice(1).toUpperCase()}`;
  return null;
}

/** White when the picker is shown and the value is empty/invalid. */
export function resolveLiveFillHex(
  raw: unknown,
  opts?: { shown?: boolean; fallbackWhite?: boolean },
): string | null {
  const parsed = parseLiveFillHex(raw);
  if (parsed) return parsed;
  if (String(raw || "").trim().toLowerCase() === "none") return null;
  if (opts?.shown && opts.fallbackWhite !== false) return DEFAULT_DECOR_BACKGROUND_FILL;
  return null;
}

/**
 * Color-only bake bleed. Printify's placeholder / tote canvas / AOP panel
 * already includes the provider margin — fill that canvas, do not grow it.
 * Subject placement is a separate rect and must not be derived from the fill.
 */
export const FALLBACK_OPENING_BLEED_FRACTION = 0.05;

export type DecorBakeBleedKind = "print-file" | "tote-canvas" | "aop-panel" | "fallback-5";

export type DecorBakeRect = { x: number; y: number; width: number; height: number };

export function resolveDecorBakeBleedSpec(opts: {
  kind?: "flat" | "tote" | "aop" | "default";
  printFile?: { width: number; height: number } | null;
  opening?: DecorBakeRect | null;
}): {
  kind: DecorBakeBleedKind;
  fillRect: DecorBakeRect;
  subjectRect: DecorBakeRect;
  canvas: { width: number; height: number };
} {
  const pf = opts.printFile;
  if (pf && pf.width > 0 && pf.height > 0) {
    const fillRect = { x: 0, y: 0, width: pf.width, height: pf.height };
    const subjectRect =
      opts.opening && opts.opening.width > 0 && opts.opening.height > 0
        ? opts.opening
        : fillRect;
    const kind: DecorBakeBleedKind =
      opts.kind === "tote" ? "tote-canvas" : opts.kind === "aop" ? "aop-panel" : "print-file";
    return { kind, fillRect, subjectRect, canvas: { width: pf.width, height: pf.height } };
  }
  const opening = opts.opening ?? { x: 0, y: 0, width: 100, height: 100 };
  const mx = opening.width * FALLBACK_OPENING_BLEED_FRACTION;
  const my = opening.height * FALLBACK_OPENING_BLEED_FRACTION;
  const fillRect = {
    x: opening.x - mx,
    y: opening.y - my,
    width: opening.width + mx * 2,
    height: opening.height + my * 2,
  };
  const minX = Math.min(0, fillRect.x);
  const minY = Math.min(0, fillRect.y);
  const maxX = Math.max(opening.x + opening.width, fillRect.x + fillRect.width);
  const maxY = Math.max(opening.y + opening.height, fillRect.y + fillRect.height);
  return {
    kind: "fallback-5",
    fillRect,
    subjectRect: opening,
    canvas: { width: Math.ceil(maxX - minX), height: Math.ceil(maxY - minY) },
  };
}

/** Same hex preview and bake read — flat placer wins, then persisted picker. */
export function resolveDesignLiveFillHex(designState: {
  flatPlacerState?: { backgroundColor?: string | null } | null;
  decorBackgroundFill?: unknown;
  aopPlacementSettings?: { bgColor?: string | null } | null;
} | null | undefined): string | null {
  return (
    parseLiveFillHex(designState?.flatPlacerState?.backgroundColor) ??
    parseLiveFillHex(designState?.decorBackgroundFill) ??
    parseLiveFillHex(designState?.aopPlacementSettings?.bgColor)
  );
}

/**
 * One fill gate: floating style + decor product + GPT-Image-2 native alpha.
 * Minimalist (GPT on decor) qualifies as floating here; Nano Minimalist does not.
 */
export function isDecorFloatingNativeFillPath(opts: {
  isApparelProduct?: boolean;
  isApparelGeneration?: boolean;
  generationModel?: string | null;
  outputMode?: string | null;
  catalogSlug?: string | null;
}): boolean {
  if (opts.isApparelProduct === true || opts.isApparelGeneration === true) return false;
  if (!isGptImage2Model(opts.generationModel)) return false;
  if (isFloatingCatalogStyle({ outputMode: opts.outputMode, catalogSlug: opts.catalogSlug })) {
    return true;
  }
  return String(opts.catalogSlug || "").trim().toLowerCase() === "minimal-line";
}

export function isApparelDesignerType(designerType?: string | null): boolean {
  const dt = (designerType || "").toLowerCase();
  return dt === "apparel" || dt === "all-over-print";
}

/**
 * Bake can flatten a hex under floating art: print-file (pillow/poster/
 * tapestry), tote-canvas, mug wrap. Not hoodie/mesh PatternCustomizer
 * (separate bgColor/trim) or phone edge-wrap (its own canvas fill).
 */
export function productBakeSupportsDecorFill(opts: {
  designerType?: string | null;
  isApparelProduct?: boolean;
  useAopCustomizer?: boolean;
  edgeWrapMode?: boolean;
}): boolean {
  if (opts.useAopCustomizer === true) return false;
  if (opts.edgeWrapMode === true) return false;
  const dt = String(opts.designerType || "").toLowerCase();
  if (dt === "apparel") return false;
  // Hoodie/tee imported as generic still look like apparel — no this picker.
  // Pillow / framed / mug stay eligible even if a size heuristic misfires.
  if (
    opts.isApparelProduct === true &&
    dt !== "pillow" &&
    dt !== "framed-print" &&
    dt !== "mug"
  ) {
    return false;
  }
  return true;
}

/**
 * Storefront picker + generate-payload gate. Style must be floating (or
 * Minimalist GPT). Product must have a hex-fill bake. Resolves catalog slug
 * from name when the client only has a numeric merchant style id.
 */
export function shouldShowDecorFloatingFill(opts: {
  isApparelProduct?: boolean;
  designerType?: string | null;
  outputMode?: string | null;
  catalogSlug?: string | null;
  styleName?: string | null;
  styleId?: string | null;
  generationModel?: string | null;
  useAopCustomizer?: boolean;
  edgeWrapMode?: boolean;
}): boolean {
  if (!productBakeSupportsDecorFill(opts)) return false;
  const slug =
    resolveCatalogSlug({
      catalogSlug: opts.catalogSlug,
      name: opts.styleName,
      category: null,
    }) ||
    opts.catalogSlug ||
    opts.styleId ||
    null;
  const floating = isFloatingCatalogStyle({
    outputMode: opts.outputMode,
    catalogSlug: slug,
  });
  return isDecorFloatingNativeFillPath({
    isApparelProduct: false,
    catalogSlug: slug,
    outputMode: opts.outputMode,
    generationModel: floating
      ? opts.generationModel || GENERATION_MODEL_GPT_IMAGE_2
      : opts.generationModel,
  });
}

/** Floating styles on decor always use GPT-Image-2 (native alpha for composite fill). */
export function resolveStyleGenerationForProduct(
  style: {
    generationModel?: string | null;
    generationQuality?: string | null;
    outputMode?: string | null;
    catalogSlug?: string | null;
  } | null,
  designerType?: string | null,
) {
  const generationModel = isFloatingCatalogStyle(style)
    ? GENERATION_MODEL_GPT_IMAGE_2
    : style?.generationModel;
  return resolveStyleGeneration({
    generationModel,
    generationQuality: style?.generationQuality,
  });
}
