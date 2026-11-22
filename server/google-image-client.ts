/**
 * Direct Google Gemini image rendering (Nano Banana family, official @google/genai SDK).
 *
 * Model and output resolution come from the resolved GoogleImageRenderer /
 * product treatment; aspect ratio comes from the product. The creative prompt
 * is passed through unchanged. Reference images are sent as inline image parts
 * in the same order as the prompt's role lines.
 */
import { ApiError, GoogleGenAI } from "@google/genai";
import type { CredentialRef, GoogleImageRenderer, GoogleImageSize } from "./generation-providers";
import { redactSecrets } from "./generation-providers";
import { ProviderRequestError, type OpenAIImageUsage, type ProviderErrorCategory } from "./openai-image-client";

export type GoogleImageResult = {
  mimeType: string;
  data: string;
  usage: OpenAIImageUsage | null;
  thoughtsTokens: number;
  requestId: string | null;
  durationMs: number;
};

const clients = new Map<string, { key: string; client: GoogleGenAI }>();

function clientFor(credential: CredentialRef, apiKey: string): GoogleGenAI {
  const cached = clients.get(credential.id);
  if (cached && cached.key === apiKey) return cached.client;
  const client = new GoogleGenAI({ apiKey, httpOptions: { timeout: 180_000 } });
  clients.set(credential.id, { key: apiKey, client });
  return client;
}

/** Test hook. */
export function _resetGoogleClients(): void {
  clients.clear();
}

export function estimateGoogleImageCostUsd(
  usage: OpenAIImageUsage | null,
  renderer: GoogleImageRenderer,
): number | null {
  if (!usage) return null;
  const cost = (usage.inputTokens * renderer.pricing.inputPerM + usage.outputTokens * renderer.pricing.outputPerM) / 1_000_000;
  return Math.round(cost * 1e6) / 1e6;
}

function categorize(status: number | undefined, message: string): ProviderErrorCategory {
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate_limit";
  if (status && status >= 500) return "server";
  if (/safety|blocked|prohibited/i.test(message)) return "moderation";
  return "invalid_request";
}

async function loadReference(url: string, index: number, fetchImpl: typeof fetch) {
  const m = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/.exec(url);
  if (m) {
    const data = m[2] ? m[3] : Buffer.from(decodeURIComponent(m[3])).toString("base64");
    return { inlineData: { mimeType: m[1] || "image/png", data } };
  }
  const res = await fetchImpl(url);
  if (!res.ok) throw new ProviderRequestError("reference_unavailable", res.status, null, `reference image ${index + 1} unavailable`);
  const mimeType = (res.headers.get("content-type") || "image/png").split(";")[0];
  return { inlineData: { mimeType, data: Buffer.from(await res.arrayBuffer()).toString("base64") } };
}

function modalityTokens(details: Array<{ modality?: string; tokenCount?: number }> | undefined, modality: string): number {
  return (details ?? []).filter((d) => String(d.modality).toUpperCase() === modality).reduce((a, d) => a + (d.tokenCount ?? 0), 0);
}

export async function renderGoogleImage(opts: {
  apiKey: string;
  credential: CredentialRef;
  renderer: GoogleImageRenderer;
  prompt: string;
  aspectRatio: string;
  imageSize: GoogleImageSize;
  references?: string[];
  fetchImpl?: typeof fetch;
}): Promise<GoogleImageResult> {
  const client = clientFor(opts.credential, opts.apiKey);
  const refs = (opts.references ?? []).filter(Boolean);
  const started = Date.now();
  console.log(
    `[Google] image provider=google credential=${opts.credential.id} scope=${opts.credential.scope} ` +
      `model=${opts.renderer.model} imageSize=${opts.renderer.supportsImageSize === false ? "native" : opts.imageSize} aspect=${opts.aspectRatio} refs=${refs.length}`,
  );

  let response: any;
  try {
    const images = await Promise.all(refs.map((u, i) => loadReference(u, i, opts.fetchImpl ?? fetch)));
    response = await client.models.generateContent({
      model: opts.renderer.model,
      contents: [{ role: "user", parts: [{ text: opts.prompt }, ...images] }],
      config: {
        responseModalities: ["TEXT", "IMAGE"],
        imageConfig:
          opts.renderer.supportsImageSize === false
            ? { aspectRatio: opts.aspectRatio }
            : { aspectRatio: opts.aspectRatio, imageSize: opts.imageSize },
      },
    });
  } catch (err) {
    if (err instanceof ProviderRequestError) throw err;
    const durationMs = Date.now() - started;
    const raw = String((err as Error)?.message ?? err);
    const detail = redactSecrets(raw, opts.apiKey).slice(0, 300);
    const status = err instanceof ApiError ? err.status : undefined;
    const category: ProviderErrorCategory = err instanceof ApiError ? categorize(status, raw) : "network";
    console.error(
      `[Google] image failed credential=${opts.credential.id} model=${opts.renderer.model} category=${category} ` +
        `status=${status ?? "none"} after ${durationMs}ms: ${detail}`,
    );
    throw new ProviderRequestError(category, status ?? null, null, detail);
  }

  const durationMs = Date.now() - started;
  const requestId: string | null = response?.responseId ?? null;
  const parts: any[] = response?.candidates?.[0]?.content?.parts ?? [];
  const image = parts.find((p) => p?.inlineData?.data && String(p.inlineData.mimeType ?? "").startsWith("image/"));
  if (!image) {
    const finish = String(response?.candidates?.[0]?.finishReason ?? "");
    const block = String(response?.promptFeedback?.blockReason ?? "");
    const blocked = /SAFETY|PROHIBITED|BLOCK|RECITATION/i.test(`${finish} ${block}`);
    console.error(
      `[Google] image missing credential=${opts.credential.id} model=${opts.renderer.model} finishReason=${finish || "none"} ` +
        `blockReason=${block || "none"} requestId=${requestId ?? "unknown"}`,
    );
    throw new ProviderRequestError(blocked ? "moderation" : "no_image", null, requestId, `no image returned (${finish || block || "unknown"})`);
  }

  const u = response?.usageMetadata;
  const usage: OpenAIImageUsage | null = u
    ? {
        inputTokens: Number(u.promptTokenCount) || 0,
        outputTokens: Number(u.candidatesTokenCount) || 0,
        totalTokens: Number(u.totalTokenCount) || 0,
        textInputTokens: modalityTokens(u.promptTokensDetails, "TEXT"),
        imageInputTokens: modalityTokens(u.promptTokensDetails, "IMAGE"),
      }
    : null;
  const thoughtsTokens = Number(u?.thoughtsTokenCount) || 0;
  console.log(
    `[Google] image ok credential=${opts.credential.id} model=${opts.renderer.model} requestId=${requestId ?? "unknown"} ` +
      `durationMs=${durationMs}` +
      (usage ? ` usage in=${usage.inputTokens} (text=${usage.textInputTokens} image=${usage.imageInputTokens}) out=${usage.outputTokens} thoughts=${thoughtsTokens}` : ""),
  );
  return { mimeType: image.inlineData.mimeType, data: image.inlineData.data, usage, thoughtsTokens, requestId, durationMs };
}
