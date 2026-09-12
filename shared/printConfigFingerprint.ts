/**
 * Stable hash of print-file-affecting config, used as the third segment of
 * `job::catalogVariantId::cfgHash` so Add-to-Cart snapshots become distinct
 * cart lines / shadow SKUs. Edits are not hashed until ATC.
 *
 * artFit (beanie contain vs cover) is NOT included — it is fixed per
 * Printify blueprint via `flatArtFitForBlueprint`, not a customer control.
 */
import {
  encodeFlatLinePlacement,
  encodeToteLinePlacement,
} from "./linePlacementSnapshot";
import { reusableShadowDesignId } from "./shadowDesignId";

const AOP_PRINT_KEYS = [
  "placements",
  "enabled",
  "pocketsEnabled",
  "trimEnabled",
  "sleevesMirrored",
  "legsSynced",
  "legsMirrored",
  "backgroundColor",
  "tileSettings",
  "wrapBackMode",
  "pocketSample",
  "mode",
  "panelRenderConfig",
  "perPanelTransforms",
  "mirrorMode",
  "seamBleedPx",
  "hoodieSeamBleedPx",
  "syncSidesMode",
  "patternOffsetX",
  "hoodiePatternSpecs",
  "applyAllover",
  "hoodiePocketPatternHeightInches",
  "patternType",
  "tileInches",
  "bgColor",
] as const;

export type PrintConfigFingerprintInput = {
  artworkUrl?: string | null;
  flat?: {
    placements?: { front?: unknown; back?: unknown } | null;
    enabled?: { front?: boolean; back?: boolean } | null;
    backgroundColor?: string | null;
  } | null;
  tote?: {
    scale?: number | null;
    x?: number | null;
    y?: number | null;
    offsetX?: number | null;
    offsetY?: number | null;
    printBack?: boolean;
  } | null;
  /** HoodieAopPlacer live state — placements are per group AND per view (front vs back). */
  aopHoodie?: Record<string, unknown> | null;
  /** PatternCustomizer aopPlacementSettings. */
  aopPattern?: Record<string, unknown> | null;
};

export function normalizeArtworkIdentity(url?: string | null): string {
  const s = String(url || "").trim();
  if (!s || s.startsWith("data:")) return "";
  try {
    const u = new URL(s);
    return `${u.origin}${u.pathname}`;
  } catch {
    return s.split("?")[0];
  }
}

function pickAopSlice(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object") return null;
  const src = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of AOP_PRINT_KEYS) {
    if (src[k] !== undefined) out[k] = src[k];
  }
  return Object.keys(out).length ? out : null;
}

function stableStringify(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "0";
    return String(Math.round(value * 10000) / 10000);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (typeof value === "object") {
    const keys = Object.keys(value as object).sort();
    return `{${keys
      .map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return "null";
}

function fnvImulHash(s: string): string {
  let h1 = 2166136261;
  let h2 = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 16777619);
    h2 = (Math.imul(31, h2) + c) | 0;
  }
  return `${(h1 >>> 0).toString(36)}${Math.abs(h2).toString(36)}`;
}

/**
 * Short stable fingerprint of print-file-affecting config.
 * Empty / missing config still returns a hash (of the empty canonical object)
 * so ATC always has a cfg suffix when this helper is used.
 */
export function printConfigFingerprint(input: PrintConfigFingerprintInput): string {
  const hoodie = pickAopSlice(input.aopHoodie);
  const pattern = pickAopSlice(input.aopPattern);
  const aop =
    hoodie || pattern
      ? {
          ...(hoodie ? { hoodie } : {}),
          ...(pattern ? { pattern } : {}),
        }
      : null;
  const canonical = {
    art: normalizeArtworkIdentity(input.artworkUrl),
    flat: encodeFlatLinePlacement(input.flat) || null,
    tote: input.tote ? encodeToteLinePlacement(input.tote) : null,
    aop,
  };
  return fnvImulHash(stableStringify(canonical));
}

/** ATC persist key: job + catalog variant + print-config snapshot hash. */
export function atcShadowDesignId(
  jobId: string,
  variantId: string | number | null | undefined,
  input: PrintConfigFingerprintInput,
): string {
  return reusableShadowDesignId(jobId, variantId, printConfigFingerprint(input));
}
