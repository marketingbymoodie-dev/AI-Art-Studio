// @vitest-environment node
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { generateImageBase64 } from "./replit_integrations/image/client";
import {
  ASSIGNMENTS,
  CREDENTIALS,
  ProviderCredentialUnavailableError,
  readCredential,
  redactSecrets,
  resolveGenerationPlan,
  selectRenderer,
  type GenerationAssignment,
} from "./generation-providers";
import { _resetOpenAIClients, estimateOpenAIImageCostUsd, openAIEndUserId, openAIImageSize } from "./openai-image-client";
import { buildGenerationEventRow, customerSafeGenerationError } from "./generation-events";
import { storagePathFor } from "./apparel-storage-path";
import { publicExperienceProfile } from "@shared/experienceProfile";
import { buildRoleReferenceInstruction } from "@shared/referenceImages";

const PP_KEY = "sk-proj-petposterous-SENTINEL-0123456789abcdef";
const MAIN_KEY = "sk-proj-main-SENTINEL-9876543210fedcba";
const REPLICATE_TOKEN = "r8_test_replicate_token";

let pngB64 = "";
let opaqueB64 = "";
let fetchMock: ReturnType<typeof vi.fn>;
let logged: string[] = [];

beforeAll(async () => {
  const raw = Buffer.alloc(32 * 32 * 4);
  for (let i = 0; i < 32 * 32; i++) {
    const x = i % 32;
    const y = Math.floor(i / 32);
    const inside = x >= 8 && x < 24 && y >= 8 && y < 24;
    const edge = inside && (x === 8 || x === 23); // soft edge pixels
    raw.set(inside ? [200, 40, 40, edge ? 128 : 255] : [0, 0, 0, 0], i * 4);
  }
  pngB64 = (await sharp(raw, { raw: { width: 32, height: 32, channels: 4 } }).png().toBuffer()).toString("base64");
  opaqueB64 = (await sharp({ create: { width: 32, height: 32, channels: 3, background: "#ffffff" } }).png().toBuffer()).toString(
    "base64",
  );
});

const USAGE = {
  input_tokens: 1200,
  output_tokens: 4000,
  total_tokens: 5200,
  input_tokens_details: { text_tokens: 1000, image_tokens: 200 },
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "x-request-id": "req_test_123" },
  });
}

beforeEach(() => {
  process.env.REPLICATE_API_TOKEN = REPLICATE_TOKEN;
  delete process.env.OPENAI_API_KEY_PETPOSTEROUS;
  delete process.env.OPENAI_API_KEY_MAIN;
  _resetOpenAIClients();
  logged = [];
  for (const level of ["log", "warn", "error", "info", "debug"] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      logged.push(args.map((a) => (typeof a === "string" ? a : a instanceof Error ? a.message : JSON.stringify(a))).join(" "));
    });
  }
  fetchMock = vi.fn(async (input: unknown) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith("https://api.openai.com/")) return jsonResponse({ created: 1, data: [{ b64_json: pngB64 }], usage: USAGE });
    if (url.startsWith("https://api.replicate.com/")) {
      return jsonResponse({ id: "pred_1", status: "succeeded", output: ["https://replicate.delivery/out.png"] });
    }
    if (url === "https://replicate.delivery/out.png") {
      return new Response(Buffer.from(pngB64, "base64"), { headers: { "content-type": "image/png" } });
    }
    if (url.startsWith("https://storage.example/")) {
      return new Response(Buffer.from(pngB64, "base64"), { headers: { "content-type": "image/png" } });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  delete process.env.OPENAI_API_KEY_PETPOSTEROUS;
  delete process.env.OPENAI_API_KEY_MAIN;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function samePixels(a: string, b: string) {
  const [x, y] = await Promise.all([a, b].map((s) => sharp(Buffer.from(s, "base64")).ensureAlpha().raw().toBuffer()));
  return Buffer.compare(x, y) === 0;
}

const calledUrls = () => fetchMock.mock.calls.map((c) => String(c[0] instanceof Request ? c[0].url : c[0]));
const authHeader = (callIndex: number) => {
  const init = fetchMock.mock.calls[callIndex][1] as RequestInit | undefined;
  return new Headers(init?.headers).get("authorization");
};

const PP_APPAREL = { packProfileKey: "petposterous", productFamily: "apparel", isApparel: true, merchantId: "m-pp" };

const apparelParams = {
  prompt: "Isolated floating composition on a TRANSPARENT background. HE HEARD YOU.",
  aspectRatio: "4:5",
  isApparel: true,
  generationModel: "gpt-image-2",
  generationQuality: "medium",
  nativeTransparent: true,
  layered: true,
  packLayered: true,
  transparencyCheck: "enforce" as const,
};

describe("provider resolution", () => {
  it("1. Petposterous apparel resolves to the dedicated OpenAI credential and direct path", () => {
    const plan = resolveGenerationPlan(PP_APPAREL);
    expect(plan.assignmentKey).toBe("pack:petposterous");
    expect(plan.imagePath).not.toBe("legacy");
    if (plan.imagePath === "legacy") return;
    expect(plan.imagePath.kind).toBe("direct-openai");
    expect(plan.imagePath.credential).toMatchObject({ id: "openai:petposterous", scope: "dedicated", credentialKey: "OPENAI_API_KEY_PETPOSTEROUS" });
    expect(plan.credentials.openai?.id).toBe("openai:petposterous");
  });

  it("3. ordinary merchants resolve the shared umbrella OpenAI credential (OPENAI_API_KEY_MAIN)", () => {
    const plan = resolveGenerationPlan({ merchantId: "m-classic", packProfileKey: null });
    expect(plan.assignmentKey).toBe("default");
    expect(plan.credentials.openai).toMatchObject({ id: "openai:shared", scope: "shared", credentialKey: "OPENAI_API_KEY_MAIN" });
  });

  it("4. ordinary merchants (and other packs) stay on the legacy image path", () => {
    expect(resolveGenerationPlan({ merchantId: "m-classic" }).imagePath).toBe("legacy");
    expect(resolveGenerationPlan({ merchantId: "m-classic", packProfileKey: "quotes" }).imagePath).toBe("legacy");
  });

  it("Petposterous decor goes to its direct Google path; apparel family needs the apparel storage path", () => {
    const poster = resolveGenerationPlan({ ...PP_APPAREL, productFamily: "poster", isApparel: false });
    expect(poster.imagePath !== "legacy" && poster.imagePath.kind).toBe("direct-google");
    // "apparel" family without the apparel storage path matches neither direct path.
    expect(resolveGenerationPlan({ ...PP_APPAREL, isApparel: false }).imagePath).toBe("legacy");
    expect(poster.credentials.openai?.id).toBe("openai:petposterous");
  });

  it("merchant assignment overrides pack assignment; a dedicated merchant credential never resolves to MAIN", () => {
    const custom: Record<string, GenerationAssignment> = {
      ...ASSIGNMENTS,
      "merchant:m-dedicated": {
        credentials: { openai: "openai:petposterous" },
        openaiImage: { mode: "direct", defaultRenderer: "openai-sunburst" },
      },
    };
    const plan = resolveGenerationPlan({ merchantId: "m-dedicated", packProfileKey: "petposterous", productFamily: "apparel", isApparel: true }, custom);
    expect(plan.assignmentKey).toBe("merchant:m-dedicated");
    expect(plan.imagePath !== "legacy" && plan.imagePath.renderer.model).toBe("gpt-image-2.5-sunburst");
    expect(plan.credentials.openai?.credentialKey).not.toBe("OPENAI_API_KEY_MAIN");
  });

  it("6. Flare at medium is the configured Petposterous default", () => {
    const plan = resolveGenerationPlan(PP_APPAREL);
    if (plan.imagePath === "legacy") throw new Error("expected direct");
    expect(selectRenderer(plan.imagePath)).toMatchObject({ model: "gpt-image-2.5-flare", quality: "medium" });
  });

  it("7. Sunburst is represented as the escalation renderer (never selected by default)", () => {
    const plan = resolveGenerationPlan(PP_APPAREL);
    if (plan.imagePath === "legacy") throw new Error("expected direct");
    expect(plan.imagePath.escalation?.model).toBe("gpt-image-2.5-sunburst");
    expect(selectRenderer(plan.imagePath, { escalate: true }).model).toBe("gpt-image-2.5-sunburst");
    expect(selectRenderer(plan.imagePath).model).toBe("gpt-image-2.5-flare");
  });

  it("OPENAI_API_KEY_MAIN is optional: resolving plans never reads env", () => {
    const plan = resolveGenerationPlan({ merchantId: "m-classic" });
    expect(plan.credentials.openai?.credentialKey).toBe("OPENAI_API_KEY_MAIN");
    expect(() => readCredential(CREDENTIALS["openai:shared"])).toThrow(ProviderCredentialUnavailableError);
  });
});

describe("direct OpenAI rendering", () => {
  it("2 + 8. Petposterous apparel uses the Petposterous key, Flare, transparent PNG, medium, exact 4:5 size", async () => {
    process.env.OPENAI_API_KEY_PETPOSTEROUS = PP_KEY;
    process.env.OPENAI_API_KEY_MAIN = MAIN_KEY;
    const out = await generateImageBase64({
      ...apparelParams,
      generationPlan: resolveGenerationPlan(PP_APPAREL),
      endUserId: openAIEndUserId("pp.myshopify.com", "cust-uuid"),
    });

    expect(await samePixels(out.data, pngB64)).toBe(true);
    expect(calledUrls()).toEqual(["https://api.openai.com/v1/images/generations"]);
    expect(authHeader(0)).toBe(`Bearer ${PP_KEY}`);
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(body).toMatchObject({
      model: "gpt-image-2.5-flare",
      background: "transparent",
      output_format: "png",
      quality: "medium",
      size: "1024x1280",
      n: 1,
    });
    expect(body.user).toMatch(/^[0-9a-f]{32}$/);
    expect(body.style).toBeUndefined();
    expect(out.meta).toMatchObject({
      provider: "openai",
      credentialRefId: "openai:petposterous",
      credentialScope: "dedicated",
      model: "gpt-image-2.5-flare",
      attempts: 1,
      transparent: true,
      providerRequestId: "req_test_123",
    });
    expect(out.meta?.usage).toMatchObject({ textInputTokens: 1000, imageInputTokens: 200, outputTokens: 4000 });
    expect(out.meta?.estimatedCostUsd).toBeCloseTo((1000 * 5 + 200 * 8 + 4000 * 30) / 1e6, 6);
  });

  it("4b. ordinary merchants keep the existing Replicate path even with both OpenAI keys set", async () => {
    process.env.OPENAI_API_KEY_PETPOSTEROUS = PP_KEY;
    process.env.OPENAI_API_KEY_MAIN = MAIN_KEY;
    for (const generationPlan of [undefined, resolveGenerationPlan({ merchantId: "m-classic" })]) {
      fetchMock.mockClear();
      await generateImageBase64({ ...apparelParams, packLayered: undefined, transparencyCheck: undefined, generationPlan });
      expect(calledUrls()[0]).toBe("https://api.replicate.com/v1/models/openai/gpt-image-2/predictions");
      expect(calledUrls().some((u) => u.includes("openai.com"))).toBe(false);
      expect(authHeader(0)).toBe(`Bearer ${REPLICATE_TOKEN}`);
    }
    // Classic Nano Banana (non-native) also untouched.
    fetchMock.mockClear();
    await generateImageBase64({
      ...apparelParams,
      generationModel: "nano-banana",
      nativeTransparent: false,
      generationPlan: resolveGenerationPlan({ merchantId: "m-classic" }),
    });
    expect(calledUrls()[0]).toBe("https://api.replicate.com/v1/predictions");
  });

  it("5. missing Petposterous key fails before any network call — no MAIN, Replicate or Nano Banana fallback", async () => {
    process.env.OPENAI_API_KEY_MAIN = MAIN_KEY;
    const err = await generateImageBase64({ ...apparelParams, generationPlan: resolveGenerationPlan(PP_APPAREL) }).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderCredentialUnavailableError);
    expect(err.code).toBe("PROVIDER_CREDENTIAL_UNAVAILABLE");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(customerSafeGenerationError(err, resolveGenerationPlan(PP_APPAREL))).toBe(err.message);
    expect(err.message).not.toMatch(/OPENAI|sk-|key/i);
  });

  it("10. pet + owner references go to images/edits as ordered image[] parts matching the role lines", async () => {
    process.env.OPENAI_API_KEY_PETPOSTEROUS = PP_KEY;
    const roleLines = buildRoleReferenceInstruction({
      styleImageCount: 0,
      customerImages: [
        { role: "pet", label: "Malcolm" },
        { role: "owner", label: "" },
      ] as any,
    });
    expect(roleLines).toMatch(/Image 1:.*pet[\s\S]*Image 2:.*owner/);

    const pet = `data:image/png;base64,${pngB64}`;
    const owner = "https://storage.example/signed/owner.jpg?token=abc";
    await generateImageBase64({
      ...apparelParams,
      prompt: `${roleLines}\n${apparelParams.prompt}`,
      inputImageUrl: [pet, owner],
      generationPlan: resolveGenerationPlan(PP_APPAREL),
    });
    const openaiCalls = fetchMock.mock.calls.filter((c) => String(c[0]).startsWith("https://api.openai.com/"));
    expect(openaiCalls.map((c) => String(c[0]))).toEqual(["https://api.openai.com/v1/images/edits"]);
    expect(calledUrls()).toContain(owner);
    const form = (openaiCalls[0][1] as RequestInit).body as FormData;
    expect(form).toBeInstanceOf(FormData);
    const images = [...form.entries()].filter(([k]) => k.startsWith("image")).map(([, v]) => (v as File).name);
    expect(images).toEqual(["reference-1.png", "reference-2.png"]);
    expect(form.get("model")).toBe("gpt-image-2.5-flare");
    expect(form.get("background")).toBe("transparent");
    expect(String(form.get("prompt"))).toMatch(/Image 1:.*pet[\s\S]*Image 2:.*owner/);
  });

  it("words modes: exact and no-text rules reach Flare verbatim (pack prompts are not truncated)", async () => {
    process.env.OPENAI_API_KEY_PETPOSTEROUS = PP_KEY;
    const { PETPOSTEROUS_PROMPT_PROFILE } = await import("@shared/packs/petposterous");
    for (const rule of [PETPOSTEROUS_PROMPT_PROFILE.exactTextRule, PETPOSTEROUS_PROMPT_PROFILE.noTextRule]) {
      fetchMock.mockClear();
      const prompt = `${"Creative direction. ".repeat(80)}\n${rule}\nRender the following text EXACTLY as written: "NO REMORSE."`;
      await generateImageBase64({ ...apparelParams, prompt, generationPlan: resolveGenerationPlan(PP_APPAREL) });
      const sent = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body)).prompt as string;
      expect(sent).toContain(String(rule));
      expect(sent).toContain('"NO REMORSE."');
    }
  });

  it("10b. pet only sends a single reference", async () => {
    process.env.OPENAI_API_KEY_PETPOSTEROUS = PP_KEY;
    await generateImageBase64({
      ...apparelParams,
      inputImageUrl: [`data:image/png;base64,${pngB64}`],
      generationPlan: resolveGenerationPlan(PP_APPAREL),
    });
    const editCall = fetchMock.mock.calls.find((c) => String(c[0]) === "https://api.openai.com/v1/images/edits");
    const form = (editCall![1] as RequestInit).body as FormData;
    expect([...form.entries()].filter(([k]) => k.startsWith("image"))).toHaveLength(1);
  });

  it("opaque Flare output retries once on Flare (no escalation), then fails — never chroma", async () => {
    process.env.OPENAI_API_KEY_PETPOSTEROUS = PP_KEY;
    fetchMock.mockImplementation(async () => jsonResponse({ data: [{ b64_json: opaqueB64 }], usage: USAGE }));
    const err = await generateImageBase64({ ...apparelParams, generationPlan: resolveGenerationPlan(PP_APPAREL) }).catch((e) => e);
    expect(err?.code).toBe("NATIVE_TRANSPARENCY_FAILED");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const c of fetchMock.mock.calls) expect(JSON.parse(String((c[1] as RequestInit).body)).model).toBe("gpt-image-2.5-flare");

    fetchMock.mockReset();
    fetchMock
      .mockImplementationOnce(async () => jsonResponse({ data: [{ b64_json: opaqueB64 }], usage: USAGE }))
      .mockImplementationOnce(async () => jsonResponse({ data: [{ b64_json: pngB64 }], usage: USAGE }));
    const ok = await generateImageBase64({ ...apparelParams, generationPlan: resolveGenerationPlan(PP_APPAREL) });
    expect(ok.meta?.attempts).toBe(2);
    expect(ok.meta?.usage?.outputTokens).toBe(8000);
  });
});

describe("alpha, secrets, telemetry", () => {
  it("9. PNG alpha survives: provider bytes returned untouched and stored via the native (no-chroma) path", async () => {
    process.env.OPENAI_API_KEY_PETPOSTEROUS = PP_KEY;
    const out = await generateImageBase64({ ...apparelParams, generationPlan: resolveGenerationPlan(PP_APPAREL) });
    expect(await samePixels(out.data, pngB64)).toBe(true);
    const buf = Buffer.from(out.data, "base64");
    const meta = await sharp(buf).metadata();
    expect(meta.format).toBe("png");
    expect(meta.hasAlpha).toBe(true);
    const { data } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
    const alphas = new Set<number>();
    for (let i = 3; i < data.length; i += 4) alphas.add(data[i]);
    expect([...alphas].sort((a, b) => a - b)).toEqual([0, 128, 255]); // clear, soft edge, solid
    // Direct plan forces skipChroma → native storage path (no chroma/flatten).
    expect(storagePathFor({ isApparel: true, skipChroma: true })).toBe("native");
    expect(storagePathFor({ isApparel: true, skipChroma: false })).toBe("chroma");
  });

  it("11. secret values never reach public payloads, plans, client code or theme extensions", () => {
    process.env.OPENAI_API_KEY_PETPOSTEROUS = PP_KEY;
    process.env.OPENAI_API_KEY_MAIN = MAIN_KEY;
    const plan = JSON.stringify(resolveGenerationPlan(PP_APPAREL));
    expect(plan).not.toContain(PP_KEY);
    expect(plan).not.toContain(MAIN_KEY);
    const pub = JSON.stringify(
      publicExperienceProfile(
        { slug: "petposterous", stylePackId: "pack-1", config: {} } as any,
        { humorOptions: [], relationshipOptions: [] } as any,
      ),
    );
    for (const s of [PP_KEY, MAIN_KEY, "OPENAI_API_KEY", "gpt-image-2.5"]) expect(pub).not.toContain(s);

    const root = path.resolve(__dirname, "..");
    const scan = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) return e.name === "node_modules" ? [] : scan(p);
        return /\.(tsx?|jsx?|liquid|json)$/.test(e.name) ? [p] : [];
      });
    for (const file of [...scan(path.join(root, "client", "src")), ...scan(path.join(root, "extensions")), ...scan(path.join(root, "shared"))]) {
      const src = fs.readFileSync(file, "utf8");
      expect(src, file).not.toMatch(
        /OPENAI_API_KEY|GEMINI_API_KEY|generation-providers|openai-image-client|google-image-client|gpt-image-2\.5|gemini-3/,
      );
    }
  });

  it("11b. keys never appear in errors or logs, even when the provider echoes them", async () => {
    process.env.OPENAI_API_KEY_PETPOSTEROUS = PP_KEY;
    fetchMock.mockImplementation(async () =>
      jsonResponse({ error: { message: `Incorrect API key provided: ${PP_KEY}.`, type: "invalid_request_error", code: "invalid_api_key" } }, 401),
    );
    const plan = resolveGenerationPlan(PP_APPAREL);
    const err = await generateImageBase64({ ...apparelParams, generationPlan: plan }).catch((e) => e);
    expect(err?.category).toBe("auth");
    expect(String(err.message)).not.toContain(PP_KEY);
    expect(customerSafeGenerationError(err, plan)).toBe("We couldn't create this artwork right now. Please try again.");
    for (const line of logged) expect(line).not.toContain(PP_KEY);
    expect(redactSecrets(`x ${PP_KEY} sk-abcdefgh1234`, PP_KEY)).toBe("x [redacted] [redacted]");
  });

  it("12. telemetry row carries provider/model/merchant/case-study fields and no credentials or private text", () => {
    process.env.OPENAI_API_KEY_PETPOSTEROUS = PP_KEY;
    const plan = resolveGenerationPlan(PP_APPAREL);
    const row = buildGenerationEventRow(
      {
        kind: "image",
        route: "storefront-generate",
        jobId: "job-1",
        merchantId: "m-pp",
        shopDomain: "pp.myshopify.com",
        experienceProfile: "petposterous",
        stylePack: "petposterous-v1",
        styleSlug: "pp-deadpan",
        productFamily: "apparel",
        visualSystem: "editorial-deadpan",
        conceptFramework: "caught-in-the-act",
        plan,
        endUserHash: openAIEndUserId("pp.myshopify.com", "cust-uuid"),
      },
      {
        success: true,
        durationMs: 14321,
        meta: {
          provider: "openai",
          credentialRefId: "openai:petposterous",
          credentialScope: "dedicated",
          model: "gpt-image-2.5-flare",
          quality: "medium",
          size: "1024x1280",
          attempts: 1,
          durationMs: 14000,
          transparent: true,
          transparentFraction: 0.41,
          usage: { inputTokens: 1200, outputTokens: 4000, totalTokens: 5200, textInputTokens: 1000, imageInputTokens: 200 },
          estimatedCostUsd: 0.1266,
          providerRequestId: "req_1",
        },
      },
    );
    expect(row).toMatchObject({
      merchantId: "m-pp",
      shopDomain: "pp.myshopify.com",
      provider: "openai",
      credentialScope: "dedicated",
      credentialRef: "openai:petposterous",
      model: "gpt-image-2.5-flare",
      productFamily: "apparel",
      visualSystem: "editorial-deadpan",
      conceptFramework: "caught-in-the-act",
      attempts: 1,
      transparent: true,
      success: true,
      errorCategory: null,
    });
    const json = JSON.stringify(row);
    for (const s of [PP_KEY, "OPENAI_API_KEY", "cust-uuid", "HE HEARD YOU", "Malcolm"]) expect(json).not.toContain(s);

    const failed = buildGenerationEventRow({ kind: "image", route: "storefront-generate", plan }, {
      success: false,
      durationMs: 5,
      error: new ProviderCredentialUnavailableError(),
    });
    expect(failed.errorCategory).toBe("credential_missing");
    const legacy = buildGenerationEventRow(
      { kind: "image", route: "storefront-generate", plan: resolveGenerationPlan({ merchantId: "m" }), legacyModel: "nano-banana" },
      { success: true, durationMs: 9000 },
    );
    expect(legacy).toMatchObject({ provider: "replicate", credentialRef: "replicate:shared", model: "nano-banana" });
  });

  it("size and cost helpers follow the documented constraints", () => {
    expect(openAIImageSize("1:1")).toBe("1024x1024");
    expect(openAIImageSize("4:5")).toBe("1024x1280");
    expect(openAIImageSize("2:3")).toBe("1024x1536");
    expect(openAIImageSize("16:9")).toBe("1824x1024");
    expect(openAIImageSize("10:1")).toBe("3072x1024");
    expect(estimateOpenAIImageCostUsd(null, CREDENTIALS as any)).toBeNull();
  });
});
