/**
 * Concept engines — cheap Anthropic Messages calls that write options before
 * image generation (Quotes Step A, style-pack concept/punchline writers).
 * Never on the Replicate/generate path. Never debits a credit. Fail closed on
 * slow / 4xx / 5xx / bad JSON / wrong option count.
 *
 * Env: ANTHROPIC_API_KEY (required). Optional ANTHROPIC_QUOTES_MODEL.
 */

const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-sonnet-4-6";
const TIMEOUT_MS = 12_000;

export function anthropicApiKey(): string {
  return String(process.env.ANTHROPIC_API_KEY || "").trim();
}

export function anthropicQuotesModel(): string {
  return String(process.env.ANTHROPIC_QUOTES_MODEL || "").trim() || DEFAULT_MODEL;
}

const SECRET_RE = /sk-ant-[A-Za-z0-9_-]+/g;

export function redactAnthropicSecrets(text: string): string {
  return String(text || "").replace(SECRET_RE, "[redacted]");
}

export type AnthropicErrorDetail = {
  anthropicStatus: number;
  anthropicType: string | null;
  anthropicMessage: string | null;
};

/** Status / type / message only — never the raw key or full wire dump. */
export function summarizeAnthropicError(status: number, body: string): AnthropicErrorDetail {
  const safe = redactAnthropicSecrets((body || "").trim());
  let type: string | null = null;
  let message: string | null = null;
  try {
    const parsed = JSON.parse(safe) as {
      type?: unknown;
      message?: unknown;
      error?: { type?: unknown; message?: unknown };
    };
    const inner = parsed?.error;
    if (inner && typeof inner === "object") {
      if (typeof inner.type === "string") type = inner.type;
      if (typeof inner.message === "string") message = inner.message;
    }
    if (!type && typeof parsed?.type === "string") type = parsed.type;
    if (!message && typeof parsed?.message === "string") message = parsed.message;
  } catch {
    // not JSON — fall through to truncated body
  }
  if (!message && safe) message = safe;
  if (message) message = redactAnthropicSecrets(message).slice(0, 300);
  return {
    anthropicStatus: status,
    anthropicType: type,
    anthropicMessage: message,
  };
}

/**
 * One registered writer. `quoteStage` / `quoteDetail` error fields keep their
 * original names — the storefront toast payload reads them.
 */
export type ConceptEngine<TOption> = {
  id: string;
  /** Log prefix, e.g. "[quote-options]". */
  logTag: string;
  /** Customer-facing noun, e.g. "Quote writer". */
  noun: string;
  system: string;
  maxTokens: number;
  parse(raw: unknown): TOption[] | null;
};

export type ConceptStage = "fetch" | "json-parse" | "validation";

export async function runConceptEngine<TOption>(
  engine: ConceptEngine<TOption>,
  userMessage: string,
): Promise<TOption[]> {
  const key = anthropicApiKey();
  if (!key) {
    throw Object.assign(new Error("ANTHROPIC_API_KEY is not configured"), { status: 503 });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let quoteStage: ConceptStage = "fetch";
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
        max_tokens: engine.maxTokens,
        system: engine.system,
        messages: [{ role: "user", content: userMessage }],
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const safeBody = redactAnthropicSecrets(body);
      console.warn(`${engine.logTag} Anthropic`, res.status, safeBody.slice(0, 400));
      throw Object.assign(new Error(`${engine.noun} is unavailable`), {
        status: 502,
        quoteStage: "fetch",
        ...summarizeAnthropicError(res.status, safeBody),
      });
    }
    quoteStage = "json-parse";
    let json: { content?: Array<{ type?: string; text?: string } | null> };
    try {
      json = (await res.json()) as typeof json;
    } catch (parseErr: any) {
      console.warn(`${engine.logTag} json-parse`, parseErr?.message || parseErr);
      throw Object.assign(new Error("Anthropic response was not JSON"), {
        status: 502,
        quoteStage: "json-parse",
        quoteDetail: redactAnthropicSecrets(String(parseErr?.message || "")).slice(0, 300),
      });
    }
    const blocks = Array.isArray(json.content) ? json.content : [];
    const text = blocks
      .filter((b) => b && b.type === "text" && b.text)
      .map((b) => b.text)
      .join("\n")
      .trim();
    quoteStage = "validation";
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
    const options = engine.parse(parsed);
    if (!options) {
      const rawModelText = redactAnthropicSecrets(text).slice(0, 300);
      console.warn(`${engine.logTag} validation failed raw:`, rawModelText);
      throw Object.assign(new Error(`${engine.noun} returned an invalid set`), {
        status: 502,
        quoteStage: "validation",
        rawModelText,
      });
    }
    return options;
  } catch (err: any) {
    if (err?.status) throw err;
    const aborted = err?.name === "AbortError" || err?.cause?.name === "AbortError";
    if (aborted) {
      throw Object.assign(new Error(`${engine.noun} timed out`), {
        status: 504,
        quoteStage,
      });
    }
    console.warn(`${engine.logTag} throw`, quoteStage, err?.stack || err);
    throw Object.assign(new Error(`${engine.noun} is unavailable`), {
      status: 502,
      quoteStage,
      quoteDetail: redactAnthropicSecrets(String(err?.message || "")).slice(0, 300),
      stack: err?.stack,
    });
  } finally {
    clearTimeout(timer);
  }
}
