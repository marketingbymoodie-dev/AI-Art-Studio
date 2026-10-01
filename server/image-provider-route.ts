/**
 * Per-generation image provider routing.
 *
 * Petposterous (resolved style-pack profile key "petposterous") calls OpenAI
 * directly with its own server-side key (OPENAI_API_KEY_PETPOSTEROUS) so GPT
 * Image 2 native transparency does not depend on Replicate's hosted routing.
 * Every other generation keeps the existing Replicate path unchanged.
 *
 * The key is read from env at call time only: never returned, stored, logged
 * or placed in an error message. A missing key fails the Petposterous
 * generation; it never falls back to another key or provider.
 */

export const PETPOSTEROUS_OPENAI_KEY_ENV = "OPENAI_API_KEY_PETPOSTEROUS";

export type ImageProviderRoute = { provider: "replicate" } | { provider: "openai"; account: "petposterous" };

export function resolveImageProviderRoute(packProfileKey: string | null | undefined): ImageProviderRoute {
  return packProfileKey === "petposterous" ? { provider: "openai", account: "petposterous" } : { provider: "replicate" };
}

export class ImageProviderUnavailableError extends Error {
  code = "IMAGE_PROVIDER_UNAVAILABLE";
  constructor() {
    super("Artwork generation is temporarily unavailable for this store. Please try again later.");
    this.name = "ImageProviderUnavailableError";
  }
}

export function getOpenAIKeyForRoute(
  route: Extract<ImageProviderRoute, { provider: "openai" }>,
  env: Record<string, string | undefined> = process.env,
): string {
  const key = route.account === "petposterous" ? env[PETPOSTEROUS_OPENAI_KEY_ENV]?.trim() : undefined;
  if (!key) {
    console.error(`[ImageProvider] ${PETPOSTEROUS_OPENAI_KEY_ENV} is not set; refusing ${route.account} generation (no fallback)`);
    throw new ImageProviderUnavailableError();
  }
  return key;
}

/** Strip the key (and anything key-shaped) from provider text before it is logged or thrown. */
export function redactSecrets(text: string, secret?: string): string {
  let out = secret ? text.split(secret).join("[redacted]") : text;
  out = out.replace(/sk-[A-Za-z0-9_-]{8,}/g, "[redacted]");
  return out;
}

const SIZE_BY_ASPECT: Record<"1:1" | "2:3" | "3:2", string> = {
  "1:1": "1024x1024",
  "2:3": "1024x1536",
  "3:2": "1536x1024",
};

async function loadReferenceImage(url: string, fetchImpl: typeof fetch): Promise<Blob> {
  const m = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/.exec(url);
  if (m) {
    const buf = m[2] ? Buffer.from(m[3], "base64") : Buffer.from(decodeURIComponent(m[3]));
    return new Blob([buf], { type: m[1] || "image/png" });
  }
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`Could not load reference image (HTTP ${res.status})`);
  const type = res.headers.get("content-type") || "image/png";
  return new Blob([Buffer.from(await res.arrayBuffer())], { type });
}

/**
 * GPT Image 2 via the OpenAI Images API with background:"transparent" + PNG.
 * Reference images → /v1/images/edits; otherwise /v1/images/generations.
 */
export async function generateGptImage2ViaOpenAI(opts: {
  apiKey: string;
  account: string;
  prompt: string;
  aspect: "1:1" | "2:3" | "3:2";
  quality: string;
  inputImageUrls?: string[];
  fetchImpl?: typeof fetch;
}): Promise<{ mimeType: string; data: string }> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const size = SIZE_BY_ASPECT[opts.aspect];
  const refs = (opts.inputImageUrls ?? []).filter(Boolean);
  const auth = { Authorization: `Bearer ${opts.apiKey}` };
  console.log(
    `[OpenAI] gpt-image-2 provider=openai account=${opts.account} endpoint=${refs.length ? "edits" : "generations"} ` +
      `quality=${opts.quality} size=${size} background=transparent output_format=png refs=${refs.length}`,
  );

  let res: Response;
  if (refs.length) {
    const form = new FormData();
    form.append("model", "gpt-image-2");
    form.append("prompt", opts.prompt);
    form.append("background", "transparent");
    form.append("output_format", "png");
    form.append("quality", opts.quality);
    form.append("size", size);
    form.append("n", "1");
    const blobs = await Promise.all(refs.map((u) => loadReferenceImage(u, fetchImpl)));
    blobs.forEach((b, i) => form.append("image[]", b, `reference-${i + 1}.${b.type.includes("jpeg") ? "jpg" : "png"}`));
    res = await fetchImpl("https://api.openai.com/v1/images/edits", { method: "POST", headers: auth, body: form });
  } else {
    res = await fetchImpl("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-image-2",
        prompt: opts.prompt,
        background: "transparent",
        output_format: "png",
        quality: opts.quality,
        size,
        n: 1,
      }),
    });
  }

  const requestId = res.headers.get("x-request-id") || "unknown";
  const text = await res.text();
  let json: any = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = {};
  }
  if (!res.ok) {
    const detail = redactSecrets(String(json?.error?.message || `HTTP ${res.status}`), opts.apiKey).slice(0, 300);
    console.error(`[OpenAI] gpt-image-2 failed account=${opts.account} status=${res.status} requestId=${requestId}: ${detail}`);
    throw new Error(`OpenAI gpt-image-2 generation failed (status=${res.status} requestId=${requestId}): ${detail}`);
  }
  const b64 = json?.data?.[0]?.b64_json;
  if (typeof b64 !== "string" || !b64) {
    throw new Error(`OpenAI gpt-image-2 returned no image data (requestId=${requestId})`);
  }
  const u = json?.usage;
  console.log(
    `[OpenAI] gpt-image-2 ok account=${opts.account} requestId=${requestId}` +
      (u ? ` usage input=${u.input_tokens ?? "?"} output=${u.output_tokens ?? "?"} total=${u.total_tokens ?? "?"}` : ""),
  );
  return { mimeType: "image/png", data: b64 };
}
