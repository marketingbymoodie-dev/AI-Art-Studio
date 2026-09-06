/**
 * Storefront design-upload helpers: 429 handling, persist-kick gate,
 * per-panel reuse, and small-batch hosting. Used by embed-design persist.
 */

export type AopPanelPersistStatus =
  | "none"
  | "saving"
  | "saved"
  | "error"
  | "rateLimited";

/** Cold-start kick only. Never loop after a failed or rate-limited persist. */
export function shouldKickAopPersist(
  status: AopPanelPersistStatus,
  kickAlreadyAttempted: boolean,
): boolean {
  if (kickAlreadyAttempted) return false;
  if (status === "saved" || status === "error" || status === "rateLimited") {
    return false;
  }
  return status === "none" || status === "saving";
}

export class UploadRateLimitedError extends Error {
  readonly retryAfterSec: number;
  constructor(retryAfterSec: number) {
    const sec = Math.max(1, Math.round(retryAfterSec));
    super(`Try again in ${sec} second${sec === 1 ? "" : "s"}`);
    this.name = "UploadRateLimitedError";
    this.retryAfterSec = sec;
  }
}

export function isUploadRateLimitedError(err: unknown): err is UploadRateLimitedError {
  return err instanceof UploadRateLimitedError;
}

export function parseRetryAfterSec(
  headerValue: string | null | undefined,
  body?: unknown,
): number {
  if (headerValue) {
    const n = parseInt(headerValue, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  if (body && typeof body === "object" && body !== null) {
    const rec = body as { retryAfter?: unknown; retryAfterSec?: unknown };
    const n = Number(rec.retryAfterSec ?? rec.retryAfter);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 60;
}

export type HostedPrintPanel = {
  position: string;
  url: string;
  hash: string;
};

export type PrintPanelInput = {
  position: string;
  dataUrl: string;
};

/** Cheap stable fingerprint — length + sampled djb2. Not cryptographic. */
export function hashPanelDataUrl(dataUrl: string): string {
  let h = 5381;
  const step = Math.max(1, Math.floor(dataUrl.length / 256));
  for (let i = 0; i < dataUrl.length; i += step) {
    h = ((h << 5) + h) ^ dataUrl.charCodeAt(i);
  }
  return `${dataUrl.length}:${h >>> 0}`;
}

function isHostedHttpUrl(url: string): boolean {
  return url.startsWith("https://") || url.startsWith("http://");
}

export function findReusableHostedPanel(
  previous: HostedPrintPanel[] | null | undefined,
  position: string,
  hash: string,
): HostedPrintPanel | null {
  if (!previous?.length || !hash) return null;
  const found = previous.find((p) => p.position === position);
  if (!found?.hash || found.hash !== hash) return null;
  if (!found.url || !isHostedHttpUrl(found.url)) return null;
  return found;
}

export function mergeHostedPrintPanels(
  previous: HostedPrintPanel[] | null | undefined,
  next: HostedPrintPanel[],
): HostedPrintPanel[] {
  const map = new Map((previous ?? []).map((p) => [p.position, p]));
  for (const p of next) map.set(p.position, p);
  return [...map.values()];
}

export function hasReusableHostedPrintSet(
  previous: HostedPrintPanel[] | null | undefined,
  positions: string[],
): boolean {
  if (!previous?.length || !positions.length) return false;
  return positions.every((pos) => {
    const found = previous.find((p) => p.position === pos);
    return !!(found?.url && isHostedHttpUrl(found.url));
  });
}

export const PRINT_PANEL_UPLOAD_BATCH_SIZE = 2;

export type HostPrintPanelsResult = {
  hosted: HostedPrintPanel[];
  failedPositions: string[];
  uploadsAttempted: number;
  rateLimited?: { retryAfterSec: number };
};

/**
 * Reuse unchanged panel URLs; upload the rest in batches of 2.
 * Stops the remaining queue on the first 429; keeps successes (including
 * the other file in a half-finished batch).
 */
export async function hostPrintPanelsBatched(opts: {
  panels: PrintPanelInput[];
  previous?: HostedPrintPanel[] | null;
  host: (dataUrl: string) => Promise<string>;
  batchSize?: number;
}): Promise<HostPrintPanelsResult> {
  const batchSize = Math.max(1, opts.batchSize ?? PRINT_PANEL_UPLOAD_BATCH_SIZE);
  const hosted: HostedPrintPanel[] = [];
  const toUpload: Array<PrintPanelInput & { hash: string }> = [];

  for (const panel of opts.panels) {
    const hash = hashPanelDataUrl(panel.dataUrl);
    const reused = findReusableHostedPanel(opts.previous, panel.position, hash);
    if (reused) {
      hosted.push({ position: panel.position, url: reused.url, hash });
    } else {
      toUpload.push({ ...panel, hash });
    }
  }

  let uploadsAttempted = 0;
  for (let i = 0; i < toUpload.length; i += batchSize) {
    const batch = toUpload.slice(i, i + batchSize);
    const settled = await Promise.allSettled(
      batch.map(async (panel) => {
        uploadsAttempted += 1;
        const url = await opts.host(panel.dataUrl);
        return { position: panel.position, url, hash: panel.hash };
      }),
    );
    let rateLimited: { retryAfterSec: number } | undefined;
    let otherError: unknown;
    for (let j = 0; j < settled.length; j++) {
      const row = settled[j];
      if (row.status === "fulfilled") {
        hosted.push(row.value);
        continue;
      }
      if (isUploadRateLimitedError(row.reason)) {
        rateLimited = { retryAfterSec: row.reason.retryAfterSec };
      } else if (!otherError) {
        otherError = row.reason;
      }
    }
    if (rateLimited) {
      const failedPositions = toUpload
        .slice(i)
        .map((p) => p.position)
        .filter((pos) => !hosted.some((h) => h.position === pos));
      return { hosted, failedPositions, uploadsAttempted, rateLimited };
    }
    if (otherError) throw otherError;
  }

  return { hosted, failedPositions: [], uploadsAttempted };
}
