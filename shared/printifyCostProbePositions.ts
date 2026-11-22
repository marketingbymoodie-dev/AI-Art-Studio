/**
 * Resolve Printify create-product placeholder names for cost probes.
 *
 * Catalog `variants.json` nested `placeholders[].position` is authoritative
 * for a blueprint/provider. Do not assume "front" — tote 1300 / MWW rejects
 * `Placeholder: front is invalid` (422).
 */
import { ADJUSTABLE_TOTE_BLUEPRINT_ID } from "./productLayoutPolicy";
import { TOTE_FOLDED_V1_TEMPLATE } from "./toteFoldedLayout";

export function extractPlaceholderPositionNames(variants: unknown[]): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const variant of variants) {
    if (!variant || typeof variant !== "object") continue;
    const placeholders = (variant as { placeholders?: unknown }).placeholders;
    if (!Array.isArray(placeholders)) continue;
    for (const item of placeholders) {
      if (!item || typeof item !== "object") continue;
      const pos = String((item as { position?: unknown }).position || "").trim();
      if (!pos || seen.has(pos)) continue;
      seen.add(pos);
      names.push(pos);
    }
  }
  return names;
}

/** Persistable `{ position, width, height }` rows from catalog variants. */
export function extractPlaceholderPositionRows(
  variants: unknown[],
): Array<{ position: string; width: number | null; height: number | null }> {
  const byPos = new Map<string, { position: string; width: number | null; height: number | null }>();
  for (const variant of variants) {
    if (!variant || typeof variant !== "object") continue;
    const placeholders = (variant as { placeholders?: unknown }).placeholders;
    if (!Array.isArray(placeholders)) continue;
    for (const item of placeholders) {
      if (!item || typeof item !== "object") continue;
      const p = item as { position?: unknown; width?: unknown; height?: unknown };
      const pos = String(p.position || "").trim();
      if (!pos || byPos.has(pos)) continue;
      const width = typeof p.width === "number" && Number.isFinite(p.width) ? p.width : null;
      const height = typeof p.height === "number" && Number.isFinite(p.height) ? p.height : null;
      byPos.set(pos, { position: pos, width, height });
    }
  }
  return [...byPos.values()];
}

export function parseStoredPlaceholderPositionNames(raw: unknown): string[] {
  let list: unknown = raw;
  if (typeof raw === "string") {
    try {
      list = JSON.parse(raw || "[]");
    } catch {
      return [];
    }
  }
  if (!Array.isArray(list)) return [];
  const names: string[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    const pos =
      typeof item === "string"
        ? item.trim()
        : item && typeof item === "object"
          ? String((item as { position?: unknown }).position || "").trim()
          : "";
    if (!pos || seen.has(pos)) continue;
    seen.add(pos);
    names.push(pos);
  }
  return names;
}

/** Minimal AOP body set so zip/leggings don't 422 on a bare "front". */
export function minimalCostProbePositions(blueprintId: number): string[] | null {
  switch (Number(blueprintId)) {
    case 451:
      return ["front_left", "front_right"];
    case 256:
    case 1050:
      return ["left_side", "right_side"];
    case 450:
      return ["front"];
    default:
      return null;
  }
}

export type CostProbePositionResolveArgs = {
  blueprintId: number;
  catalogPositions: string[];
  storedPositions?: string[];
  isAllOverPrint?: boolean;
  fulfillmentLayout?: string | null;
};

/**
 * Build ordered print_areas position attempts for a temp cost-probe product.
 * Never invents "front" when the catalog/stored list has a different name.
 */
export function resolveCostProbePositionAttempts(
  args: CostProbePositionResolveArgs,
): { attempts: string[][]; source: "catalog" | "stored" | "minimal" | "dtg_front" | "none"; actualNames: string[] } {
  const catalog = (args.catalogPositions || []).map((s) => String(s || "").trim()).filter(Boolean);
  const stored = (args.storedPositions || []).map((s) => String(s || "").trim()).filter(Boolean);
  const actualNames = catalog.length > 0 ? catalog : stored;
  const source: "catalog" | "stored" | "none" =
    catalog.length > 0 ? "catalog" : stored.length > 0 ? "stored" : "none";

  const attempts: string[][] = [];
  const push = (list: string[] | null | undefined) => {
    if (!list || list.length === 0) return;
    const cleaned = list.map((s) => String(s || "").trim()).filter(Boolean);
    if (cleaned.length === 0) return;
    const key = cleaned.join("|");
    if (!attempts.some((a) => a.join("|") === key)) attempts.push(cleaned);
  };

  const toteFolded =
    args.fulfillmentLayout === TOTE_FOLDED_V1_TEMPLATE ||
    Number(args.blueprintId) === ADJUSTABLE_TOTE_BLUEPRINT_ID;

  const minimal = minimalCostProbePositions(args.blueprintId);
  if (minimal && (actualNames.length === 0 || minimal.every((p) => actualNames.includes(p)))) {
    push(minimal);
  }

  if (toteFolded || args.isAllOverPrint) {
    push(actualNames);
    return {
      attempts,
      source: attempts.length === 0 ? "none" : attempts[0] === minimal ? "minimal" : source,
      actualNames,
    };
  }

  // DTG / standard: front-only when that name exists so sleeves/neck stay off the base probe.
  if (actualNames.includes("front")) {
    push(["front"]);
    return { attempts, source: source === "none" ? "dtg_front" : source, actualNames };
  }
  if (actualNames.length > 0) {
    push([actualNames[0]!]);
    return { attempts, source, actualNames };
  }
  if (minimal) {
    return { attempts, source: attempts.length ? "minimal" : "none", actualNames };
  }
  // Last resort for DTG when catalog placeholders were omitted (common on some tees).
  push(["front"]);
  return { attempts, source: "dtg_front", actualNames };
}
