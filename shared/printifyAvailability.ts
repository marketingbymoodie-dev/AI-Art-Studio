/**
 * Pure aggregation for the daily Printify catalogue OOS scan
 * (server/oos-catalogue-report.ts). Given a raw Printify catalog
 * `variants.json?show-out-of-stock=1` response and the set of Printify
 * variant IDs a product type actually sells (its selected size/color
 * combinations), compute an at-a-glance stock status.
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
  /** Selected Printify variant ids the catalog response didn't return at all (treated as OOS — safer default than assuming available). */
  missingFromCatalog: number;
  status: VariantAvailabilityStatus;
  /** Human-readable labels for a sample of unavailable variants (capped), for the digest email. */
  unavailableLabels: string[];
};

export const DEFAULT_CRITICAL_OOS_RATIO = 0.9;
const MAX_SAMPLE_LABELS = 5;

/**
 * Summarize stock for the variants a product type actually sells.
 * `status` is "fully_oos" when nothing is available, "critical" when the
 * out-of-stock ratio meets `criticalRatio` (default 90%), otherwise "ok".
 * "unknown" means there were no selected variants to check.
 */
export function summarizeVariantAvailability(args: {
  catalogVariants: PrintifyCatalogVariantAvailability[];
  selectedPrintifyVariantIds: Array<number | string>;
  labelsByPrintifyVariantId?: Record<string, string>;
  criticalRatio?: number;
}): VariantAvailabilitySummary {
  const {
    catalogVariants,
    selectedPrintifyVariantIds,
    labelsByPrintifyVariantId = {},
    criticalRatio = DEFAULT_CRITICAL_OOS_RATIO,
  } = args;

  const availabilityById = new Map<number, boolean>();
  for (const v of catalogVariants) {
    if (v?.id == null) continue;
    const id = Number(v.id);
    if (!Number.isFinite(id)) continue;
    availabilityById.set(id, v.is_available !== false);
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
