import { afterEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import "@shared/schema";
import { compressPrompt } from "./replit_integrations/image/client";
import { isOpaqueNativeOutput, measureTransparency } from "./native-transparency";
import { packConceptEngine, packConceptUserMessage, parsePackConceptOptions } from "./pack-concept-engine";
import { generateQuoteOptions } from "./quote-options";

const HEAD = "HEAD-CREATIVE-BASE ";
const long = `=== ARTWORK DESCRIPTION ===\n${HEAD}${"middle text. ".repeat(150)}TAIL`;

describe("prompt length", () => {
  it("legacy layered prompts are still cut to the last 900 chars", () => {
    const out = compressPrompt(long, true, false, null, false, "1:1", false, true, true);
    expect(out.length).toBe(900);
    expect(out).not.toContain(HEAD);
    expect(out.endsWith("TAIL")).toBe(true);
  });

  it("pack prompts are never cut", () => {
    const out = compressPrompt(long, true, false, null, false, "1:1", false, true, true, true);
    expect(out.startsWith(HEAD)).toBe(true);
    expect(out.endsWith("TAIL")).toBe(true);
    expect(out.length).toBeGreaterThan(900);
  });
});

describe("pack concept engine", () => {
  const option = (punchline: string) => ({
    funny_truth: "He knows the rules and ignores them.",
    visual_joke: "Cat on the keyboard mid-meeting.",
    punchline,
    subject_priority: "orange tabby, white chin",
  });

  it("accepts 0-6 word punchlines and exactly three options", () => {
    const ok = parsePackConceptOptions({ options: [option(""), option("HE HEARD YOU."), option("one two three four five six")] }, 6);
    expect(ok?.map((o) => o.punchline)).toEqual(["", "HE HEARD YOU.", "one two three four five six"]);
    expect(parsePackConceptOptions({ options: [option("a"), option("b")] }, 6)).toBeNull();
  });

  it("rejects a punchline over the cap and missing fields", () => {
    expect(parsePackConceptOptions({ options: [option("one two three four five six seven"), option(""), option("")] }, 6)).toBeNull();
    expect(parsePackConceptOptions({ options: [{ ...option(""), visual_joke: "" }, option(""), option("")] }, 6)).toBeNull();
  });

  it("builds from a profile; no concept config = no engine", () => {
    const base = {
      key: "t",
      creativeBase: "",
      textRule: "",
      referenceIdentity: "",
      rendererExtra: {},
      humorOptions: [],
      relationshipOptions: [],
    };
    expect(packConceptEngine({ ...base, concept: null })).toBeNull();
    const engine = packConceptEngine({ ...base, concept: { system: "Write pet comedy.", punchlineMaxWords: 6 } })!;
    expect(engine.system).toContain("Write pet comedy.");
    expect(engine.system).toContain("at most 6 words");
    expect(engine.id).toBe("pack:t");
  });

  it("labels inputs and skips empty ones", () => {
    expect(packConceptUserMessage([["pet", "Malcolm, tabby"], ["behaviour", ""], ["humor", "dry"]])).toBe(
      "PET: Malcolm, tabby\nHUMOR: dry\nWrite three options.",
    );
  });
});

describe("Quotes request is unchanged by the engine registry", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.ANTHROPIC_API_KEY;
  });

  it("sends the same system prompt, model, token cap and user message", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const calls: any[] = [];
    vi.stubGlobal("fetch", async (url: string, init: any) => {
      calls.push({ url, init });
      const options = [1, 2, 3].map((i) => ({ quote: `Line ${i}`, art_brief: "a fox", font_suggestion: "western slab" }));
      return new Response(JSON.stringify({ content: [{ type: "text", text: JSON.stringify({ options }) }] }), { status: 200 });
    });
    const out = await generateQuoteOptions("fishing", "funny");
    expect(out).toHaveLength(3);
    const body = JSON.parse(calls[0].init.body);
    expect(calls[0].url).toBe("https://api.anthropic.com/v1/messages");
    expect(body.model).toBe("claude-sonnet-4-6");
    expect(body.max_tokens).toBe(800);
    expect(body.system.startsWith("You write original t-shirt quotes from a customer's THEME and a VOICE.")).toBe(true);
    expect(body.messages).toEqual([
      { role: "user", content: "THEME: fishing\nVOICE: funny — punchy, mass-appeal joke — a tee someone would actually wear\nWrite three options." },
    ]);
  });
});

describe("native transparency check", () => {
  const png = async (bg: { r: number; g: number; b: number; alpha: number }) => {
    const motif = await sharp({ create: { width: 40, height: 40, channels: 4, background: { r: 200, g: 30, b: 30, alpha: 1 } } })
      .png()
      .toBuffer();
    const buf = await sharp({ create: { width: 100, height: 100, channels: 4, background: bg } })
      .composite([{ input: motif, left: 30, top: 30 }])
      .png()
      .toBuffer();
    return buf.toString("base64");
  };

  it("transparent motif passes", async () => {
    const r = await measureTransparency(await png({ r: 0, g: 0, b: 0, alpha: 0 }));
    expect(r.hasAlpha).toBe(true);
    expect(r.transparentFraction).toBeGreaterThan(0.5);
    expect(isOpaqueNativeOutput(r)).toBe(false);
  });

  it("opaque plate fails", async () => {
    const r = await measureTransparency(await png({ r: 255, g: 255, b: 255, alpha: 1 }));
    expect(isOpaqueNativeOutput(r)).toBe(true);
    const noAlpha = (await sharp({ create: { width: 10, height: 10, channels: 3, background: "#fff" } }).png().toBuffer()).toString("base64");
    expect(isOpaqueNativeOutput(await measureTransparency(noAlpha))).toBe(true);
  });
});
