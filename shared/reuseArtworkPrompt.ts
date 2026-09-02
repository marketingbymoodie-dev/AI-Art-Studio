export const REUSE_REGENERATE_PREFIX =
  "Recreate this artwork for the new product aspect ratio.";

export function isReuseRegeneratePrompt(raw?: string | null): boolean {
  const t = (raw || "").trim();
  return /^recreate this artwork\b/i.test(t) && /new product aspect ratio/i.test(t);
}

/** Peel nested regenerate wrappers down to the customer's original idea. */
export function unwrapReuseOriginalIdea(raw?: string | null): string {
  let text = (raw || "").trim();
  for (let i = 0; i < 6 && text; i++) {
    if (!/^recreate this artwork\b/i.test(text) && !/\boriginal idea:/i.test(text)) {
      break;
    }
    const wrapped = text.match(/\boriginal idea:\s*(.+)$/i);
    if (wrapped?.[1]) {
      text = wrapped[1].trim();
      continue;
    }
    if (/^recreate this artwork\b/i.test(text)) {
      return "";
    }
    break;
  }
  return text;
}

export function buildReuseRegeneratePrompt(originalPrompt?: string | null): string {
  const idea = unwrapReuseOriginalIdea(originalPrompt);
  return idea ? `${REUSE_REGENERATE_PREFIX} Original idea: ${idea}` : REUSE_REGENERATE_PREFIX;
}

export function composeReuseRegenerateUserPrompt(
  base?: string | null,
  extra?: string | null,
): string {
  const b = (base || "").trim();
  const e = (extra || "").trim();
  if (b && e) return `${b} ${e}`;
  return b || e;
}
