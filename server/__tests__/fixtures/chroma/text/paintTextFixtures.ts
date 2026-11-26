/**
 * Synthetic text / curve fixtures for WP2 Ticket 2 (vectorize counters + strokes).
 */
import sharp from "sharp";

const CHROMA_KEY = { r: 255, g: 0, b: 255 } as const;

export const TEXT_W = 220;
export const TEXT_H = 80;

export async function rgbaBuffer(
  width: number,
  height: number,
  paint: (x: number, y: number, row: Uint8Array, offset: number) => void,
): Promise<Buffer> {
  const row = new Uint8Array(width * 4);
  const rows: Buffer[] = [];
  for (let y = 0; y < height; y++) {
    row.fill(0);
    for (let x = 0; x < width; x++) {
      const o = x * 4;
      row[o] = CHROMA_KEY.r;
      row[o + 1] = CHROMA_KEY.g;
      row[o + 2] = CHROMA_KEY.b;
      row[o + 3] = 255;
      paint(x, y, row, o);
    }
    rows.push(Buffer.from(row));
  }
  return sharp(Buffer.concat(rows), { raw: { width, height, channels: 4 } }).png().toBuffer();
}

function ink(row: Uint8Array, o: number, r = 20, g = 20, b = 20) {
  row[o] = r;
  row[o + 1] = g;
  row[o + 2] = b;
}

function inCircle(x: number, y: number, cx: number, cy: number, r: number) {
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

/** Bold O / e / a / g / R / B as geometric counters on a #FF00FF plate. */
export function paintBoldLetters(
  x: number,
  y: number,
  row: Uint8Array,
  o: number,
) {
  // O at x~22
  const oOuter = inCircle(x, y, 22, 40, 16);
  const oHole = inCircle(x, y, 22, 40, 8);
  // e at x~58 — bowl + counter + open right
  const eOuter = inCircle(x, y, 58, 40, 14);
  const eHole = inCircle(x, y, 58, 38, 6) && y < 40;
  const eBar = x >= 46 && x <= 70 && y >= 39 && y <= 42;
  const eCut = x >= 64 && y >= 40 && y <= 52 && inCircle(x, y, 58, 40, 14);
  // a at x~94
  const aOuter = inCircle(x, y, 94, 44, 12);
  const aHole = inCircle(x, y, 94, 44, 5);
  const aStem = x >= 102 && x <= 106 && y >= 32 && y <= 56;
  // g at x~128
  const gOuter = inCircle(x, y, 128, 40, 12);
  const gHole = inCircle(x, y, 128, 40, 5);
  const gTail = x >= 132 && x <= 140 && y >= 40 && y <= 58;
  // R at x~162
  const rBowl = inCircle(x, y, 158, 32, 10) && x >= 148;
  const rHole = inCircle(x, y, 158, 32, 4);
  const rStem = x >= 148 && x <= 152 && y >= 22 && y <= 58;
  const rLeg = x >= 156 && x <= 170 && Math.abs((y - 42) - 0.9 * (x - 156)) <= 2 && y >= 40;
  // B at x~196
  const bStem = x >= 184 && x <= 188 && y >= 22 && y <= 58;
  const bTop = inCircle(x, y, 196, 30, 9) && x >= 186;
  const bTopHole = inCircle(x, y, 196, 30, 4);
  const bBot = inCircle(x, y, 196, 50, 10) && x >= 186;
  const bBotHole = inCircle(x, y, 196, 50, 4);

  const solid =
    (oOuter && !oHole) ||
    (eOuter && !eHole && !eCut) ||
    eBar ||
    (aOuter && !aHole) ||
    aStem ||
    (gOuter && !gHole) ||
    gTail ||
    (rBowl && !rHole) ||
    rStem ||
    rLeg ||
    bStem ||
    (bTop && !bTopHole) ||
    (bBot && !bBotHole);

  if (solid) ink(row, o);
}

/** 3px-wide stems (should survive with speckle 0 and no pre-trace erode). */
export function paintThinStems(
  x: number,
  y: number,
  row: Uint8Array,
  o: number,
) {
  const bars = [
    { x0: 30, x1: 33, y0: 20, y1: 60 },
    { x0: 50, x1: 53, y0: 20, y1: 60 },
    { x0: 70, x1: 73, y0: 20, y1: 60 },
    { x0: 90, x1: 120, y0: 38, y1: 41 },
  ];
  if (bars.some((b) => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1)) {
    ink(row, o);
  }
}

/** "Baggage"-like: two B bowls + two a/g holes + e hole. */
export function paintBaggageWord(
  x: number,
  y: number,
  row: Uint8Array,
  o: number,
) {
  paintBoldLetters(x, y, row, o);
}

/** Enclosed non-plate magenta flower (#E614E1) inside a dark ring — must stay opaque. */
export function paintFlowerHue(
  x: number,
  y: number,
  row: Uint8Array,
  o: number,
) {
  const ring = inCircle(x, y, 110, 40, 28) && !inCircle(x, y, 110, 40, 12);
  const petal = inCircle(x, y, 110, 40, 12);
  if (ring) ink(row, o, 30, 30, 40);
  else if (petal) ink(row, o, 230, 20, 225);
}

/** Flat-art blob, no counters. */
export function paintFlatArt(
  x: number,
  y: number,
  row: Uint8Array,
  o: number,
) {
  if (inCircle(x, y, 110, 40, 22)) ink(row, o, 200, 40, 40);
}

/** Smooth curved silhouette (penguin-like: body + head ellipses). */
export function paintSmoothCurve(
  x: number,
  y: number,
  row: Uint8Array,
  o: number,
) {
  const body = ((x - 110) / 28) ** 2 + ((y - 44) / 22) ** 2 <= 1;
  const head = ((x - 110) / 14) ** 2 + ((y - 20) / 12) ** 2 <= 1;
  if (body || head) ink(row, o, 25, 25, 30);
}

/** Filled sticker with a 4px dark border stroke. */
export function paintBorderedSticker(
  x: number,
  y: number,
  row: Uint8Array,
  o: number,
) {
  const outer = inCircle(x, y, 110, 40, 24);
  const inner = inCircle(x, y, 110, 40, 20);
  if (outer && !inner) ink(row, o, 15, 15, 15);
  else if (inner) ink(row, o, 240, 210, 40);
}

export const TEXT_FIXTURES = {
  "bold-letters-OeagRB": paintBoldLetters,
  "thin-stems": paintThinStems,
  baggage: paintBaggageWord,
  "flower-enclosed-hue": paintFlowerHue,
  "flat-art": paintFlatArt,
  "smooth-curve": paintSmoothCurve,
  "bordered-sticker": paintBorderedSticker,
} as const;

export async function paintTextFixture(name: keyof typeof TEXT_FIXTURES): Promise<Buffer> {
  return rgbaBuffer(TEXT_W, TEXT_H, TEXT_FIXTURES[name]);
}
