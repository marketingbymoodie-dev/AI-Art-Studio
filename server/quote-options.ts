/**
 * Quotes Step A — cheap Sonnet call via the concept-engine runner
 * (server/concept-engine.ts). Never debits a credit. Fail closed on slow /
 * 4xx / 5xx / bad JSON / ≠3.
 */

import {
  FONT_SUGGESTION_FORBIDDEN,
  fontSuggestionIsLetterformOnly,
  parseQuotesVoice,
  QUOTES_VOICE_BRIEFS,
  type QuoteOption,
  type QuotesVoiceId,
} from "@shared/quotesStyle";
import { redactAnthropicSecrets, runConceptEngine, type ConceptEngine } from "./concept-engine";

export {
  anthropicApiKey,
  anthropicQuotesModel,
  redactAnthropicSecrets,
  summarizeAnthropicError,
  type AnthropicErrorDetail,
} from "./concept-engine";

export type QuoteStage = "fetch" | "json-parse" | "validation";

/** Staging / toast fields. Status, type, message, stage — never the API key. */
export function stagingQuoteErrorPayload(err: any): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    error: err?.message || "Quote writer is unavailable",
  };
  if (err?.quoteStage) payload.quoteStage = err.quoteStage;
  if (err?.quoteDetail) {
    payload.quoteDetail = redactAnthropicSecrets(String(err.quoteDetail)).slice(0, 300);
  }
  if (err?.anthropicStatus) payload.anthropicStatus = err.anthropicStatus;
  if (err?.anthropicType) payload.anthropicType = err.anthropicType;
  if (err?.anthropicMessage) payload.anthropicMessage = err.anthropicMessage;
  if (err?.rawModelText) {
    payload.rawModelText = redactAnthropicSecrets(String(err.rawModelText)).slice(0, 300);
  }
  if (err?.stack) {
    payload.stack = redactAnthropicSecrets(String(err.stack)).slice(0, 600);
  }
  return payload;
}

const SYSTEM = `You write original t-shirt quotes from a customer's THEME and a VOICE.

Return ONLY JSON: {"options":[{ "quote": string, "art_brief": string, "font_suggestion": string }, ...]}
Exactly THREE options. No markdown, no commentary.

Rules:
- quote: one original line in the requested voice, on-theme. Do not copy famous quotes. No wrapping quotation marks.
- art_brief: one-line illustration SUBJECT that fits the quote AND the theme/niche. Subject only — no print method, no composition, no color recipe.
- font_suggestion: niche-appropriate classic LETTERFORM feel only (e.g. western slab, hand script, heavy comic display sans). Letterform CHARACTER only.
- font_suggestion must NEVER mention print method, composition, color, palette, chroma, gradient, sticker, texture, cartoon, silhouette, screen print, or "print style".
- Do not invent a fourth option. Do not omit fields.`;

function voiceUserMessage(theme: string, voice: QuotesVoiceId): string {
  return `THEME: ${theme}\nVOICE: ${voice} — ${QUOTES_VOICE_BRIEFS[voice]}\nWrite three options.`;
}

function parseOptions(raw: unknown): QuoteOption[] | null {
  if (!raw || typeof raw !== "object") return null;
  const list = (raw as { options?: unknown }).options;
  if (!Array.isArray(list) || list.length !== 3) return null;
  const options: QuoteOption[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") return null;
    const quote = String((item as { quote?: unknown }).quote || "").trim();
    const art_brief = String((item as { art_brief?: unknown }).art_brief || "").trim();
    const font_suggestion = String((item as { font_suggestion?: unknown }).font_suggestion || "").trim();
    if (!quote || !art_brief || !font_suggestion) return null;
    if (!fontSuggestionIsLetterformOnly(font_suggestion)) {
      console.warn("[quote-options] rejected font_suggestion:", font_suggestion, FONT_SUGGESTION_FORBIDDEN);
      return null;
    }
    options.push({
      quote: quote.replace(/^["“”]+|["“”]+$/g, "").trim(),
      art_brief,
      font_suggestion,
    });
  }
  return options.length === 3 ? options : null;
}

/** Quotes Step A, registered as a concept engine. Request is byte-identical to the pre-registry call. */
export const QUOTES_CONCEPT_ENGINE: ConceptEngine<QuoteOption> = {
  id: "quotes",
  logTag: "[quote-options]",
  noun: "Quote writer",
  system: SYSTEM,
  maxTokens: 800,
  parse: parseOptions,
};

export async function generateQuoteOptions(theme: string, voiceRaw: string): Promise<QuoteOption[]> {
  const voice = parseQuotesVoice(voiceRaw);
  if (!voice) {
    throw Object.assign(new Error("Invalid quote voice"), { status: 400 });
  }
  const trimmedTheme = theme.trim();
  if (!trimmedTheme) {
    throw Object.assign(new Error("Theme is required"), { status: 400 });
  }
  return runConceptEngine(QUOTES_CONCEPT_ENGINE, voiceUserMessage(trimmedTheme, voice));
}
