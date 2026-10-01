import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { generateImageBase64 } from "./replit_integrations/image/client";
import {
  ImageProviderUnavailableError,
  PETPOSTEROUS_OPENAI_KEY_ENV,
  redactSecrets,
  resolveImageProviderRoute,
} from "./image-provider-route";

const PP_KEY = "sk-test-petposterous-SECRET-0123456789abcdef";
const REPLICATE_TOKEN = "r8_test_replicate_token";

let transparentPngB64 = "";
let fetchMock: ReturnType<typeof vi.fn>;
let logged: string[] = [];

beforeAll(async () => {
  // Half transparent / half opaque so the native-transparency check passes.
  const raw = Buffer.alloc(32 * 32 * 4);
  for (let i = 0; i < 32 * 32; i++) {
    const opaque = i % 32 >= 8 && i % 32 < 24 && i >= 8 * 32 && i < 24 * 32;
    raw.set(opaque ? [200, 40, 40, 255] : [0, 0, 0, 0], i * 4);
  }
  transparentPngB64 = (await sharp(raw, { raw: { width: 32, height: 32, channels: 4 } }).png().toBuffer()).toString("base64");
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "x-request-id": "req_test" } });
}

beforeEach(() => {
  process.env.REPLICATE_API_TOKEN = REPLICATE_TOKEN;
  logged = [];
  for (const level of ["log", "warn", "error", "info"] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      logged.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
    });
  }
  fetchMock = vi.fn(async (url: string) => {
    if (url.startsWith("https://api.openai.com/")) {
      return jsonResponse({ data: [{ b64_json: transparentPngB64 }], usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 } });
    }
    if (url.startsWith("https://api.replicate.com/")) {
      return jsonResponse({ id: "pred_1", status: "succeeded", output: ["https://replicate.delivery/out.png"] });
    }
    if (url === "https://replicate.delivery/out.png") {
      return new Response(Buffer.from(transparentPngB64, "base64"), { headers: { "content-type": "image/png" } });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  delete process.env[PETPOSTEROUS_OPENAI_KEY_ENV];
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const baseParams = {
  prompt: "Isolated centered graphic on a TRANSPARENT background. A dog ignoring its owner.",
  aspectRatio: "4:5",
  isApparel: true,
  generationModel: "gpt-image-2",
  generationQuality: "medium",
  nativeTransparent: true,
  layered: true,
  packLayered: true,
  transparencyCheck: "enforce" as const,
};

const calledUrls = () => fetchMock.mock.calls.map((c) => String(c[0]));

describe("image provider routing", () => {
  it("routes only the petposterous pack profile to OpenAI", () => {
    expect(resolveImageProviderRoute("petposterous")).toEqual({ provider: "openai", account: "petposterous" });
    expect(resolveImageProviderRoute(null)).toEqual({ provider: "replicate" });
    expect(resolveImageProviderRoute(undefined)).toEqual({ provider: "replicate" });
    expect(resolveImageProviderRoute("quotes")).toEqual({ provider: "replicate" });
  });

  it("1. Petposterous uses the Petposterous OpenAI key with gpt-image-2 + native transparency", async () => {
    process.env[PETPOSTEROUS_OPENAI_KEY_ENV] = PP_KEY;
    const out = await generateImageBase64({ ...baseParams, imageProvider: resolveImageProviderRoute("petposterous") });

    expect(out).toEqual({ mimeType: "image/png", data: transparentPngB64 });
    expect(calledUrls()).toEqual(["https://api.openai.com/v1/images/generations"]);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${PP_KEY}`);
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ model: "gpt-image-2", background: "transparent", output_format: "png", quality: "medium", size: "1024x1536", n: 1 });
    expect(logged.some((l) => l.includes("provider=openai account=petposterous"))).toBe(true);
  });

  it("1b. Petposterous reference photos go to the edits endpoint with the same key", async () => {
    process.env[PETPOSTEROUS_OPENAI_KEY_ENV] = PP_KEY;
    const dataUrl = `data:image/png;base64,${transparentPngB64}`;
    await generateImageBase64({ ...baseParams, inputImageUrl: [dataUrl], imageProvider: resolveImageProviderRoute("petposterous") });
    expect(calledUrls()).toEqual(["https://api.openai.com/v1/images/edits"]);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${PP_KEY}`);
    const form = init.body as FormData;
    expect(form.get("model")).toBe("gpt-image-2");
    expect(form.get("background")).toBe("transparent");
    expect(form.getAll("image[]")).toHaveLength(1);
  });

  it("2. classic generations keep the existing Replicate path even when the Petposterous key is set", async () => {
    process.env[PETPOSTEROUS_OPENAI_KEY_ENV] = PP_KEY;
    for (const imageProvider of [undefined, resolveImageProviderRoute(null)]) {
      fetchMock.mockClear();
      await generateImageBase64({ ...baseParams, packLayered: undefined, transparencyCheck: undefined, imageProvider });
      expect(calledUrls()[0]).toBe("https://api.replicate.com/v1/models/openai/gpt-image-2/predictions");
      expect(calledUrls().some((u) => u.includes("openai.com"))).toBe(false);
      const init = fetchMock.mock.calls[0][1] as RequestInit;
      expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${REPLICATE_TOKEN}`);
      expect(JSON.parse(String(init.body)).input).toMatchObject({ background: "transparent", aspect_ratio: "2:3", quality: "medium" });
    }
  });

  it("2b. a Petposterous decor (non-OpenAI model) generation stays on Replicate", async () => {
    process.env[PETPOSTEROUS_OPENAI_KEY_ENV] = PP_KEY;
    await generateImageBase64({
      ...baseParams,
      generationModel: "nano-banana",
      nativeTransparent: false,
      imageProvider: resolveImageProviderRoute("petposterous"),
    });
    expect(calledUrls()[0]).toBe("https://api.replicate.com/v1/predictions");
    expect(calledUrls().some((u) => u.includes("openai.com"))).toBe(false);
  });

  it("3. missing Petposterous key fails clearly and never falls back to another provider or key", async () => {
    delete process.env[PETPOSTEROUS_OPENAI_KEY_ENV];
    process.env.OPENAI_API_KEY = "sk-generic-should-never-be-used-123456";
    try {
      const err = await generateImageBase64({ ...baseParams, imageProvider: resolveImageProviderRoute("petposterous") }).catch((e) => e);
      expect(err).toBeInstanceOf(ImageProviderUnavailableError);
      expect(err.code).toBe("IMAGE_PROVIDER_UNAVAILABLE");
      expect(fetchMock).not.toHaveBeenCalled();
      expect(String(err.message)).not.toContain("sk-");
    } finally {
      delete process.env.OPENAI_API_KEY;
    }
  });

  it("4. the key never appears in thrown (client-facing) errors or logs, even if the provider echoes it", async () => {
    process.env[PETPOSTEROUS_OPENAI_KEY_ENV] = PP_KEY;
    fetchMock.mockImplementationOnce(async () =>
      jsonResponse({ error: { message: `Incorrect API key provided: ${PP_KEY}. Also sk-otherleakedkey12345.`, code: "invalid_api_key" } }, 401),
    );
    const err = await generateImageBase64({ ...baseParams, imageProvider: resolveImageProviderRoute("petposterous") }).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(String(err.message)).toContain("status=401");
    expect(String(err.message)).not.toContain(PP_KEY);
    expect(String(err.message)).not.toContain("sk-otherleakedkey12345");

    // Successful run too: nothing logged anywhere contains the key.
    await generateImageBase64({ ...baseParams, imageProvider: resolveImageProviderRoute("petposterous") });
    expect(logged.length).toBeGreaterThan(0);
    for (const line of logged) expect(line).not.toContain(PP_KEY);
    expect(JSON.stringify(err)).not.toContain(PP_KEY);
  });

  it("redactSecrets strips the exact key and key-shaped tokens", () => {
    expect(redactSecrets(`bad key ${PP_KEY} and sk-abcdefgh1234`, PP_KEY)).toBe("bad key [redacted] and [redacted]");
  });
});
