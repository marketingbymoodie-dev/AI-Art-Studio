/** Hidden Shopify line properties — Printify bakes these, checkout does not show them. */
export const LINE_FLAT_PLACEMENT_KEY = "_flat_pl";
export const LINE_TOTE_PLACEMENT_KEY = "_tote_pl";
/** Hosted JSON path/URL of AOP print panels frozen at add-to-cart. */
export const LINE_AOP_PANELS_KEY = "_aop_pl";

export type LineViewPlacement = {
  scale: number;
  offsetX: number;
  offsetY: number;
  rotationDeg: number;
};

export type DecodedFlatLinePlacement = {
  placements: { front: LineViewPlacement; back: LineViewPlacement };
  enabled: { front: boolean; back: boolean };
  backgroundColor: string | null;
};

export type DecodedToteLinePlacement = {
  scale: number;
  offsetX: number;
  offsetY: number;
};

type CompactView = { s: number; x: number; y: number; r?: number; e?: 0 | 1 };
type CompactFlat = { f?: CompactView; b?: CompactView; bg?: string | null };
type CompactTote = { s: number; x: number; y: number };

function round4(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 10000) / 10000;
}

function viewFromUnknown(raw: unknown, fallback: LineViewPlacement): LineViewPlacement {
  const p = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    scale: Number.isFinite(Number(p.scale)) ? Number(p.scale) : fallback.scale,
    offsetX: Number.isFinite(Number(p.offsetX)) ? Number(p.offsetX) : fallback.offsetX,
    offsetY: Number.isFinite(Number(p.offsetY)) ? Number(p.offsetY) : fallback.offsetY,
    rotationDeg: Number.isFinite(Number(p.rotationDeg)) ? Number(p.rotationDeg) : fallback.rotationDeg,
  };
}

function compactView(p: LineViewPlacement, enabled: boolean): CompactView {
  const out: CompactView = {
    s: round4(p.scale),
    x: round4(p.offsetX),
    y: round4(p.offsetY),
  };
  if (p.rotationDeg) out.r = round4(p.rotationDeg);
  out.e = enabled ? 1 : 0;
  return out;
}

function expandView(raw: CompactView | undefined, enabledDefault: boolean): {
  placement: LineViewPlacement;
  enabled: boolean;
} {
  return {
    placement: {
      scale: Number.isFinite(raw?.s) ? Number(raw?.s) : 1,
      offsetX: Number.isFinite(raw?.x) ? Number(raw?.x) : 0,
      offsetY: Number.isFinite(raw?.y) ? Number(raw?.y) : 0,
      rotationDeg: Number.isFinite(raw?.r) ? Number(raw?.r) : 0,
    },
    enabled: raw?.e == null ? enabledDefault : raw.e === 1,
  };
}

export function encodeFlatLinePlacement(state: {
  placements?: { front?: unknown; back?: unknown } | null;
  enabled?: { front?: boolean; back?: boolean } | null;
  backgroundColor?: string | null;
} | null | undefined): string | null {
  if (!state?.placements) return null;
  const front = viewFromUnknown(state.placements.front, {
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    rotationDeg: 0,
  });
  const back = viewFromUnknown(state.placements.back, {
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    rotationDeg: 0,
  });
  const payload: CompactFlat = {
    f: compactView(front, state.enabled?.front !== false),
    b: compactView(back, !!state.enabled?.back),
  };
  if (typeof state.backgroundColor === "string" && /^#[0-9a-fA-F]{6}$/i.test(state.backgroundColor)) {
    payload.bg = state.backgroundColor;
  }
  const json = JSON.stringify(payload);
  return json.length < 255 ? json : null;
}

export function decodeFlatLinePlacement(raw?: string | null): DecodedFlatLinePlacement | null {
  const s = String(raw || "").trim();
  if (!s.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(s) as CompactFlat;
    if (!parsed || typeof parsed !== "object") return null;
    const front = expandView(parsed.f, true);
    const back = expandView(parsed.b, false);
    const bg =
      typeof parsed.bg === "string" && /^#[0-9a-fA-F]{6}$/i.test(parsed.bg) ? parsed.bg : null;
    return {
      placements: { front: front.placement, back: back.placement },
      enabled: { front: front.enabled, back: back.enabled },
      backgroundColor: bg,
    };
  } catch {
    return null;
  }
}

/** Tote uses editor % (scale 100, x/y 50) or already-normalized offsets. */
export function encodeToteLinePlacement(args: {
  scale?: number | null;
  x?: number | null;
  y?: number | null;
  offsetX?: number | null;
  offsetY?: number | null;
}): string | null {
  const scaleRaw = Number(args.scale);
  const hasOffsets =
    Number.isFinite(Number(args.offsetX)) || Number.isFinite(Number(args.offsetY));
  let scale = 1;
  let offsetX = 0;
  let offsetY = 0;
  if (hasOffsets) {
    scale = Number.isFinite(scaleRaw) ? scaleRaw : 1;
    offsetX = Number(args.offsetX) || 0;
    offsetY = Number(args.offsetY) || 0;
  } else {
    const pct = Number.isFinite(scaleRaw) ? scaleRaw : 100;
    scale = Math.max(0.05, Math.min(4, pct > 4 ? pct / 100 : pct));
    offsetX = ((Number(args.x) || 50) - 50) / 50;
    offsetY = ((Number(args.y) || 50) - 50) / 50;
  }
  const json = JSON.stringify({
    s: round4(scale),
    x: round4(offsetX),
    y: round4(offsetY),
  } satisfies CompactTote);
  return json.length < 255 ? json : null;
}

export function decodeToteLinePlacement(raw?: string | null): DecodedToteLinePlacement | null {
  const s = String(raw || "").trim();
  if (!s.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(s) as CompactTote;
    if (!parsed || typeof parsed !== "object") return null;
    if (!Number.isFinite(parsed.s)) return null;
    return {
      scale: Number(parsed.s),
      offsetX: Number(parsed.x) || 0,
      offsetY: Number(parsed.y) || 0,
    };
  } catch {
    return null;
  }
}
