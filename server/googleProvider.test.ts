// @vitest-environment node
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { generateImageBase64 } from "./replit_integrations/image/client";
import {
  ProviderCredentialUnavailableError,
  resolveGenerationPlan,
  selectRenderer,
  type DirectGoogleImagePath,
} from "./generation-providers";
import { _resetGoogleClients } from "./google-image-client";
import { _resetOpenAIClients } from "./openai-image-client";
import { buildGenerationEventRow, customerSafeGenerationError } from "./generation-events";
import { publicExperienceProfile } from "@shared/experienceProfile";

const PP_GEMINI = "AIzaPetposterousSENTINEL0123456789abcdefgh";
const MAIN_GEMINI = "AIzaMainUmbrellaSENTINEL9876543210zyxwvu";
const PP_OPENAI = "sk-proj-petposterous-SENTINEL-0123456789abcdef";
const REPLICATE_TOKEN = "r8_test_replicate_token";
const GEMINI_URL = "https://generativelanguage.googleapis.com/";

let pngB64 = "";
let fetchMock: ReturnType<typeof vi.fn>;
let logged: string[] = [];

beforeAll(async () => {
  pngB64 = (
    await sharp({ create: { width: 96, height: 128, channels: 3, background: "#c84" } }).png().toBuffer()
  ).toString("base64");
});

const geminiOk = () =>
  new Response(
    JSON.stringify({
      responseId: "resp_test_1",
      candidates: [{ finishReason: "STOP", content: { role: "model", parts: [{ inlineData: { mimeType: "image/png", data: pngB64 } }] } }],
      usageMetadata: {
        promptTokenCount: 1300,
        candidatesTokenCount: 1680,
        totalTokenCount: 2980,
        promptTokensDetails: [
          { modality: "TEXT", tokenCount: 1042 },
          { modality: "IMAGE", tokenCount: 258 },
        ],
      },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );

const urlOf = (c: unknown[]) => String(c[0] instanceof Request ? (c[0] as Request).url : c[0]);
const headerOf = (c: unknown[], name: string) => {
  if (c[0] instanceof Request) return (c[0] as Request).headers.get(name);
  return new Headers((c[1] as RequestInit | undefined)?.headers).get(name);
};
async function bodyOf(c: unknown[]) {
  if (c[0] instanceof Request) return JSON.parse(await (c[0] as Request).clone().text());
  return JSON.parse(String((c[1] as RequestInit).body));
}

beforeEach(() => {
  process.env.REPLICATE_API_TOKEN = REPLICATE_TOKEN;
  for (const k of ["GEMINI_API_KEY_PETPOSTEROUS", "GEMINI_API_KEY_MAIN", "OPENAI_API_KEY_PETPOSTEROUS", "OPENAI_API_KEY_MAIN"]) delete process.env[k];
  _resetGoogleClients();
  _resetOpenAIClients();
  logged = [];
  for (const level of ["log", "warn", "error", "info", "debug"] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      logged.push(args.map((a) => (typeof a === "string" ? a : a instanceof Error ? a.message : JSON.stringify(a))).join(" "));
    });
  }
  fetchMock = vi.fn(async (input: unknown) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith(GEMINI_URL)) return geminiOk();
    if (url.startsWith("https://api.replicate.com/")) {
      return new Response(JSON.stringify({ id: "pred_1", status: "succeeded", output: ["https://replicate.delivery/out.png"] }), {
        headers: { "content-type": "application/json" },
      });
    }
    if (url === "https://replicate.delivery/out.png" || url.startsWith("https://storage.example/")) {
      return new Response(Buffer.from(pngB64, "base64"), { headers: { "content-type": "image/png" } });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const PP_DECOR = { merchantId: "m-pp", packProfileKey: "petposterous", productFamily: "poster", isApparel: false };
const decorParams = {
  prompt: "Full-bleed poster artwork. LOOK — VINTAGE PRINT. A cat with no remorse beside a spilled mug.",
  aspectRatio: "3:4",
  isApparel: false,
  generationModel: "nano-banana",
  generationQuality: null,
  nativeTransparent: false,
  layered: true,
  packLayered: true,
  transparencyCheck: "enforce" as const,
};

describe("Petposterous dedicated Google (Nano Banana) credential", () => {
  it("1. Petposterous apparel still resolves to its dedicated OpenAI credential", () => {
    const plan = resolveGenerationPlan({ ...PP_DECOR, productFamily: "apparel", isApparel: true });
    expect(plan.imagePath !== "legacy" && plan.imagePath.kind).toBe("direct-openai");
    expect(plan.credentials.openai).toMatchObject({ id: "openai:petposterous", scope: "dedicated", credentialKey: "OPENAI_API_KEY_PETPOSTEROUS" });
  });

  it("2. Petposterous decor resolves to its dedicated Google credential, Nano Banana 2, product-set resolution", () => {
    const sizes: Record<string, string> = { poster: "2K", pillow: "2K", tapestry: "4K", bedding: "4K" };
    for (const [productFamily, size] of Object.entries(sizes)) {
      const plan = resolveGenerationPlan({ ...PP_DECOR, productFamily });
      const path = plan.imagePath as DirectGoogleImagePath;
      expect(path.kind).toBe("direct-google");
      expect(path.credential).toMatchObject({ id: "google:petposterous", scope: "dedicated", credentialKey: "GEMINI_API_KEY_PETPOSTEROUS" });
      expect(path.renderer.model).toBe("gemini-3.1-flash-image");
      expect(path.imageSize).toBe(size);
    }
    const path = resolveGenerationPlan(PP_DECOR).imagePath as DirectGoogleImagePath;
    expect(selectRenderer(path, { escalate: true }).model).toBe("gemini-3-pro-image");
    expect(selectRenderer(path).model).toBe("gemini-3.1-flash-image");
  });

  it("2b. sends the unchanged prompt to Gemini with the dedicated key, product aspect and resolution", async () => {
    process.env.GEMINI_API_KEY_PETPOSTEROUS = PP_GEMINI;
    process.env.GEMINI_API_KEY_MAIN = MAIN_GEMINI;
    const out = await generateImageBase64({
      ...decorParams,
      inputImageUrl: ["https://storage.example/signed/pet.jpg?t=1"],
      generationPlan: resolveGenerationPlan(PP_DECOR),
    });
    const geminiCalls = fetchMock.mock.calls.filter((c) => urlOf(c).startsWith(GEMINI_URL));
    expect(geminiCalls).toHaveLength(1);
    expect(urlOf(geminiCalls[0])).toContain("models/gemini-3.1-flash-image:generateContent");
    expect(headerOf(geminiCalls[0], "x-goog-api-key")).toBe(PP_GEMINI);
    const body = await bodyOf(geminiCalls[0]);
    // Same aspect mapping as the legacy Replicate Nano Banana path (3:4 → 4:5).
    expect(body.generationConfig.imageConfig).toEqual({ aspectRatio: "4:5", imageSize: "2K" });
    const parts = body.contents[0].parts;
    expect(parts[0].text.startsWith("PRINT ARTWORK OUTPUT")).toBe(true);
    expect(parts[0].text).toContain("SUBJECT INTEGRITY");
    expect(parts[0].text).toContain("FULL BLEED"); // poster = full-bleed wall art
    expect(parts[0].text.endsWith(decorParams.prompt)).toBe(true);
    expect(parts[1].inlineData.mimeType).toBe("image/png");
    expect(fetchMock.mock.calls.some((c) => urlOf(c).includes("replicate"))).toBe(false);
    expect(out.meta).toMatchObject({
      provider: "google",
      credentialRefId: "google:petposterous",
      credentialScope: "dedicated",
      model: "gemini-3.1-flash-image",
      quality: "2K",
      size: "96x128",
      providerRequestId: "resp_test_1",
      providerMime: "image/png",
    });
    expect(out.meta?.usage).toMatchObject({ inputTokens: 1300, outputTokens: 1680, textInputTokens: 1042, imageInputTokens: 258 });
    expect(out.meta?.estimatedCostUsd).toBeCloseTo((1300 * 0.5 + 1680 * 60) / 1e6, 6);
  });

  it("3. missing Petposterous Google key fails with no fallback to GEMINI MAIN, Replicate or OpenAI", async () => {
    process.env.GEMINI_API_KEY_MAIN = MAIN_GEMINI;
    process.env.OPENAI_API_KEY_PETPOSTEROUS = PP_OPENAI;
    const plan = resolveGenerationPlan(PP_DECOR);
    const err = await generateImageBase64({ ...decorParams, generationPlan: plan }).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderCredentialUnavailableError);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(customerSafeGenerationError(err, plan)).toBe(err.message);
    expect(err.message).not.toMatch(/GEMINI|AIza|key/i);
  });

  it("4. non-Petposterous Nano Banana stays on Replicate exactly as before, even with Google keys set", async () => {
    process.env.GEMINI_API_KEY_PETPOSTEROUS = PP_GEMINI;
    process.env.GEMINI_API_KEY_MAIN = MAIN_GEMINI;
    for (const generationPlan of [undefined, resolveGenerationPlan({ merchantId: "m-classic" })]) {
      fetchMock.mockClear();
      await generateImageBase64({ ...decorParams, packLayered: undefined, transparencyCheck: undefined, generationPlan });
      expect(urlOf(fetchMock.mock.calls[0])).toBe("https://api.replicate.com/v1/predictions");
      expect(headerOf(fetchMock.mock.calls[0], "authorization")).toBe(`Bearer ${REPLICATE_TOKEN}`);
      const body = await bodyOf(fetchMock.mock.calls[0]);
      expect(body.input).toMatchObject({ aspect_ratio: "4:5", output_format: "png" });
      expect(fetchMock.mock.calls.some((c) => urlOf(c).startsWith(GEMINI_URL))).toBe(false);
    }
    expect(resolveGenerationPlan({ merchantId: "m-classic" }).credentials.google).toMatchObject({
      id: "google:shared",
      scope: "shared",
      credentialKey: "GEMINI_API_KEY_MAIN",
    });
  });

  it("5. Google and OpenAI secrets never reach errors, logs, plans or public payloads", async () => {
    process.env.GEMINI_API_KEY_PETPOSTEROUS = PP_GEMINI;
    process.env.GEMINI_API_KEY_MAIN = MAIN_GEMINI;
    process.env.OPENAI_API_KEY_PETPOSTEROUS = PP_OPENAI;
    fetchMock.mockImplementation(async (input: unknown) => {
      const url = String(input instanceof Request ? input.url : input);
      if (!url.startsWith(GEMINI_URL)) throw new Error("unexpected");
      return new Response(
        JSON.stringify({ error: { code: 400, message: `API key not valid: ${PP_GEMINI}. Please pass a valid API key.`, status: "INVALID_ARGUMENT" } }),
        { status: 400, headers: { "content-type": "application/json" } },
      );
    });
    const plan = resolveGenerationPlan(PP_DECOR);
    const err = await generateImageBase64({ ...decorParams, generationPlan: plan }).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    for (const secret of [PP_GEMINI, MAIN_GEMINI, PP_OPENAI]) {
      expect(String(err.message)).not.toContain(secret);
      for (const line of logged) expect(line).not.toContain(secret);
      expect(JSON.stringify(plan)).not.toContain(secret);
    }
    expect(customerSafeGenerationError(err, plan)).toBe("We couldn't create this artwork right now. Please try again.");
    const pub = JSON.stringify(
      publicExperienceProfile({ slug: "petposterous", stylePackId: "p", config: {} } as any, { humorOptions: [], relationshipOptions: [] } as any),
    );
    for (const s of [PP_GEMINI, MAIN_GEMINI, "GEMINI_API_KEY", "gemini-3"]) expect(pub).not.toContain(s);
  });

  it("6. telemetry records google:petposterous (success and failure), never the key", async () => {
    process.env.GEMINI_API_KEY_PETPOSTEROUS = PP_GEMINI;
    const plan = resolveGenerationPlan(PP_DECOR);
    const out = await generateImageBase64({ ...decorParams, generationPlan: plan });
    const ctx = {
      kind: "image" as const,
      route: "storefront-generate",
      merchantId: "m-pp",
      experienceProfile: "petposterous",
      productFamily: "poster",
      visualSystem: "vintage-print",
      plan,
    };
    const row = buildGenerationEventRow(ctx, { success: true, durationMs: 9000, meta: out.meta });
    expect(row).toMatchObject({
      provider: "google",
      credentialScope: "dedicated",
      credentialRef: "google:petposterous",
      model: "gemini-3.1-flash-image",
      quality: "2K",
      success: true,
    });
    const failed = buildGenerationEventRow(ctx, { success: false, durationMs: 3, error: new ProviderCredentialUnavailableError() });
    expect(failed).toMatchObject({ provider: "google", credentialRef: "google:petposterous", errorCategory: "credential_missing" });
    for (const r of [row, failed]) {
      const json = JSON.stringify(r);
      expect(json).not.toContain(PP_GEMINI);
      expect(json).not.toContain("GEMINI_API_KEY");
    }
  });
});
