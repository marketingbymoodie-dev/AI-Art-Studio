/**
 * Match a Shopify variant catalog entry by human-readable size + color.
 * Used for storefront blank images (embed-design) so slash colorways like
 * "White/ Navy" vs "White/Navy" vs slug "white_navy" resolve correctly.
 *
 * Important: when the product has a color axis, never fall back to
 * "first variant whose title contains the size" — that made White/Navy and
 * White/True Royal share the same blank image.
 */

export type ShopifyVariantMatchEntry = {
  id: string | number;
  title?: string | null;
  option1?: string | null;
  option2?: string | null;
};

/** Collapse spaces/underscores/hyphens and normalize slash spacing for comparison. */
export function normalizeShopifyVariantToken(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/\s*\/\s*/g, "/")
    .replace(/[\s_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

/** Color equality after slash/space normalization (not substring includes). */
export function shopifyColorTokensEqual(a: string, b: string): boolean {
  const na = normalizeShopifyVariantToken(a);
  const nb = normalizeShopifyVariantToken(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  // "white_navy" vs "white/navy" after slash→underscore
  const aSlashAsUnderscore = na.replace(/\//g, "_");
  const bSlashAsUnderscore = nb.replace(/\//g, "_");
  return aSlashAsUnderscore === bSlashAsUnderscore;
}

function sizeTokensMatch(a: string, b: string): boolean {
  const na = normalizeShopifyVariantToken(a);
  const nb = normalizeShopifyVariantToken(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  // Allow "2xl" ↔ "xxl" style only via equality of compact forms; avoid loose includes
  // that would match "s" inside "asphalt". Size names are short tokens.
  return false;
}

/** Match a Shopify option/title fragment to a frame colour id or display name. */
export function colorMatchesFrame(
  raw: string,
  frameName: string,
  frameColorId?: string,
): boolean {
  if (frameName && shopifyColorTokensEqual(raw, frameName)) return true;
  if (frameColorId && shopifyColorTokensEqual(raw, frameColorId)) return true;
  // Title often is "White / Navy / S" — check each slash segment and the full string.
  const parts = raw.split(/\s*\/\s*/);
  if (parts.length > 1) {
    // Reconstruct body/sleeve pair (first two segments) for baseball tees
    if (parts.length >= 2) {
      const pair = `${parts[0]}/${parts[1]}`;
      if (frameName && shopifyColorTokensEqual(pair, frameName)) return true;
      if (frameColorId && shopifyColorTokensEqual(pair, frameColorId)) return true;
    }
    for (const part of parts) {
      if (frameName && shopifyColorTokensEqual(part, frameName)) return true;
      if (frameColorId && shopifyColorTokensEqual(part, frameColorId)) return true;
    }
  }
  return false;
}

/**
 * Return the catalog entry id for size+color, or null if no safe match.
 * When `hasColors` is true, size-only fallback is never used.
 */
export function matchShopifyVariantBySizeColor(
  catalog: ShopifyVariantMatchEntry[],
  sizeName: string,
  frameName: string,
  hasColors: boolean,
  frameColorId?: string,
): string | null {
  if (catalog.length === 0) return null;

  const sizeNorm = normalizeShopifyVariantToken(sizeName);
  const wantsColor = hasColors && !!(frameName?.trim() || frameColorId?.trim());

  const optionMatch = (v: ShopifyVariantMatchEntry): boolean => {
    const options = [v.option1, v.option2].filter(Boolean).map((o) => String(o));
    if (options.length === 0) return false;

    let sizeMatch = !sizeNorm;
    if (sizeNorm) {
      sizeMatch = options.some((opt) => sizeTokensMatch(opt, sizeName));
    }

    let colorMatch = !wantsColor;
    if (wantsColor) {
      colorMatch = options.some((opt) => colorMatchesFrame(opt, frameName, frameColorId));
    }
    return sizeMatch && colorMatch;
  };

  const titleMatch = (v: ShopifyVariantMatchEntry): boolean => {
    const title = v.title || "";
    if (!title.trim()) return false;
    const parts = title.split(/\s*\/\s*/).map((p) => p.trim()).filter(Boolean);

    let sizeMatch = !sizeNorm;
    if (sizeNorm) {
      // Prefer last segment as size (Shopify often "Color / Size")
      const last = parts[parts.length - 1] || title;
      sizeMatch =
        sizeTokensMatch(last, sizeName) ||
        parts.some((p) => sizeTokensMatch(p, sizeName));
    }

    let colorMatch = !wantsColor;
    if (wantsColor) {
      colorMatch = colorMatchesFrame(title, frameName, frameColorId);
    }
    return sizeMatch && colorMatch;
  };

  // Prefer structured options (less ambiguous for slash colorways), then title.
  let match = catalog.find(optionMatch);
  if (!match) {
    match = catalog.find(titleMatch);
  }

  // Size-only fallback only when there is no color axis — never for multi-color apparel.
  if (!match && !hasColors && sizeNorm) {
    match = catalog.find((v) => {
      const options = [v.option1, v.option2].filter(Boolean).map((o) => String(o));
      if (options.some((opt) => sizeTokensMatch(opt, sizeName))) return true;
      const title = v.title || "";
      const parts = title.split(/\s*\/\s*/).map((p) => p.trim());
      const last = parts[parts.length - 1] || title;
      return sizeTokensMatch(last, sizeName);
    });
  }

  if (!match && catalog.length === 1) {
    match = catalog[0];
  }

  return match ? String(match.id) : null;
}
