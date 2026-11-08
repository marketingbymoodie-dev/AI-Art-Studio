/**
 * My Pet Printify handoff retries. The paid-order webhook answers 200 before
 * Printify is called, so a rejected submit is not replayed by Shopify.
 * Attempts wait 1m, 5m, 30m, then 2h. Each attempt mints a new signed URL.
 * The bucket path is what we store.
 */
import { pool } from "./db";
import { signedLibraryUrl } from "./mockup-library-store";

const TAG = "[my-pet-printify]";

export const PET_PRINTIFY_RETRY_DELAYS_MS = [
  60 * 1000,
  5 * 60 * 1000,
  30 * 60 * 1000,
  2 * 60 * 60 * 1000,
] as const;

export function nextPetRetryDelayMs(attempt: number): number | null {
  const delay = PET_PRINTIFY_RETRY_DELAYS_MS[attempt - 1];
  return typeof delay === "number" ? delay : null;
}

export function petFailureIsRetryable(message: string): boolean {
  if (/no stored edited artwork|has no print path|no productTypeId|product type .* not found|missing Printify credentials|tenant check failed|REFUSED/i.test(message)) {
    return false;
  }
  return true;
}

export function planMyPetRetry(attemptJustCompleted: number, retryable: boolean): {
  status: "retrying" | "failed";
  attempt: number;
  delayMs: number | null;
} {
  const attempt = attemptJustCompleted + 1;
  if (!retryable) return { status: "failed", attempt, delayMs: null };
  const delayMs = nextPetRetryDelayMs(attempt);
  if (delayMs == null) return { status: "failed", attempt, delayMs: null };
  return { status: "retrying", attempt, delayMs };
}

type HandoffSnapshot = {
  shopifyOrder: unknown;
  lines: unknown;
  sendToProduction: boolean;
  addressTo: unknown;
  idempotencyKey: string;
  isTest: boolean;
  allowShoplessOrder: boolean;
  shippingMethod: number;
};

type SubmissionMeta = {
  retry?: HandoffSnapshot;
  founderAlerted?: boolean;
  [key: string]: unknown;
};

export type MyPetPrintifyCard = {
  status: string;
  attempts: number;
  lastError: string | null;
  nextAttemptAt: string | null;
  printifyOrderId: string | null;
  canResubmit: boolean;
  files: Array<{ key: string; path: string; previewUrl: string | null }>;
};

async function emailFounderTerminalFailure(args: {
  shop: string | null;
  shopifyOrderId: string | null;
  idempotencyKey: string;
  attempts: number;
  error: string;
}): Promise<void> {
  const to = process.env.FOUNDER_ALERT_EMAIL?.trim();
  const resendKey = process.env.RESEND_API_KEY;
  if (!to || !resendKey) {
    console.warn(`${TAG} FOUNDER_ALERT_EMAIL or RESEND_API_KEY not set — skipping alert`);
    return;
  }
  const from =
    process.env.SUPPORT_EMAIL_FROM ||
    process.env.CREATOR_EMAIL_FROM ||
    process.env.RESEND_FROM ||
    "AI Art Studio <onboarding@resend.dev>";
  const text = [
    "A My Pet order was not submitted to Printify after the last retry.",
    `Shop: ${args.shop || "(unknown)"}`,
    `Shopify order: ${args.shopifyOrderId || "(none)"}`,
    `Attempts: ${args.attempts}`,
    `Key: ${args.idempotencyKey}`,
    "",
    args.error,
  ].join("\n");
  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject: `[AppAI] My Pet Printify handoff failed — order ${args.shopifyOrderId || args.idempotencyKey}`,
        text,
      }),
    });
    if (!resp.ok) console.error(`${TAG} Resend ${resp.status}:`, await resp.text());
  } catch (err: any) {
    console.error(`${TAG} email failed:`, err?.message || err);
  }
}

function parseMeta(raw: unknown): SubmissionMeta {
  if (!raw) return {};
  if (typeof raw === "string") {
    try { return JSON.parse(raw) as SubmissionMeta; } catch { return {}; }
  }
  if (typeof raw === "object") return raw as SubmissionMeta;
  return {};
}

function parsePaths(raw: unknown): Record<string, string> {
  const value = typeof raw === "string" ? (() => { try { return JSON.parse(raw); } catch { return {}; } })() : raw;
  if (!value || typeof value !== "object") return {};
  const out: Record<string, string> = {};
  for (const [key, path] of Object.entries(value as Record<string, unknown>)) {
    if (typeof path === "string" && path && !path.startsWith("http")) out[key] = path;
  }
  return out;
}

export async function readMyPetHandoffRow(idempotencyKey: string): Promise<{
  attemptCount: number;
  metadata: SubmissionMeta;
} | null> {
  const result = await pool.query<{ attempt_count: number | null; metadata: unknown }>(
    `SELECT attempt_count, metadata FROM flat_order_submissions WHERE idempotency_key = $1 LIMIT 1`,
    [idempotencyKey],
  );
  const row = result.rows[0];
  if (!row) return null;
  return { attemptCount: Number(row.attempt_count) || 0, metadata: parseMeta(row.metadata) };
}

export async function alertMyPetHandoffFailed(args: {
  shop: string | null;
  shopifyOrderId: string | null;
  idempotencyKey: string;
  attempts: number;
  error: string;
  alreadyAlerted: boolean;
}): Promise<boolean> {
  if (args.alreadyAlerted) return false;
  await emailFounderTerminalFailure(args);
  return true;
}

export async function lookupMyPetPrintifySubmission(shopifyOrderId: string | null): Promise<MyPetPrintifyCard | null> {
  if (!shopifyOrderId) return null;
  const preferred = `shopify-order-fulfill:${shopifyOrderId}`;
  const result = await pool.query<{
    status: string;
    attempt_count: number | null;
    error: string | null;
    next_attempt_at: Date | null;
    printify_order_id: string | null;
    print_file_paths: unknown;
    metadata: unknown;
  }>(
    `SELECT status, attempt_count, error, next_attempt_at, printify_order_id, print_file_paths, metadata
     FROM flat_order_submissions
     WHERE shopify_order_id = $1
     ORDER BY (idempotency_key = $2) DESC, updated_at DESC
     LIMIT 1`,
    [shopifyOrderId, preferred],
  );
  const row = result.rows[0];
  if (!row) return null;
  const meta = parseMeta(row.metadata);
  const paths = parsePaths(row.print_file_paths);
  const files = await Promise.all(Object.entries(paths).map(async ([key, path]) => {
    let previewUrl: string | null = null;
    try { previewUrl = await signedLibraryUrl(path); } catch { previewUrl = null; }
    return { key, path, previewUrl };
  }));
  return {
    status: row.status,
    attempts: Number(row.attempt_count) || 0,
    lastError: row.error,
    nextAttemptAt: row.next_attempt_at ? new Date(row.next_attempt_at).toISOString() : null,
    printifyOrderId: row.printify_order_id,
    canResubmit: row.status !== "submitted" && row.status !== "submitting" && !!meta.retry,
    files,
  };
}

export async function resubmitMyPetPrintify(shop: string, shopifyOrderId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const preferred = `shopify-order-fulfill:${shopifyOrderId}`;
  const result = await pool.query<{
    id: number;
    status: string;
    shop: string | null;
    metadata: unknown;
  }>(
    `SELECT id, status, shop, metadata
     FROM flat_order_submissions
     WHERE shopify_order_id = $1
     ORDER BY (idempotency_key = $2) DESC, updated_at DESC
     LIMIT 1`,
    [shopifyOrderId, preferred],
  );
  const row = result.rows[0];
  if (!row) return { ok: false, error: "No Printify submission is stored for this order yet." };
  if (row.shop && row.shop !== shop) return { ok: false, error: "That order belongs to another shop." };
  if (row.status === "submitted") return { ok: false, error: "This order is already submitted to Printify." };
  if (row.status === "submitting") return { ok: false, error: "A Printify submit is already in progress." };
  const meta = parseMeta(row.metadata);
  if (!meta.retry) return { ok: false, error: "This order has no stored payload to resubmit." };
  meta.founderAlerted = false;
  await pool.query(
    `UPDATE flat_order_submissions
     SET status = 'retrying', attempt_count = 0, next_attempt_at = NOW(), error = NULL, metadata = $2::jsonb, updated_at = NOW()
     WHERE id = $1`,
    [row.id, JSON.stringify(meta)],
  );
  await runDueMyPetPrintifyRetries();
  return { ok: true };
}

let retryTick: ReturnType<typeof setInterval> | null = null;

export function startMyPetPrintifyRetries(): void {
  if (retryTick) return;
  const tick = () => { void runDueMyPetPrintifyRetries().catch((err) => console.error(`${TAG} tick`, err)); };
  retryTick = setInterval(tick, 30_000);
  if (typeof retryTick.unref === "function") retryTick.unref();
  tick();
}

export async function runDueMyPetPrintifyRetries(): Promise<void> {
  const due = await pool.query<{ id: number; metadata: unknown }>(
    `WITH due AS (
       SELECT id FROM flat_order_submissions
       WHERE status = 'retrying' AND next_attempt_at IS NOT NULL AND next_attempt_at <= NOW()
       ORDER BY next_attempt_at
       LIMIT 3
       FOR UPDATE SKIP LOCKED
     )
     UPDATE flat_order_submissions AS s
     SET status = 'submitting', updated_at = NOW()
     FROM due
     WHERE s.id = due.id
     RETURNING s.id, s.metadata`,
  );
  if (!due.rows.length) return;
  const { submitFlatOrderToPrintify } = await import("./flat-order-fulfillment");
  for (const row of due.rows) {
    const meta = parseMeta(row.metadata);
    const snapshot = meta.retry;
    if (!snapshot) {
      await pool.query(
        `UPDATE flat_order_submissions SET status = 'failed', error = $2, updated_at = NOW() WHERE id = $1`,
        [row.id, "Retry had no stored order payload"],
      );
      continue;
    }
    try {
      await submitFlatOrderToPrintify({
        shopifyOrder: snapshot.shopifyOrder,
        lines: snapshot.lines as any,
        sendToProduction: snapshot.sendToProduction,
        addressTo: snapshot.addressTo as any,
        idempotencyKey: snapshot.idempotencyKey,
        isTest: snapshot.isTest,
        allowShoplessOrder: snapshot.allowShoplessOrder,
        shippingMethod: snapshot.shippingMethod,
        resumeRetry: true,
      });
    } catch (err: any) {
      console.error(`${TAG} retry crashed`, err?.message || err);
    }
  }
}
