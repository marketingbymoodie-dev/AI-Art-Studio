/**
 * Customer reference photos (pet / owner) for style-pack generations.
 * PRIVATE Supabase bucket; clients only ever see short-lived signed URLs, and
 * every path is re-validated against the requesting shop before signing.
 * Retention policy: docs/customer-reference-images.md.
 *
 * Path: <shop>/<jobId>/<index>-<role>.<ext>
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const SIGNED_URL_SECONDS = 60 * 60;

let _client: SupabaseClient | null | undefined;
function client(): SupabaseClient | null {
  if (_client !== undefined) return _client;
  const url = process.env.SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  _client = url && key ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
  return _client;
}

export function customerReferencesBucket(): string {
  return process.env.SUPABASE_CUSTOMER_REFERENCES_BUCKET ?? "customer-references";
}

let bucketReady: Promise<void> | null = null;
function ensureBucket(c: SupabaseClient): Promise<void> {
  bucketReady ??= (async () => {
    const bucket = customerReferencesBucket();
    const { data } = await c.storage.getBucket(bucket);
    if (data) {
      if (data.public) throw new Error(`${bucket} bucket is public — refusing to store customer photos`);
      return;
    }
    const { error } = await c.storage.createBucket(bucket, { public: false, fileSizeLimit: "10MB" });
    if (error && !/already exists/i.test(error.message)) throw new Error(`createBucket failed: ${error.message}`);
  })().catch((e) => {
    bucketReady = null;
    throw e;
  });
  return bucketReady;
}

/** Storage-safe shop segment ("ai-art-studio-staging.myshopify.com"). */
export function shopPathSegment(shop: string): string {
  return shop.trim().toLowerCase().replace(/[^a-z0-9.-]/g, "");
}

/** A path is only ever signed for the shop whose prefix it carries (no traversal, fixed shape). */
export function referencePathBelongsToShop(path: unknown, shop: string): path is string {
  if (typeof path !== "string") return false;
  const prefix = `${shopPathSegment(shop)}/`;
  return (
    !!prefix.slice(0, -1) &&
    path.startsWith(prefix) &&
    !path.includes("..") &&
    /^[a-z0-9.-]+\/[A-Za-z0-9-]+\/\d+-(pet|owner|other)(-[a-f0-9]{8})?\.(png|jpe?g|webp)$/.test(path)
  );
}

const MIME_EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg", "image/webp": "webp" };

/** Upload a data-URL reference photo; returns its storage path (never a URL). */
export async function storeReferenceDataUrl(opts: {
  shop: string;
  jobId: string;
  index: number;
  role: "pet" | "owner" | "other";
  dataUrl: string;
}): Promise<string> {
  const c = client();
  if (!c) throw new Error("Supabase is not configured");
  const m = /^data:(image\/(?:png|jpe?g|webp));base64,(.+)$/i.exec(opts.dataUrl);
  if (!m) throw new Error("reference is not a PNG/JPEG/WebP data URL");
  const mime = m[1].toLowerCase();
  const buf = Buffer.from(m[2], "base64");
  if (buf.length > 10 * 1024 * 1024) throw new Error("reference image too large");
  await ensureBucket(c);
  const jobSegment = String(opts.jobId).replace(/[^A-Za-z0-9-]/g, "");
  const path = `${shopPathSegment(opts.shop)}/${jobSegment}/${opts.index}-${opts.role}-${randomUUID().slice(0, 8)}.${MIME_EXT[mime]}`;
  const { error } = await c.storage.from(customerReferencesBucket()).upload(path, buf, { contentType: mime, upsert: false });
  if (error) throw new Error(`reference upload failed: ${error.message}`);
  return path;
}

/** Short-lived signed URL, only for a path belonging to `shop`. */
export async function signReferencePath(path: string, shop: string): Promise<string | null> {
  if (!referencePathBelongsToShop(path, shop)) return null;
  const c = client();
  if (!c) return null;
  const { data, error } = await c.storage.from(customerReferencesBucket()).createSignedUrl(path, SIGNED_URL_SECONDS);
  return error ? null : data?.signedUrl ?? null;
}

/** Stored brief → client form: each reference gets a fresh signed URL for this shop (or null). */
export async function publicCreativeBrief(
  raw: unknown,
  shop: string | null | undefined,
): Promise<import("@shared/creativeBrief").PublicCreativeBrief | null> {
  const { parseCreativeBrief } = await import("@shared/creativeBrief");
  const brief = parseCreativeBrief(raw);
  if (!brief) return null;
  const referenceImages = await Promise.all(
    brief.referenceImages.map(async (r) => ({ ...r, url: shop ? await signReferencePath(r.path, shop).catch(() => null) : null })),
  );
  return { ...brief, referenceImages };
}
