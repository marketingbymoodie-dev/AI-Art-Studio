/** Default fill behind GPT-Image-2 Minimalist decor (native alpha). */
export const DEFAULT_DECOR_BACKGROUND_FILL = "#FFFFFF";

export type DecorBackgroundFill = string | "none";

/** White when omitted / invalid. `"none"` leaves the PNG transparent. */
export function parseDecorBackgroundFill(raw: unknown): DecorBackgroundFill {
  if (raw == null) return DEFAULT_DECOR_BACKGROUND_FILL;
  const s = String(raw).trim();
  if (!s || s.toLowerCase() === "none") return "none";
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return `#${s.slice(1).toUpperCase()}`;
  return DEFAULT_DECOR_BACKGROUND_FILL;
}
