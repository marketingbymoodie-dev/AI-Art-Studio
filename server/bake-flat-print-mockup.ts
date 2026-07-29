/**
 * Bake a full-bleed flat print file for Printers Mockup (same geometry as
 * order fulfillment). Hosts the PNG and returns a fetchable URL for Printify.
 */
import {
  bakeFlatPrintFile,
  persistBakedPrintFile,
  type FlatPlacement,
} from "./flat-print-file";
import {
  resolveFlatBakePlacementRect,
  resolveFlatPrintFileDims,
  type FlatCalibrationManifest,
} from "./flat-calibration";

type ViewName = "front" | "back";

function parseJson<T>(raw: unknown, fallback: T): T {
  if (raw == null) return fallback;
  if (typeof raw === "object") return raw as T;
  if (typeof raw !== "string") return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function normalizeBg(hex: unknown): string | null {
  if (typeof hex !== "string") return null;
  const t = hex.trim();
  return /^#[0-9a-fA-F]{6}$/.test(t) ? t : null;
}

function normalizePlacement(raw: unknown): FlatPlacement {
  const p = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    scale: Number(p.scale ?? 1) || 1,
    offsetX: Number(p.offsetX ?? 0) || 0,
    offsetY: Number(p.offsetY ?? 0) || 0,
    rotationDeg: Number(p.rotationDeg ?? 0) || 0,
  };
}

export type BakeFlatPrintForMockupArgs = {
  productTypeId: number;
  productType: {
    id: number;
    flatCalibration?: unknown;
  };
  artworkUrl: string;
  sizeId?: string;
  colorId?: string;
  view?: string;
  placement?: unknown;
  backgroundColor?: unknown;
  /** Absolute base for relative /objects/ artwork URLs. */
  publicOrigin?: string;
};

export type BakeFlatPrintForMockupResult =
  | { ok: true; url: string; width: number; height: number }
  | { ok: false; error: string };

/**
 * Bake placement + optional background onto printFileDims and host the file.
 * Caller submits the returned URL to Printify at scale=1, center.
 */
export async function bakeFlatPrintForMockup(
  args: BakeFlatPrintForMockupArgs,
): Promise<BakeFlatPrintForMockupResult> {
  const manifest = parseJson<FlatCalibrationManifest | null>(
    args.productType.flatCalibration,
    null,
  );
  if (!manifest?.views || Object.keys(manifest.views).length === 0) {
    return { ok: false, error: "Product has no flat calibration to bake a print file" };
  }

  const view = (args.view === "back" ? "back" : "front") as ViewName;
  const sizeId = String(args.sizeId || "").trim() || undefined;
  const colorId = String(args.colorId || "").trim() || undefined;
  const dims = resolveFlatPrintFileDims(manifest, view, {
    sizeId,
    frameColorId: colorId,
  });
  if (!dims?.width || !dims.height) {
    return { ok: false, error: `No printFileDims for view=${view}` };
  }

  let artworkUrl = String(args.artworkUrl || "").trim();
  if (!artworkUrl) {
    return { ok: false, error: "artworkUrl required" };
  }
  if (artworkUrl.startsWith("/") && args.publicOrigin) {
    artworkUrl = `${args.publicOrigin.replace(/\/$/, "")}${artworkUrl}`;
  }
  if (
    !artworkUrl.startsWith("http://") &&
    !artworkUrl.startsWith("https://") &&
    !artworkUrl.startsWith("data:")
  ) {
    return { ok: false, error: "artworkUrl must be https, /objects/, or data:" };
  }

  const placement = normalizePlacement(args.placement);
  const backgroundColor = normalizeBg(args.backgroundColor);
  const placementRect =
    resolveFlatBakePlacementRect(manifest, view, {
      sizeId,
      frameColorId: colorId,
    }) ?? undefined;

  try {
    const baked = await bakeFlatPrintFile({
      artworkUrl,
      placement,
      printFileDims: dims,
      placementRect,
      backgroundColor,
    });
    const designKey = `mockup-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const url = await persistBakedPrintFile(
      args.productType.id,
      designKey,
      view,
      baked.buffer,
    );
    if (!url) {
      return {
        ok: false,
        error:
          "Could not host baked print file — Supabase flat-calibration bucket is not configured",
      };
    }
    return { ok: true, url, width: baked.width, height: baked.height };
  } catch (err: any) {
    return {
      ok: false,
      error: err?.message || "Failed to bake print file for mockup",
    };
  }
}
