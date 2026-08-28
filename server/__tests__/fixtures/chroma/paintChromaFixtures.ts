/**
 * Synthetic chroma fixtures for WP2 Ticket 1 (Pass C hole-punch).
 * Painters only — no pipeline. Snapshot script / tests run processApparelMotif.
 */
import sharp from "sharp";
import { CHROMA_KEY } from "../../../apparel-matting";

export const FIXTURE_SIZE = 80;

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
      row[o] = 0;
      row[o + 1] = 0;
      row[o + 2] = 0;
      row[o + 3] = 255;
      paint(x, y, row, o);
    }
    rows.push(Buffer.from(row));
  }
  return sharp(Buffer.concat(rows), { raw: { width, height, channels: 4 } }).png().toBuffer();
}

function paintChroma(row: Uint8Array, o: number) {
  row[o] = CHROMA_KEY.r;
  row[o + 1] = CHROMA_KEY.g;
  row[o + 2] = CHROMA_KEY.b;
}

/** Bright silver head (isMatColor) on darker metal body; head TOUCHES the #FF00FF plate. */
export function paintBirdHeadTouchesPlate(
  x: number,
  y: number,
  row: Uint8Array,
  o: number,
) {
  const inBody = (x - 40) ** 2 + (y - 54) ** 2 <= 16 ** 2;
  const inHead = (x - 40) ** 2 + (y - 26) ** 2 <= 12 ** 2;
  if (inHead) {
    row[o] = 245;
    row[o + 1] = 245;
    row[o + 2] = 248;
  } else if (inBody) {
    row[o] = 168;
    row[o + 1] = 170;
    row[o + 2] = 176;
  } else {
    paintChroma(row, o);
  }
}

/** White teeth/eyes fully wrapped in coloured face — must stay opaque. */
export function paintEnclosedTeeth(
  x: number,
  y: number,
  row: Uint8Array,
  o: number,
) {
  const inFace = (x - 40) ** 2 + (y - 40) ** 2 <= 18 ** 2;
  const inTeeth = y >= 46 && y <= 50 && x >= 34 && x <= 46;
  const inEye = (x - 34) ** 2 + (y - 34) ** 2 <= 2 ** 2;
  if (inTeeth || inEye) {
    row[o] = 255;
    row[o + 1] = 255;
    row[o + 2] = 255;
  } else if (inFace) {
    row[o] = 200;
    row[o + 1] = 40;
    row[o + 2] = 30;
  } else {
    paintChroma(row, o);
  }
}

/** White/grey canvas: coloured subject, genuine white background that C must still remove. */
export function paintWhiteCanvasSubject(
  x: number,
  y: number,
  row: Uint8Array,
  o: number,
) {
  const inSubject = (x - 40) ** 2 + (y - 40) ** 2 <= 12 ** 2;
  if (inSubject) {
    row[o] = 200;
    row[o + 1] = 50;
    row[o + 2] = 30;
  } else {
    row[o] = 250;
    row[o + 1] = 250;
    row[o + 2] = 250;
  }
}

/** Flat coloured subject, no white/metal — baseline, should be unchanged. */
export function paintFlatBaseline(
  x: number,
  y: number,
  row: Uint8Array,
  o: number,
) {
  const inSubject = (x - 40) ** 2 + (y - 40) ** 2 <= 14 ** 2;
  if (inSubject) {
    row[o] = 200;
    row[o + 1] = 40;
    row[o + 2] = 40;
  } else {
    paintChroma(row, o);
  }
}

export const CHROMA_FIXTURES = {
  "bird-head-touches-plate": paintBirdHeadTouchesPlate,
  "enclosed-teeth": paintEnclosedTeeth,
  "white-canvas-background": paintWhiteCanvasSubject,
  "flat-baseline": paintFlatBaseline,
} as const;

export async function paintFixture(name: keyof typeof CHROMA_FIXTURES): Promise<Buffer> {
  return rgbaBuffer(FIXTURE_SIZE, FIXTURE_SIZE, CHROMA_FIXTURES[name]);
}
