/**
 * My Pet quality helpers that stay free of sharp and network calls.
 * The pet mask is a box on the original artwork. Pixels outside it stay
 * the original design, including the lettering. The operator nudge shifts
 * that box in the same 0–1 space.
 */

export type PetMask = {
  x: number;
  y: number;
  w: number;
  h: number;
  nudgeX: number;
  nudgeY: number;
  nudgeW: number;
  nudgeH: number;
  letteringOverlapsPet: boolean;
};

export type NormRect = { x: number; y: number; w: number; h: number };

const MIN_SPAN = 0.02;

function unit(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return n;
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

export function emptyPetMask(): PetMask {
  return { x: 0, y: 0, w: 1, h: 1, nudgeX: 0, nudgeY: 0, nudgeW: 0, nudgeH: 0, letteringOverlapsPet: false };
}

/** Accept a vision or stored payload. Invalid boxes become null. */
export function parsePetMask(raw: unknown): PetMask | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const x = unit(r.x, NaN);
  const y = unit(r.y, NaN);
  const w = unit(r.w, NaN);
  const h = unit(r.h, NaN);
  if (![x, y, w, h].every((n) => Number.isFinite(n))) return null;
  return {
    x: clamp01(x),
    y: clamp01(y),
    w: Math.min(1, Math.max(MIN_SPAN, w)),
    h: Math.min(1, Math.max(MIN_SPAN, h)),
    nudgeX: clampSpan(unit(r.nudgeX, 0)),
    nudgeY: clampSpan(unit(r.nudgeY, 0)),
    nudgeW: clampSpan(unit(r.nudgeW, 0)),
    nudgeH: clampSpan(unit(r.nudgeH, 0)),
    letteringOverlapsPet: r.letteringOverlapsPet === true,
  };
}

function clampSpan(n: number): number {
  return Math.min(1, Math.max(-1, n));
}

/** Box after the operator nudge, still inside the artwork. */
export function resolvedPetMask(mask: PetMask): NormRect {
  let x = clamp01(mask.x + mask.nudgeX);
  let y = clamp01(mask.y + mask.nudgeY);
  let w = Math.min(1 - x, Math.max(MIN_SPAN, mask.w + mask.nudgeW));
  let h = Math.min(1 - y, Math.max(MIN_SPAN, mask.h + mask.nudgeH));
  if (x + w > 1) w = Math.max(MIN_SPAN, 1 - x);
  if (y + h > 1) h = Math.max(MIN_SPAN, 1 - y);
  return { x, y, w, h };
}

export function withPetMaskNudge(mask: PetMask, nudge: Partial<Pick<PetMask, "nudgeX" | "nudgeY" | "nudgeW" | "nudgeH">>): PetMask {
  return parsePetMask({ ...mask, ...nudge }) || mask;
}

/**
 * Copy the edited pet back onto the original. Both buffers are RGBA of the
 * same width and height. Pixels outside the box are the original bytes.
 */
export function compositePetRegion(
  original: Uint8Array,
  edited: Uint8Array,
  width: number,
  height: number,
  rect: NormRect,
): Uint8Array {
  if (original.length !== width * height * 4 || edited.length !== original.length) {
    throw new Error("Pet mask composite expects matching RGBA buffers.");
  }
  const out = new Uint8Array(original);
  const x0 = Math.max(0, Math.floor(rect.x * width));
  const y0 = Math.max(0, Math.floor(rect.y * height));
  const x1 = Math.min(width, Math.ceil((rect.x + rect.w) * width));
  const y1 = Math.min(height, Math.ceil((rect.y + rect.h) * height));
  for (let y = y0; y < y1; y++) {
    const row = y * width * 4;
    const start = row + x0 * 4;
    const end = row + x1 * 4;
    out.set(edited.subarray(start, end), start);
  }
  return out;
}

/** Largest one-pixel step on opaque pixels. A soft or downscaled edge scores lower. */
export function edgeEnergy(rgba: Uint8Array, width: number, height: number): number {
  let peak = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width - 1; x++) {
      const i = (y * width + x) * 4;
      if (rgba[i + 3] < 16 || rgba[i + 7] < 16) continue;
      const left = rgba[i] + rgba[i + 1] + rgba[i + 2];
      const right = rgba[i + 4] + rgba[i + 5] + rgba[i + 6];
      const step = Math.abs(left - right);
      if (step > peak) peak = step;
    }
  }
  return peak;
}

/** A shopper generate records one render. The quality retry stays inside that one row. */
export function myPetQualityRetryAllowed(qaFailed: boolean, alreadyRetried: boolean): boolean {
  return qaFailed && !alreadyRetried;
}

/** Shown when both the first edit and the one retry miss the pose. The image is not saved. */
export const MY_PET_POSE_REJECTED_MESSAGE = "We couldn't match this design's pose, so this one wasn't saved. Please try again.";

export class MyPetPoseRejectedError extends Error {
  constructor() {
    super(MY_PET_POSE_REJECTED_MESSAGE);
    this.name = "MyPetPoseRejectedError";
  }
}

/** Reads the totals the pose note assigns. Null when that sentence is missing. */
export function poseNotePawCounts(note: string): { front: number | null; hind: number | null } {
  const read = (label: string) => {
    const match = new RegExp(`visible ${label} paws:\\s*(\\d+)`, "i").exec(note || "");
    if (!match) return null;
    const n = Number(match[1]);
    return Number.isInteger(n) && n >= 0 && n <= 12 ? n : null;
  };
  return { front: read("front"), hind: read("hind") };
}

/**
 * The note's counts win. A matching count still fails when a paw is raised,
 * planted, folded, hidden, or holding the wrong thing.
 */
export function myPetPawCheckPass(args: {
  note: string;
  visibleFrontPaws: number | null;
  visibleHindPaws: number | null;
  frontMatch: boolean;
  hindMatch: boolean;
}): { pass: boolean; reason: string } {
  const expected = poseNotePawCounts(args.note);
  if (expected.front == null || expected.hind == null) {
    return { pass: false, reason: "The pose note does not give visible front and hind paw counts." };
  }
  if (args.visibleFrontPaws == null || args.visibleHindPaws == null) {
    return { pass: false, reason: "The vision check did not return paw counts." };
  }
  const reason = `Visible front paws ${args.visibleFrontPaws} (note ${expected.front}). Visible hind paws ${args.visibleHindPaws} (note ${expected.hind}).`;
  const countsOk = args.visibleFrontPaws === expected.front && args.visibleHindPaws === expected.hind;
  if (!countsOk || !args.frontMatch || !args.hindMatch) {
    const position = countsOk ? " A paw's position or what it holds does not match the note." : "";
    return { pass: false, reason: `${reason}${position}` };
  }
  return { pass: true, reason };
}

export function clipMyPetNote(value: unknown, max = 500): string {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}
