/**
 * Build printifyVariantId -> human label ("S / Heather Grey") for the size/color
 * combinations a product type actually sells, from its stored variantMap +
 * sizes/colors + selected-id filters. Mirrors the inline builder used by the
 * admin `/api/appai/blanks` endpoint (server/routes.ts), kept standalone here
 * so the OOS catalogue scan (server/oos-catalogue-report.ts) doesn't depend on
 * routes.ts internals.
 */

type SizeOrColorOption = { id?: string; name?: string };

function parseJsonArray(raw: unknown): SizeOrColorOption[] {
  if (!raw) return [];
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return Array.isArray(raw) ? raw : [];
}

function parseJsonStringArray(raw: unknown): string[] {
  if (!raw) return [];
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw || "[]");
      return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
    } catch {
      return [];
    }
  }
  return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string") : [];
}

function parseJsonObject(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw || "{}");
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  if (typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return {};
}

export type ProductTypeVariantMapSource = {
  variantMap?: unknown;
  sizes?: unknown;
  frameColors?: unknown;
  selectedSizeIds?: unknown;
  selectedColorIds?: unknown;
};

/** printifyVariantId (string) -> "Size / Color" (or just "Size" when there's no color axis). */
export function buildActivePrintifyVariantLabels(pt: ProductTypeVariantMapSource): Record<string, string> {
  const storedVm = parseJsonObject(pt.variantMap);
  const allSizes = parseJsonArray(pt.sizes);
  const allColors = parseJsonArray(pt.frameColors);
  const savedSizeIds = parseJsonStringArray(pt.selectedSizeIds);
  const savedColorIds = parseJsonStringArray(pt.selectedColorIds);
  const activeSizes = savedSizeIds.length ? allSizes.filter((s) => savedSizeIds.includes(s.id ?? "")) : allSizes;
  const activeColors = savedColorIds.length ? allColors.filter((c) => savedColorIds.includes(c.id ?? "")) : allColors;
  const activeSizeSet = savedSizeIds.length ? new Set(savedSizeIds) : null;
  const activeColorSet = savedColorIds.length ? new Set(savedColorIds) : null;

  const labels: Record<string, string> = {};
  for (const [key, entry] of Object.entries(storedVm)) {
    const [sizeId, colorId = "default"] = key.split(":");
    if (activeSizeSet && !activeSizeSet.has(sizeId)) continue;
    if (activeColorSet && !activeColorSet.has(colorId)) continue;
    const sizeName = activeSizes.find((s) => s.id === sizeId)?.name ?? allSizes.find((s) => s.id === sizeId)?.name ?? sizeId;
    const colorName = activeColors.find((c) => c.id === colorId)?.name ?? allColors.find((c) => c.id === colorId)?.name;
    const printifyVariantId = (entry as { printifyVariantId?: number | string } | null)?.printifyVariantId;
    if (printifyVariantId == null) continue;
    const vid = String(printifyVariantId);
    labels[vid] = colorName && colorId !== "default" ? `${sizeName} / ${colorName}` : sizeName;
  }
  return labels;
}

/** Printify variant IDs a product type actually sells (from its active variantMap). */
export function extractSelectedPrintifyVariantIds(pt: ProductTypeVariantMapSource): number[] {
  return Object.keys(buildActivePrintifyVariantLabels(pt))
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id) && id > 0);
}
