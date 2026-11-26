/**
 * Per-style background selector + default fill.
 *
 * Global values live on `style_presets` (same row as catalog_slug).
 * `merchantOverride` is reserved so a later per-merchant layer can win
 * without changing call sites — pass null until that layer exists.
 */

import { catalogStyleBackgroundDefaults } from "./catalogArtStyles";
import { DEFAULT_DECOR_BACKGROUND_FILL, parseLiveFillHex, shouldShowDecorFloatingFill } from "./decorBackgroundFill";
import { isFloatingCatalogStyle } from "./styleCatalog";

export type StyleBackgroundConfig = {
  backgroundSelectorEnabled: boolean | null;
  defaultBackgroundColor: string | null;
  backgroundRequired: boolean | null;
};

export type ResolvedStyleBackground = {
  visible: boolean;
  /** Hex to seed, or null for transparent / none. */
  defaultFill: string | null;
  /** Stored raw: "#FFFFFF" | "none" | null (inherit). */
  defaultRaw: string | null;
  required: boolean;
  unusualCombo: boolean;
};

const HEX_RE = /^#[0-9A-F]{6}$/;

export { catalogStyleBackgroundDefaults };

/** Persist admin payload. `undefined` = omit from the SQL update. */
export function persistBackgroundSelectorEnabled(
  raw: unknown,
): boolean | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || raw === "auto") return null;
  return raw === true || raw === "true" || raw === "on";
}

export function persistDefaultBackgroundColor(
  raw: unknown,
): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || raw === "") return null;
  const s = String(raw).trim();
  if (!s || s.toLowerCase() === "none") return "none";
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return `#${s.slice(1).toUpperCase()}`;
  return null;
}

export function persistBackgroundRequired(raw: unknown): boolean | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  return raw === true || raw === "true";
}

export function isPersistedBackgroundHex(raw: string | null | undefined): boolean {
  return HEX_RE.test(String(raw || "").toUpperCase());
}

function coalesceField<T>(
  override: T | null | undefined,
  row: T | null | undefined,
  catalog: T | null,
): T | null {
  if (override !== undefined && override !== null) return override;
  if (row !== undefined && row !== null) return row;
  return catalog;
}

/**
 * Resolve show/hide + default. Explicit style (or future merchant override)
 * wins; null falls through to catalog slug defaults, then today's floating gate.
 */
export function resolveStyleBackgroundConfig(
  style: {
    backgroundSelectorEnabled?: boolean | null;
    defaultBackgroundColor?: string | null;
    backgroundRequired?: boolean | null;
    catalogSlug?: string | null;
    outputMode?: string | null;
    name?: string | null;
  } | null | undefined,
  productOpts: Parameters<typeof shouldShowDecorFloatingFill>[0],
  merchantOverride?: Partial<StyleBackgroundConfig> | null,
): ResolvedStyleBackground {
  const catalog = catalogStyleBackgroundDefaults(style?.catalogSlug);
  const enabled = coalesceField(
    merchantOverride?.backgroundSelectorEnabled,
    style?.backgroundSelectorEnabled,
    catalog.backgroundSelectorEnabled,
  );
  const defaultRaw = coalesceField(
    merchantOverride?.defaultBackgroundColor,
    style?.defaultBackgroundColor,
    catalog.defaultBackgroundColor,
  );
  const required =
    coalesceField(
      merchantOverride?.backgroundRequired,
      style?.backgroundRequired,
      catalog.backgroundRequired,
    ) === true;

  let visible: boolean;
  if (enabled === true) {
    // Free config: no floating-only / GPT / decor-product guard.
    // AOP mesh + phone edge-wrap already have their own Background panels.
    visible =
      productOpts.useAopCustomizer !== true && productOpts.edgeWrapMode !== true;
  } else if (enabled === false) {
    visible = false;
  } else {
    visible = shouldShowDecorFloatingFill(productOpts);
  }

  let defaultFill: string | null = null;
  if (defaultRaw != null) {
    defaultFill = parseLiveFillHex(defaultRaw);
  } else if (visible) {
    defaultFill = DEFAULT_DECOR_BACKGROUND_FILL;
  }

  const floating = isFloatingCatalogStyle({
    outputMode: style?.outputMode,
    catalogSlug: style?.catalogSlug,
  });
  const unusualCombo =
    enabled === true &&
    !floating &&
    String(style?.catalogSlug || "").trim().toLowerCase() !== "minimal-line";

  return {
    visible,
    defaultFill,
    defaultRaw,
    required,
    unusualCombo,
  };
}

export function styleBackgroundApiFields(s: {
  backgroundSelectorEnabled?: boolean | null;
  defaultBackgroundColor?: string | null;
  backgroundRequired?: boolean | null;
  catalogSlug?: string | null;
}): StyleBackgroundConfig {
  const catalog = catalogStyleBackgroundDefaults(s.catalogSlug);
  return {
    backgroundSelectorEnabled:
      s.backgroundSelectorEnabled ?? catalog.backgroundSelectorEnabled,
    defaultBackgroundColor:
      s.defaultBackgroundColor ?? catalog.defaultBackgroundColor,
    backgroundRequired: s.backgroundRequired ?? catalog.backgroundRequired,
  };
}
