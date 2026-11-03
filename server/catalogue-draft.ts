/**
 * One vision draft for a catalogue PNG that has no CSV row.
 * Uses the same Anthropic key and model as the listing writer.
 * Does not store a candidate and does not call Recraft.
 */
import sharp from "sharp";
import {
  catalogueDraftCostUsd,
  catalogueFrameworkGuide,
  normaliseCatalogueDraft,
  type CatalogueDraftUsage,
} from "@shared/catalogueBulkImport";
import { PETPOSTEROUS_ART_STYLE_LAUNCH } from "@shared/petposterousArtStyles";
import { anthropicApiKey, anthropicQuotesModel, redactAnthropicSecrets, summarizeAnthropicError } from "./concept-engine";

const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const TIMEOUT_MS = 45_000;
const STYLE_GUIDE = [
  "vintage-engraving: antique engraved plate, cross-hatching, monochrome",
  "pen-ink: sparse editorial pen, black contour, stippling, open paper",
  "woodcut: carved linocut, solid ink masses, gouged marks",
  "retro-character: vintage character illustration, chunky outlines, halftone",
  "bold-type: the words are the design, a small pet sits in the lettering",
  "folk-graphic: naive handmade folk drawing, awkward proportions, warm flat inks",
].join("\n");

export type CatalogueDraftResult = {
  species: string;
  style: string;
  humourOperator: string;
  truth: string;
  device: string;
  exactWording: string;
  lowConfidence: { style: boolean; humourOperator: boolean };
  costUsd: number | null;
  inputTokens: number;
  outputTokens: number;
  model: string;
};

const VISION_GREY = { r: 0x80, g: 0x80, b: 0x80 };

/**
 * Image sent to the vision model. Transparent pixels are flattened onto
 * middle grey so white ink stays visible. The stored PNG is never this buffer.
 */
export async function catalogueVisionImage(buf: Buffer): Promise<Buffer> {
  const flattened = await sharp(buf).flatten({ background: VISION_GREY }).png().toBuffer();
  const meta = await sharp(flattened).metadata();
  const wide = (meta.width || 0) > 1568 || (meta.height || 0) > 1568;
  const resized = wide
    ? await sharp(flattened).resize({ width: 1568, height: 1568, fit: "inside", withoutEnlargement: true }).png().toBuffer()
    : flattened;
  if (resized.length <= 4_000_000) return resized;
  return sharp(resized).jpeg({ quality: 90 }).toBuffer();
}

export async function draftCatalogueImage(png: Buffer): Promise<CatalogueDraftResult> {
  const key = anthropicApiKey();
  if (!key) throw Object.assign(new Error("ANTHROPIC_API_KEY is not configured"), { status: 503 });
  const model = anthropicQuotesModel();
  const image = await catalogueVisionImage(png);
  const mediaType = image[0] === 0xff && image[1] === 0xd8 ? "image/jpeg" : "image/png";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(ANTHROPIC_MESSAGES_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 400,
        system: [
          "You read one Petposterous shirt design and return only JSON.",
          "Do not write a title or a product description.",
          "species is the animal, one or two words. Blank if you cannot tell.",
          `style is one of ${PETPOSTEROUS_ART_STYLE_LAUNCH.join(", ")}, or empty.`,
          "style_confidence is high only when the drawing clearly is that style. If you are unsure, style_confidence is low and style is empty. Do not guess.",
          "humour_operator is one of the sixteen ids, or empty.",
          "humour_confidence is high only when the joke clearly is that framework. If you are unsure, humour_confidence is low and humour_operator is empty. Do not guess.",
          "truth is one flat deadpan sentence of what the pet is doing.",
          "device is one sentence on how the joke is staged visually.",
          "exact_wording is the lettering visible in the image, copied exactly, with its capitalisation and punctuation.",
          "Do not invent, correct, or improve the lettering. If the image has no text, exact_wording is an empty string.",
          'Return only {"species": string, "style": string, "style_confidence": "high" | "low", "humour_operator": string, "humour_confidence": "high" | "low", "truth": string, "device": string, "exact_wording": string}.',
        ].join(" "),
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: image.toString("base64") } },
            { type: "text", text: `Styles:\n${STYLE_GUIDE}\n\nHumour operators:\n${catalogueFrameworkGuide()}` },
          ],
        }],
      }),
    });
    const bodyText = await res.text();
    if (!res.ok) {
      const detail = summarizeAnthropicError(res.status, redactAnthropicSecrets(bodyText));
      throw Object.assign(new Error(detail.anthropicMessage || "The vision draft failed."), { status: 502 });
    }
    let json: { content?: Array<{ type?: string; text?: string }>; usage?: CatalogueDraftUsage };
    try {
      json = JSON.parse(bodyText) as typeof json;
    } catch {
      throw Object.assign(new Error("The vision draft was not JSON."), { status: 502 });
    }
    const usage = json.usage || {};
    const costUsd = catalogueDraftCostUsd(usage, model);
    const text = (json.content || []).filter((block) => block?.type === "text" && block.text).map((block) => block.text).join("\n");
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      const fenced = text.match(/\{[\s\S]*\}/);
      if (fenced) {
        try { parsed = JSON.parse(fenced[0]); } catch { parsed = null; }
      }
    }
    const draft = normaliseCatalogueDraft(parsed);
    if (!draft) {
      throw Object.assign(new Error("The vision draft could not be read."), {
        status: 502,
        costUsd,
        inputTokens: Number(usage.input_tokens) || 0,
        outputTokens: Number(usage.output_tokens) || 0,
        model,
      });
    }
    return {
      ...draft,
      costUsd,
      inputTokens: Number(usage.input_tokens) || 0,
      outputTokens: Number(usage.output_tokens) || 0,
      model,
    };
  } catch (err: any) {
    if (err?.status) throw err;
    const aborted = err?.name === "AbortError";
    throw Object.assign(new Error(aborted ? "The vision draft timed out." : "The vision draft failed."), { status: aborted ? 504 : 502 });
  } finally {
    clearTimeout(timer);
  }
}
