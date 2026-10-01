/**
 * Direct OpenAI Image API rendering (official `openai` SDK).
 *
 * Image API (/v1/images/generations, /v1/images/edits). Flare/Sunburst are also
 * available through the Responses API, which suits conversational/multi-turn
 * image work; each generation here is a single prompt → single image, which is
 * what the Image API is for. References go to images.edit as image[] in the
 * same order as the prompt's "Image k: …" role lines.
 */
import { createHash } from "node:crypto";
import OpenAI, { APIError, toFile } from "openai";
import type { CredentialRef, ImageRenderer } from "./generation-providers";
import { redactSecrets } from "./generation-providers";

export type OpenAIImageUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  textInputTokens: number;
  imageInputTokens: number;
};

export type OpenAIImageResult = {
  mimeType: "image/png";
  data: string;
  usage: OpenAIImageUsage | null;
  requestId: string | null;
  durationMs: number;
  size: string;
};

export type ProviderErrorCategory =
  | "auth"
  | "rate_limit"
  | "invalid_request"
  | "transparency_rejected"
  | "moderation"
  | "server"
  | "network"
  | "reference_unavailable"
  | "no_image";

export class ProviderRequestError extends Error {
  code = "PROVIDER_REQUEST_FAILED";
  constructor(
    public category: ProviderErrorCategory,
    public status: number | null,
    public requestId: string | null,
    detail: string,
  ) {
    super(`OpenAI image request failed (${category}${status ? ` status=${status}` : ""}${requestId ? ` requestId=${requestId}` : ""}): ${detail}`);
    this.name = "ProviderRequestError";
  }
}

const clients = new Map<string, { key: string; client: OpenAI }>();

function clientFor(credential: CredentialRef, apiKey: string): OpenAI {
  const cached = clients.get(credential.id);
  if (cached && cached.key === apiKey) return cached.client;
  const client = new OpenAI({ apiKey, maxRetries: 1, timeout: 180_000 });
  clients.set(credential.id, { key: apiKey, client });
  return client;
}

/** Test hook. */
export function _resetOpenAIClients(): void {
  clients.clear();
}

/**
 * Exact product aspect at a documented custom size: short edge 1024, long edge
 * a multiple of 16, aspect clamped to 1:3–3:1 (4:5 → 1024x1280).
 */
export function openAIImageSize(aspectRatio?: string | null): string {
  const [w, h] = String(aspectRatio ?? "1:1").split(":").map(Number);
  let ratio = w > 0 && h > 0 ? w / h : 1;
  ratio = Math.min(3, Math.max(1 / 3, ratio));
  if (Math.abs(ratio - 1) < 0.01) return "1024x1024";
  const long = Math.min(3840, Math.round((1024 * (ratio >= 1 ? ratio : 1 / ratio)) / 16) * 16);
  return ratio >= 1 ? `${long}x1024` : `1024x${long}`;
}

/** Opaque per-store end-user id for OpenAI's `user` field: internal ids only, hashed. */
export function openAIEndUserId(shop: string | null | undefined, internalId: string | null | undefined): string | undefined {
  if (!internalId) return undefined;
  return createHash("sha256").update(`appai:${shop ?? ""}:${internalId}`).digest("hex").slice(0, 32);
}

export function estimateOpenAIImageCostUsd(usage: OpenAIImageUsage | null, renderer: ImageRenderer): number | null {
  if (!usage) return null;
  const p = renderer.pricing;
  const cost =
    (usage.textInputTokens * p.textInPerM + usage.imageInputTokens * p.imageInPerM + usage.outputTokens * p.outputPerM) / 1_000_000;
  return Math.round(cost * 1e6) / 1e6;
}

function toUsage(u: any): OpenAIImageUsage | null {
  if (!u || typeof u !== "object") return null;
  return {
    inputTokens: Number(u.input_tokens) || 0,
    outputTokens: Number(u.output_tokens) || 0,
    totalTokens: Number(u.total_tokens) || 0,
    textInputTokens: Number(u.input_tokens_details?.text_tokens) || 0,
    imageInputTokens: Number(u.input_tokens_details?.image_tokens) || 0,
  };
}

function categorize(err: APIError): ProviderErrorCategory {
  const param = String(err.param ?? "");
  const code = String(err.code ?? "");
  if (err.status === 401 || err.status === 403) return "auth";
  if (err.status === 429) return "rate_limit";
  if (code.includes("moderation") || code === "content_policy_violation") return "moderation";
  if (param === "background") return "transparency_rejected";
  if (err.status && err.status >= 500) return "server";
  return "invalid_request";
}

async function loadReference(url: string, index: number, fetchImpl: typeof fetch) {
  const m = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/.exec(url);
  let buf: Buffer;
  let type: string;
  if (m) {
    buf = m[2] ? Buffer.from(m[3], "base64") : Buffer.from(decodeURIComponent(m[3]));
    type = m[1] || "image/png";
  } else {
    const res = await fetchImpl(url);
    if (!res.ok) throw new ProviderRequestError("reference_unavailable", res.status, null, `reference image ${index + 1} unavailable`);
    type = res.headers.get("content-type") || "image/png";
    buf = Buffer.from(await res.arrayBuffer());
  }
  const ext = type.includes("jpeg") || type.includes("jpg") ? "jpg" : type.includes("webp") ? "webp" : "png";
  return toFile(buf, `reference-${index + 1}.${ext}`, { type });
}

export async function renderOpenAIImage(opts: {
  apiKey: string;
  credential: CredentialRef;
  renderer: ImageRenderer;
  prompt: string;
  aspectRatio?: string | null;
  background: "transparent" | "opaque";
  references?: string[];
  user?: string;
  fetchImpl?: typeof fetch;
}): Promise<OpenAIImageResult> {
  const client = clientFor(opts.credential, opts.apiKey);
  const size = openAIImageSize(opts.aspectRatio);
  const refs = (opts.references ?? []).filter(Boolean);
  const started = Date.now();
  console.log(
    `[OpenAI] image provider=openai credential=${opts.credential.id} scope=${opts.credential.scope} ` +
      `model=${opts.renderer.model} quality=${opts.renderer.quality} size=${size} background=${opts.background} ` +
      `output_format=png endpoint=${refs.length ? "edits" : "generations"} refs=${refs.length}`,
  );

  const common = {
    model: opts.renderer.model,
    prompt: opts.prompt,
    background: opts.background,
    output_format: "png" as const,
    quality: opts.renderer.quality,
    size,
    n: 1,
    ...(opts.user ? { user: opts.user } : {}),
  };

  let response: any;
  let requestId: string | null = null;
  try {
    if (refs.length) {
      const image = await Promise.all(refs.map((u, i) => loadReference(u, i, opts.fetchImpl ?? fetch)));
      const r = await client.images.edit({ ...common, image }).withResponse();
      response = r.data;
      requestId = r.request_id ?? null;
    } else {
      const r = await client.images.generate(common as any).withResponse();
      response = r.data;
      requestId = r.request_id ?? null;
    }
  } catch (err) {
    if (err instanceof ProviderRequestError) throw err;
    const durationMs = Date.now() - started;
    if (err instanceof APIError) {
      const category = categorize(err);
      const detail = redactSecrets(String((err.error as any)?.message ?? err.message ?? ""), opts.apiKey).slice(0, 300);
      console.error(
        `[OpenAI] image failed credential=${opts.credential.id} model=${opts.renderer.model} category=${category} ` +
          `status=${err.status ?? "none"} requestId=${err.requestID ?? "unknown"} after ${durationMs}ms: ${detail}`,
      );
      throw new ProviderRequestError(category, err.status ?? null, err.requestID ?? null, detail);
    }
    const detail = redactSecrets(String((err as Error)?.message ?? err), opts.apiKey).slice(0, 300);
    console.error(`[OpenAI] image network failure credential=${opts.credential.id} after ${durationMs}ms: ${detail}`);
    throw new ProviderRequestError("network", null, null, detail);
  }

  const durationMs = Date.now() - started;
  const b64 = response?.data?.[0]?.b64_json;
  if (typeof b64 !== "string" || !b64) {
    throw new ProviderRequestError("no_image", null, requestId, "response contained no image data");
  }
  const usage = toUsage(response?.usage);
  console.log(
    `[OpenAI] image ok credential=${opts.credential.id} model=${opts.renderer.model} requestId=${requestId ?? "unknown"} ` +
      `durationMs=${durationMs}` +
      (usage ? ` usage text_in=${usage.textInputTokens} image_in=${usage.imageInputTokens} out=${usage.outputTokens}` : ""),
  );
  return { mimeType: "image/png", data: b64, usage, requestId, durationMs, size };
}
