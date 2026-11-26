/** How far an uploaded blank's shirt sits from the white master's mask. */

const SEARCH = 16;
const WARN_PX = 3;

export type AlignmentReport = {
  overlap: number;
  edgeOffsetPx: number;
  shiftX: number;
  shiftY: number;
  warning: string | null;
};

function lumAt(rgba: Uint8Array, i: number): number {
  const o = i * 4;
  return 0.2126 * rgba[o] + 0.7152 * rgba[o + 1] + 0.0722 * rgba[o + 2];
}

function maskIou(mask: Uint8Array, w: number, h: number, sx: number, sy: number): number {
  let inter = 0;
  let union = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = mask[y * w + x] ? 1 : 0;
      const x2 = x - sx;
      const y2 = y - sy;
      const b = x2 >= 0 && y2 >= 0 && x2 < w && y2 < h && mask[y2 * w + x2] ? 1 : 0;
      if (a || b) union++;
      if (a && b) inter++;
    }
  }
  return union ? inter / union : 1;
}

function contourOffset(upload: Uint8Array, mask: Uint8Array, w: number, h: number): number {
  const offsets: number[] = [];
  const step = Math.max(1, Math.floor(Math.sqrt((w * h) / 800)));
  for (let y = 1; y < h - 1; y += step) {
    for (let x = 1; x < w - 1; x += step) {
      const i = y * w + x;
      if (!mask[i]) continue;
      let nx = 0;
      let ny = 0;
      if (!mask[i - 1]) nx -= 1;
      if (!mask[i + 1]) nx += 1;
      if (!mask[i - w]) ny -= 1;
      if (!mask[i + w]) ny += 1;
      if (nx === 0 && ny === 0) continue;
      const len = Math.hypot(nx, ny) || 1;
      nx /= len;
      ny /= len;
      let bestT = 0;
      let bestG = -1;
      let prev: number | null = null;
      const reach = 8;
      for (let t = -reach; t <= reach; t++) {
        const x2 = Math.round(x + nx * t);
        const y2 = Math.round(y + ny * t);
        if (x2 < 0 || y2 < 0 || x2 >= w || y2 >= h) continue;
        const L = lumAt(upload, y2 * w + x2);
        if (prev != null) {
          const g = Math.abs(L - prev);
          if (g > bestG) {
            bestG = g;
            bestT = t;
          }
        }
        prev = L;
      }
      offsets.push(bestT);
    }
  }
  if (!offsets.length) return 0;
  offsets.sort((a, b) => Math.abs(a) - Math.abs(b));
  return Math.abs(offsets[Math.floor(offsets.length / 2)]);
}

export function measureGarmentAlignment(
  master: Uint8Array,
  upload: Uint8Array,
  mask: Uint8Array,
  w: number,
  h: number,
): AlignmentReport {
  const samples: number[] = [];
  const stride = Math.max(1, Math.floor(Math.sqrt((w * h) / 2500)));
  for (let y = 0; y < h; y += stride) {
    for (let x = 0; x < w; x += stride) {
      if (mask[y * w + x]) samples.push(y * w + x);
    }
  }
  let shiftX = 0;
  let shiftY = 0;
  if (samples.length >= 4) {
    let bestSad = Infinity;
    for (let dy = -SEARCH; dy <= SEARCH; dy++) {
      for (let dx = -SEARCH; dx <= SEARCH; dx++) {
        let sad = 0;
        let n = 0;
        for (const i of samples) {
          const x = i % w;
          const y = (i - x) / w;
          const x2 = x + dx;
          const y2 = y + dy;
          if (x2 < 0 || y2 < 0 || x2 >= w || y2 >= h) continue;
          sad += Math.abs(lumAt(master, i) - lumAt(upload, y2 * w + x2));
          n++;
        }
        if (n < samples.length * 0.5) continue;
        const mean = sad / n;
        if (mean < bestSad) {
          bestSad = mean;
          shiftX = dx;
          shiftY = dy;
        }
      }
    }
  }
  const edgeOffsetPx = Math.round(Math.max(Math.hypot(shiftX, shiftY), contourOffset(upload, mask, w, h)) * 10) / 10;
  const overlap = Math.round(maskIou(mask, w, h, shiftX, shiftY) * 1000) / 1000;
  const warning = edgeOffsetPx > WARN_PX
    ? `The shirt or the props have moved about ${edgeOffsetPx} px from the white master. A design on this blank would sit in the wrong place.`
    : null;
  return { overlap, edgeOffsetPx, shiftX, shiftY, warning };
}
