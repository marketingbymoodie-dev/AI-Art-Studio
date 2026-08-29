/**
 * Quotes Step A — cheap Sonnet call. Never on the Replicate/generate path.
 * Never debits a credit. Fail closed on slow / 4xx / 5xx / bad JSON / ≠3.
 *
 * Env: ANTHROPIC_API_KEY (required). Optional ANTHROPIC_QUOTES_MODEL.
 */

import {
  FONT_SUGGESTION_FORBIDDEN,
  fontSuggestionIsLetterformOnly,
  parseQuotesVoice,
  QUOTES_VOICE_BRIEFS,
  type QuoteOption,
  type QuotesVoiceId,
} from "@shared/quotesStyle";

const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-sonnet-4-6";
const TIMEOUT_MS = 12_000;

export function anthropicApiKey(): string {
  return String(process.env.ANTHROPIC_API_KEY || "").trim();
}

export function anthropicQuotesModel(): string {
  return String(process.env.ANTHROPIC_QUOTES_MODEL || "").trim() || DEFAULT_MODEL;
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

export async function generateQuoteOptions(theme: string, voiceRaw: string): Promise<QuoteOption[]> {
  const voice = parseQuotesVoice(voiceRaw);
  if (!voice) {
    throw Object.assign(new Error("Invalid quote voice"), { status: 400 });
  }
  const trimmedTheme = theme.trim();
  if (!trimmedTheme) {
    throw Object.assign(new Error("Theme is required"), { status: 400 });
  }
  const key = anthropicApiKey();
  if (!key) {
    throw Object.assign(new Error("ANTHROPIC_API_KEY is not configured"), { status: 503 });
  }

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
        model: anthropicQuotesModel(),
        max_tokens: 800,
        temperature: 0.9,
        system: SYSTEM,
        messages: [{ role: "user", content: voiceUserMessage(trimmedTheme, voice) }],
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn("[quote-options] Anthropic", res.status, body.slice(0, 400));
      throw Object.assign(new Error("Quote writer is unavailable"), { status: 502 });
    }
    const json = (await res.json()) as {
      content?: Array<{ type?: string; text?: string }>;
    };
    const text = (json.content || [])
      .filter((b) => b.type === "text" && b.text)
      .map((b) => b.text)
      .join("\n")
      .trim();
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      const fenced = text.match(/\{[\s\S]*\}/);
      if (fenced) {
        try {
          parsed = JSON.parse(fenced[0]);
        } catch {
          parsed = null;
        }
      }
    }
    const options = parseOptions(parsed);
    if (!options) {
      throw Object.assign(new Error("Quote writer returned an invalid set"), { status: 502 });
    }
    return options;
  } catch (err: any) {
    if (err?.status) throw err;
    if (err?.name === "AbortError") {
      throw Object.assign(new Error("Quote writer timed out"), { status: 504 });
    }
    throw Object.assign(new Error("Quote writer is unavailable"), { status: 502 });
  } finally {
    clearTimeout(timer);
  }
}
