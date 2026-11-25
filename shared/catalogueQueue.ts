import { catalogueJobLabel } from "./cataloguePublish";

/** A publish still moving through print, listing, mockups, or Shopify. */
const ACTIVE_PHASE = new Set(["queued", "print", "listing", "mockups", "shopify"]);

export type CatalogueQueueTab = "pending" | "done" | "all";

export const CATALOGUE_QUEUE_PAGE_SIZE = 40;

export const CATALOGUE_QUEUE_TAB_KEY = "catalogue-studio-queue-tab";

/**
 * A live Shopify listing counts as done, and so does a finished publish job.
 * A job that is still running stays pending so the operator can watch it.
 */
export function catalogueQueueIsDone(row: { phase: string; listed: boolean }): boolean {
  if (ACTIVE_PHASE.has(row.phase)) return false;
  return row.listed || row.phase === "done";
}

/** Queue suffix. A listing wins over a missing or failed job once work has stopped. */
export function catalogueQueueLabel(phase: string, error: string, listed: boolean): string {
  if (catalogueQueueIsDone({ phase, listed })) return "Done";
  return catalogueJobLabel(phase, error);
}

/** Pending, approved, and promoted designs can still change wording, ticks, and My Pet. */
export function catalogueDesignCanBeEdited(status: string | null | undefined): boolean {
  return status === "pending" || status === "approved" || status === "promoted";
}

export function readCatalogueQueueTab(stored: string | null | undefined): CatalogueQueueTab {
  return stored === "done" || stored === "all" ? stored : "pending";
}

export function catalogueQueueCounts(rows: Array<{ done: boolean }>): Record<CatalogueQueueTab, number> {
  const done = rows.filter((row) => row.done).length;
  return { pending: rows.length - done, done, all: rows.length };
}

export function filterCatalogueQueue<T extends { title: string; punchline?: string; done: boolean }>(
  rows: T[],
  tab: CatalogueQueueTab,
  query: string,
): T[] {
  const needle = query.trim().toLowerCase();
  return rows.filter((row) => {
    if (tab === "pending" && row.done) return false;
    if (tab === "done" && !row.done) return false;
    if (!needle) return true;
    return `${row.title} ${row.punchline || ""}`.toLowerCase().includes(needle);
  });
}

export function catalogueQueuePage<T>(rows: T[], page: number, pageSize = CATALOGUE_QUEUE_PAGE_SIZE): {
  page: number;
  pages: number;
  rows: T[];
} {
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const current = Math.min(Math.max(1, page), pages);
  const start = (current - 1) * pageSize;
  return { page: current, pages, rows: rows.slice(start, start + pageSize) };
}

/**
 * What a status repair would do. A running job is left alone.
 * A listing with no job row is counted as done by the queue and is not inserted here.
 */
export function catalogueStatusRepair(row: {
  shopifyProductId: string | null | undefined;
  jobStatus: string | null | undefined;
  jobPhase: string | null | undefined;
}): "unchanged" | "set-job-done" | "no-job-row" | "in-progress" {
  if (!String(row.shopifyProductId || "").trim()) return "unchanged";
  const status = String(row.jobStatus || "");
  if (status === "queued" || status === "running") return "in-progress";
  if (!status) return "no-job-row";
  if (status === "done" && String(row.jobPhase || "") === "done") return "unchanged";
  return "set-job-done";
}
