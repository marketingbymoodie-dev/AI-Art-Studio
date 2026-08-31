/**
 * Distinguish generate failures so Preview Studio can offer Retry vs edit-then-generate.
 * Admin `/api/generate` used to return a bland 500 for every Replicate/OpenAI miss.
 */

export type GenerationFailureKind =
  | "retriable"
  | "content_prompt"
  | "content_reference"
  | "content_both";

export type GenerationFailureCode =
  | "RETRIABLE"
  | "CONTENT_PROMPT"
  | "CONTENT_REFERENCE"
  | "CONTENT_BOTH";

export type ClassifiedGenerationFailure = {
  kind: GenerationFailureKind;
  code: GenerationFailureCode;
  httpStatus: number;
  userMessage: string;
};

const CODE_TO_KIND: Record<GenerationFailureCode, GenerationFailureKind> = {
  RETRIABLE: "retriable",
  CONTENT_PROMPT: "content_prompt",
  CONTENT_REFERENCE: "content_reference",
  CONTENT_BOTH: "content_both",
};

const RETRIABLE_COPY = "Generation failed. Please try again.";
const TIMEOUT_COPY = "That run took too long. Please try again.";
const PROMPT_COPY =
  "Your description was flagged — please edit it and try again.";
const REFERENCE_COPY =
  "That reference image couldn't be used. Remove or replace it and try again.";
const BOTH_COPY =
  "The description or reference image was flagged — edit the words and/or replace the image, then try again.";

function flattenFailure(raw: unknown): string {
  if (raw == null) return "";
  if (typeof raw === "string") return raw;
  if (raw instanceof Error) {
    const extra = (raw as Error & { details?: unknown; body?: unknown }).details
      ?? (raw as Error & { body?: unknown }).body;
    return extra ? `${raw.message} ${flattenFailure(extra)}` : raw.message;
  }
  if (typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    return [o.code, o.error, o.message, o.details, o.detail].filter(Boolean).join(" ");
  }
  return String(raw);
}

export function extractHttpErrorPayload(err: unknown): Record<string, unknown> | null {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  const m = /^HTTP \d+:\s*([\s\S]+)$/.exec(msg);
  if (!m) return null;
  try {
    const parsed = JSON.parse(m[1]);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function fromCode(code: GenerationFailureCode, override?: string | null): ClassifiedGenerationFailure {
  const kind = CODE_TO_KIND[code];
  const userMessage =
    override?.trim() ||
    (kind === "content_prompt"
      ? PROMPT_COPY
      : kind === "content_reference"
        ? REFERENCE_COPY
        : kind === "content_both"
          ? BOTH_COPY
          : RETRIABLE_COPY);
  return {
    kind,
    code,
    httpStatus: kind === "retriable" ? 502 : 422,
    userMessage,
  };
}

const CONTENT_MARKERS =
  /safety system|content policy|content_policy|moderation|flagged|not (?:allowed|permitted)|violat(?:e|ion)|inappropriate|sensitive content|harmful/i;

const IMAGE_MARKERS =
  /reference image|input image|input_image|image_input|provided image|the image you (?:uploaded|provided)/i;

const PROMPT_MARKERS = /prompt|description|your (?:text|words)|user (?:text|prompt)/i;

/** Our own gpt-image-2 transparent reject is not a user-content block. */
const INTERNAL_TRANSPARENT = /rejected background:transparent|GptImage2TransparentRejected/i;

function looksLikeTimeout(text: string): boolean {
  return /timed out after|Request aborted|AbortError|aborted without reason|The operation was aborted/i.test(
    text,
  );
}

export function classifyGenerationFailure(raw: unknown): ClassifiedGenerationFailure {
  if (raw instanceof GenerationRequestError) {
    return fromCode(raw.code, raw.message);
  }
  const payload = extractHttpErrorPayload(raw);
  const text = [flattenFailure(raw), payload ? flattenFailure(payload) : ""].join(" ");

  const explicit = String(payload?.code || "").toUpperCase();
  if (explicit && explicit in CODE_TO_KIND) {
    const msg = typeof payload?.message === "string" ? payload.message : null;
    return fromCode(explicit as GenerationFailureCode, msg);
  }

  if (looksLikeTimeout(text)) {
    return { kind: "retriable", code: "RETRIABLE", httpStatus: 504, userMessage: TIMEOUT_COPY };
  }

  if (INTERNAL_TRANSPARENT.test(text)) {
    return { kind: "retriable", code: "RETRIABLE", httpStatus: 502, userMessage: RETRIABLE_COPY };
  }

  if (CONTENT_MARKERS.test(text)) {
    const image = IMAGE_MARKERS.test(text);
    const prompt = PROMPT_MARKERS.test(text);
    if (image && !prompt) return fromCode("CONTENT_REFERENCE");
    if (prompt && !image) return fromCode("CONTENT_PROMPT");
    if (image && prompt) return fromCode("CONTENT_BOTH");
    return fromCode("CONTENT_BOTH");
  }

  return { kind: "retriable", code: "RETRIABLE", httpStatus: 502, userMessage: RETRIABLE_COPY };
}

export class GenerationRequestError extends Error {
  kind: GenerationFailureKind;
  code: GenerationFailureCode;
  constructor(classified: ClassifiedGenerationFailure) {
    super(classified.userMessage);
    this.name = "GenerationRequestError";
    this.kind = classified.kind;
    this.code = classified.code;
  }
}

export function toGenerationRequestError(raw: unknown): GenerationRequestError {
  if (raw instanceof GenerationRequestError) return raw;
  return new GenerationRequestError(classifyGenerationFailure(raw));
}
