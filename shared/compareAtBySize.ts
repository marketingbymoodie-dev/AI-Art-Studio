/**
 * Optional crossed-out price for one product type, keyed by size name.
 * An empty value means that size has no compare-at.
 * The staging demo Softstyle (blueprint 145, provider 99, staging shop) keeps
 * this table. Petposterous and every other type start empty.
 */
export const STAGING_SOFTSTYLE_COMPARE_AT_BY_SIZE: Readonly<Record<string, string>> = {
  XS: "34.95",
  S: "34.95",
  M: "34.95",
  L: "34.95",
  XL: "34.95",
  "2XL": "39.50",
  "3XL": "39.50",
};

export const STAGING_SOFTSTYLE_COMPARE_AT_JSON = JSON.stringify(STAGING_SOFTSTYLE_COMPARE_AT_BY_SIZE);

export function formatCompareAtPrice(value: unknown): string {
  if (value == null) return "";
  const text = String(value).trim();
  if (!text) return "";
  const amount = Number(text);
  if (!Number.isFinite(amount) || amount <= 0) return "";
  return amount.toFixed(2);
}

export function parseCompareAtBySize(raw: unknown): Record<string, string> {
  let value = raw;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return {};
    try {
      value = JSON.parse(trimmed);
    } catch {
      return {};
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [size, price] of Object.entries(value as Record<string, unknown>)) {
    const name = size.trim();
    const formatted = formatCompareAtPrice(price);
    if (name && formatted) out[name] = formatted;
  }
  return out;
}

export function normaliseCompareAtBySize(
  raw: unknown,
): { ok: true; value: Record<string, string>; json: string } | { ok: false; error: string } {
  if (raw == null) return { ok: true, value: {}, json: "{}" };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "Compare-at prices must be a price per size." };
  }
  const value: Record<string, string> = {};
  for (const [size, price] of Object.entries(raw as Record<string, unknown>)) {
    const name = size.trim();
    if (!name) continue;
    const text = price == null ? "" : String(price).trim();
    if (!text) continue;
    const formatted = formatCompareAtPrice(text);
    if (!formatted) {
      return { ok: false, error: `Compare-at for ${name} must be a price above $0, or blank.` };
    }
    value[name] = formatted;
  }
  return { ok: true, value, json: JSON.stringify(value) };
}

export function compareAtForSize(map: Record<string, string>, sizeName: string): string {
  const direct = map[sizeName];
  if (direct) return direct;
  const key = Object.keys(map).find((name) => name.toLowerCase() === sizeName.toLowerCase());
  return key ? map[key] : "";
}

/** The size name on this variant, using the product type's own size labels. */
export function matchedSizeName(
  options: Array<string | null | undefined>,
  sizeNames: readonly string[],
): string | null {
  const present = options.map((option) => String(option || "").trim()).filter(Boolean);
  for (const name of sizeNames) {
    if (present.some((option) => option.toLowerCase() === name.toLowerCase())) return name;
  }
  return null;
}
