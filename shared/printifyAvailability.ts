/**
 * Pure aggregation for the daily Printify catalogue OOS scan
 * (server/oos-catalogue-report.ts).
 *
 * Printify's catalog variants endpoint documents stock via list membership:
 * - default / show-out-of-stock=0 → in-stock variants only
 * - show-out-of-stock=1 → all variants (incl. OOS)
 * Catalog rows often omit `is_available` entirely (that field is a shop-product
 * property). Never treat missing `is_available` as in-stock.
 */

export type PrintifyCatalogVariantAvailability = {
  id?: number | string | null;
  is_available?: boolean;
};

export type VariantAvailabilityStatus = "ok" | "critical" | "fully_oos" | "unknown";

export type VariantAvailabilitySummary = {
  totalSelected: number;
  availableSelected: number;
  unavailableSelected: number;
  /** Selected Printify variant ids not present in the all-variants catalog list. */
  missingFromCatalog: number;
  status: VariantAvailabilityStatus;
  /** Human-readable labels for a sample of unavailable variants (capped), for the digest email. */
  unavailableLabels: string[];
};

export const DEFAULT_CRITICAL_OOS_RATIO = 0.9;
const MAX_SAMPLE_LABELS = 5;

function toIdSet(ids: Iterable<number | string> | undefined): Set<number> {
  const out = new Set<number>();
  if (!ids) return out;
  for (const raw of ids) {
    const id = Number(raw);
    if (Number.isFinite(id) && id > 0) out.add(id);
  }
  return out;
}

/**
 * Summarize stock for the variants a product type actually sells.
 *
 * Prefer `availablePrintifyVariantIds` (IDs returned by Printify's in-stock-only
 * catalog list). When provided, membership in that set is the availability
 * signal. `catalogVariants` (typically from show-out-of-stock=1) is used only
 * to distinguish "listed but OOS" vs "missing from this provider's catalog".
 *
 * Without `availablePrintifyVariantIds`, fall back to explicit
 * `is_available === true` only — never treat omitted `is_available` as in stock.
 */
export function summarizeVariantAvailability(args: {
  catalogVariants: PrintifyCatalogVariantAvailability[];
  selectedPrintifyVariantIds: Array<number | string>;
  /** IDs from Printify's in-stock-only catalog response (preferred signal). */
  availablePrintifyVariantIds?: Array<number | string>;
  labelsByPrintifyVariantId?: Record<string, string>;
  criticalRatio?: number;
}): VariantAvailabilitySummary {
  const {
    catalogVariants,
    selectedPrintifyVariantIds,
    availablePrintifyVariantIds,
    labelsByPrintifyVariantId = {},
    criticalRatio = DEFAULT_CRITICAL_OOS_RATIO,
  } = args;

  const inStockIds = availablePrintifyVariantIds
    ? toIdSet(availablePrintifyVariantIds)
    : null;

  const listedIds = new Set<number>();
  const availabilityById = new Map<number, boolean>();
  for (const v of catalogVariants) {
    if (v?.id == null) continue;
    const id = Number(v.id);
    if (!Number.isFinite(id)) continue;
    listedIds.add(id);
    if (inStockIds) {
      availabilityById.set(id, inStockIds.has(id));
    } else {
      // Strict: only explicit true counts as available when no in-stock list was provided.
      availabilityById.set(id, v.is_available === true);
    }
  }

  // In-stock IDs that somehow weren't in the all-variants list still count as available.
  if (inStockIds) {
    for (const id of inStockIds) {
      if (!availabilityById.has(id)) availabilityById.set(id, true);
      listedIds.add(id);
    }
  }

  const selectedIds = Array.from(
    new Set(
      selectedPrintifyVariantIds
        .map((id) => Number(id))
        .filter((id) => Number.isFinite(id) && id > 0),
    ),
  );
  const totalSelected = selectedIds.length;

  if (totalSelected === 0) {
    return {
      totalSelected: 0,
      availableSelected: 0,
      unavailableSelected: 0,
      missingFromCatalog: 0,
      status: "unknown",
      unavailableLabels: [],
    };
  }

  let availableSelected = 0;
  let missingFromCatalog = 0;
  const unavailableLabels: string[] = [];

  for (const id of selectedIds) {
    if (inStockIds) {
      if (inStockIds.has(id)) {
        availableSelected += 1;
        continue;
      }
      if (!listedIds.has(id)) {
        missingFromCatalog += 1;
        if (unavailableLabels.length < MAX_SAMPLE_LABELS) {
          unavailableLabels.push(labelsByPrintifyVariantId[String(id)] ?? `variant ${id} (removed)`);
        }
        continue;
      }
      if (unavailableLabels.length < MAX_SAMPLE_LABELS) {
        unavailableLabels.push(labelsByPrintifyVariantId[String(id)] ?? `variant ${id}`);
      }
      continue;
    }

    const isAvailable = availabilityById.get(id);
    if (isAvailable === undefined) {
      missingFromCatalog += 1;
      if (unavailableLabels.length < MAX_SAMPLE_LABELS) {
        unavailableLabels.push(labelsByPrintifyVariantId[String(id)] ?? `variant ${id} (removed)`);
      }
      continue;
    }
    if (isAvailable) {
      availableSelected += 1;
    } else if (unavailableLabels.length < MAX_SAMPLE_LABELS) {
      unavailableLabels.push(labelsByPrintifyVariantId[String(id)] ?? `variant ${id}`);
    }
  }

  const unavailableSelected = totalSelected - availableSelected - missingFromCatalog;
  const oosCount = unavailableSelected + missingFromCatalog;
  const oosRatio = oosCount / totalSelected;

  let status: VariantAvailabilityStatus;
  if (availableSelected === 0) status = "fully_oos";
  else if (oosRatio >= criticalRatio) status = "critical";
  else status = "ok";

  return {
    totalSelected,
    availableSelected,
    unavailableSelected,
    missingFromCatalog,
    status,
    unavailableLabels,
  };
}

/** Extract numeric variant ids from a Printify catalog variants.json payload. */
export function extractCatalogVariantIds(variants: PrintifyCatalogVariantAvailability[]): number[] {
  const ids: number[] = [];
  for (const v of variants) {
    if (v?.id == null) continue;
    const id = Number(v.id);
    if (Number.isFinite(id) && id > 0) ids.push(id);
  }
  return ids;
}
