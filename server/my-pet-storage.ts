/**
 * My Pet's own Supabase bucket — shopper-uploaded pet photos and generated
 * (non-print-ready) previews. Kept separate from the operator's curated
 * `mockup-library` bucket so the 7-day/30-day sweeps only ever touch
 * shopper-submitted content, never catalogue artwork.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const BUCKET = "my-pet";

let clientMemo: SupabaseClient | null | undefined;

function supabase(): SupabaseClient {
  if (clientMemo !== undefined && clientMemo) return clientMemo;
  const url = process.env.SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !key) throw new Error("Supabase is not configured");
  clientMemo = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return clientMemo;
}

async function ensureBucket(): Promise<void> {
  const c = supabase();
  const { data } = await c.storage.getBucket(BUCKET);
  if (data) return;
  const { error } = await c.storage.createBucket(BUCKET, { public: false, fileSizeLimit: "25MB" });
  if (error && !/already exists/i.test(error.message)) throw new Error(error.message);
}

export async function putMyPetObject(path: string, body: Buffer, contentType = "image/png"): Promise<void> {
  await ensureBucket();
  const { error } = await supabase().storage.from(BUCKET).upload(path, body, { contentType, upsert: true });
  if (error) throw new Error(error.message);
}

export async function getMyPetObject(path: string): Promise<Buffer> {
  const { data, error } = await supabase().storage.from(BUCKET).download(path);
  if (error || !data) throw new Error(error?.message || `Missing ${path}`);
  return Buffer.from(await data.arrayBuffer());
}

export async function removeMyPetObjects(paths: string[]): Promise<void> {
  if (!paths.length) return;
  await ensureBucket();
  const { error } = await supabase().storage.from(BUCKET).remove(paths);
  if (error && !/not found/i.test(error.message)) throw new Error(error.message);
}

/**
 * Cheap metadata-only existence probe — no download, no signed URL mint.
 * Used by `recompositeMyPetRender` so a repeat colour swap on an already-
 * composited (renderId, colour) can skip the ~4-5s compose + storage write
 * and just re-sign the existing object, cutting repeat swaps from ~6s to
 * well under 500ms. Returns false rather than throwing on any error so
 * callers can safely fall through to the fresh-compose path.
 */
export async function myPetObjectExists(path: string): Promise<boolean> {
  const idx = path.lastIndexOf("/");
  const dir = idx >= 0 ? path.slice(0, idx) : "";
  const name = idx >= 0 ? path.slice(idx + 1) : path;
  try {
    const { data, error } = await supabase()
      .storage
      .from(BUCKET)
      .list(dir, { limit: 1, search: name });
    if (error || !data) return false;
    return data.some((f) => f.name === name);
  } catch {
    return false;
  }
}

/**
 * Signed URL, re-signed on demand, never persisted as the canonical reference
 * (storagePath/previewPath stay the source of truth). Default 1hr is for URLs
 * consumed immediately in a page response. Callers that bake the URL into a
 * static document that outlives an hour (e.g. the email-save HTML body) MUST
 * pass a longer expiresInSec matching how long that document needs to work —
 * see sendMyPetEmailSave's EMAIL_PREVIEW_RETENTION_MS usage.
 */
export async function signedMyPetUrl(path: string, expiresInSec = 60 * 60): Promise<string> {
  const { data, error } = await supabase().storage.from(BUCKET).createSignedUrl(path, expiresInSec);
  if (error || !data?.signedUrl) throw new Error(error?.message || "Could not sign the stored file");
  return data.signedUrl;
}

/** Square thumb for the designs picker. Falls back to the full preview when image transforms are off. */
export async function signedMyPetThumbnail(path: string, expiresInSec = 60 * 60): Promise<string> {
  try {
    const { data, error } = await supabase().storage.from(BUCKET).createSignedUrl(path, expiresInSec, {
      transform: { width: 128, height: 128, resize: "cover" },
    });
    if (!error && data?.signedUrl) return data.signedUrl;
  } catch {
    /* transformations disabled — full preview is fine at 64px */
  }
  return signedMyPetUrl(path, expiresInSec);
}

export function decodeDataUrlOrBase64Image(raw: string): Buffer {
  const str = String(raw || "");
  const match = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/.exec(str);
  const b64 = match ? match[3] : str;
  const buf = Buffer.from(b64, "base64");
  if (buf.length < 32) throw new Error("The uploaded photo is empty");
  return buf;
}
