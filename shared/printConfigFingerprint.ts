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

/** Wire-size ceiling for a client-supplied print-config snapshot. */
export const PRINT_CONFIG_INPUT_MAX_JSON_BYTES = 32 * 1024;

// Exactly the keys encodeFlatLinePlacement / encodeToteLinePlacement read.
const FLAT_VIEW_KEYS = ["scale", "offsetX", "offsetY", "rotationDeg"] as const;
const TOTE_NUMERIC_KEYS = ["scale", "x", "y", "offsetX", "offsetY"] as const;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** Mirrors the encoders' `Number.isFinite(Number(v))` coercion so hashes stay identical. */
function finiteNumber(v: unknown): number | undefined {
  if (v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function pickFlatView(raw: unknown): Record<string, unknown> | undefined {
  if (!isPlainObject(raw)) return undefined;
  const out: Record<string, unknown> = {};
  for (const k of FLAT_VIEW_KEYS) {
    const n = finiteNumber(raw[k]);
    if (n !== undefined) out[k] = n;
  }
  return out;
}

/**
 * Allow-list a client-supplied fingerprint input down to exactly what
 * `printConfigFingerprint` reads, so a pre-mint at Apply hashes identically
 * to the ATC call and unknown keys cannot ride along. Returns null when the
 * payload is not an object or exceeds the wire ceiling.
 */
export function sanitizePrintConfigInput(raw: unknown): PrintConfigFingerprintInput | null {
  if (!isPlainObject(raw)) return null;
  try {
    if (JSON.stringify(raw).length > PRINT_CONFIG_INPUT_MAX_JSON_BYTES) return null;
  } catch {
    return null;
  }
  const out: PrintConfigFingerprintInput = {};

  if (typeof raw.artworkUrl === "string") out.artworkUrl = raw.artworkUrl;

  if (isPlainObject(raw.flat)) {
    const flat: NonNullable<PrintConfigFingerprintInput["flat"]> = {};
    if (isPlainObject(raw.flat.placements)) {
      const front = pickFlatView(raw.flat.placements.front);
      const back = pickFlatView(raw.flat.placements.back);
      flat.placements = {
        ...(front ? { front } : {}),
        ...(back ? { back } : {}),
      };
    }
    if (isPlainObject(raw.flat.enabled)) {
      // Encoder semantics: front defaults on (`!== false`), back defaults off (`!!`).
      const en = raw.flat.enabled;
      flat.enabled = {
        ...(en.front !== undefined ? { front: en.front !== false } : {}),
        ...(en.back !== undefined ? { back: !!en.back } : {}),
      };
    }
    if (typeof raw.flat.backgroundColor === "string") {
      flat.backgroundColor = raw.flat.backgroundColor;
    }
    out.flat = flat;
  } else if (raw.flat === null) {
    out.flat = null;
  }

  if (isPlainObject(raw.tote)) {
    const tote: NonNullable<PrintConfigFingerprintInput["tote"]> = {};
    for (const k of TOTE_NUMERIC_KEYS) {
      const n = finiteNumber(raw.tote[k]);
      if (n !== undefined) tote[k] = n;
    }
    if (typeof raw.tote.printBack === "boolean") tote.printBack = raw.tote.printBack;
    out.tote = tote;
  } else if (raw.tote === null) {
    out.tote = null;
  }

  out.aopHoodie = pickAopSlice(raw.aopHoodie);
  out.aopPattern = pickAopSlice(raw.aopPattern);

  return out;
}
