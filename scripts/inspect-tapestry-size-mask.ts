/**
 * QA a harvested 241 droop mask (corners + retuned edge-only feather).
 *
 *   npx tsx scripts/inspect-tapestry-size-mask.ts --size=26x36
 *   npx tsx scripts/inspect-tapestry-size-mask.ts --url=https://.../26x36-mask.png --size=26x36
 */
import "../server/load-env";
import sharp from "sharp";
import { extractDimensionalKey } from "../shared/productVariantOptions";
import {
  CATALOG_SIZE_BLANK_BLUEPRINTS,
  CATALOG_SIZE_BLANK_STORAGE_PATHS,
} from "../shared/catalogSizeBlanks";
import { maskAlphaLooksBinary, TAPESTRY_MASK_FEATHER_RADIUS_PX } from "../shared/maskFeather";

const BLUEPRINT_ID = CATALOG_SIZE_BLANK_BLUEPRINTS.indoorWallTapestry;
const SIZE_KEYS = Object.keys(CATALOG_SIZE_BLANK_STORAGE_PATHS[BLUEPRINT_ID]);
const CORE = 128;

function argValue(name: string): string | undefined {
  const flag = `--${name}`;
  const idx = process.argv.indexOf(flag);
  if (idx >= 0) return process.argv[idx + 1];
  const inline = process.argv.find((a) => a.startsWith(`${flag}=`));
  return inline ? inline.slice(flag.length + 1) : undefined;
}

type Quad = { name: string; cover: number; area: number; frac: number };

function analyzeMask(data: Buffer, width: number, height: number) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let core = 0;
  let mid = 0;
  let opaque = 0;
  const alpha = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const a = data[i * 4 + 3];
    alpha[i] = a;
    if (a <= 10) continue;
    opaque += 1;
    if (a < 200) mid += 1;
    if (a < CORE) continue;
    core += 1;
    const x = i % width;
    const y = (i - x) / width;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  if (maxX < 0) {
    throw new Error("mask has no core (alpha >= 128) pixels");
  }
  const aabbW = maxX - minX + 1;
  const aabbH = maxY - minY + 1;
  const win = Math.max(10, Math.round(0.04 * Math.min(aabbW, aabbH)));

  const cornerHits = (cx: number, cy: number) => {
    let n = 0;
    for (let y = Math.max(0, cy); y < Math.min(height, cy + win); y++) {
      for (let x = Math.max(0, cx); x < Math.min(width, cx + win); x++) {
        if (alpha[y * width + x] >= CORE) n += 1;
      }
    }
    return n;
  };

  const corners = {
    tl: cornerHits(minX, minY),
    tr: cornerHits(maxX - win + 1, minY),
    bl: cornerHits(minX, maxY - win + 1),
    br: cornerHits(maxX - win + 1, maxY - win + 1),
  };

  const midX = minX + Math.floor(aabbW / 2);
  const midY = minY + Math.floor(aabbH / 2);
  const quads: Quad[] = [
    { name: "tl", cover: 0, area: 0, frac: 0 },
    { name: "tr", cover: 0, area: 0, frac: 0 },
    { name: "bl", cover: 0, area: 0, frac: 0 },
    { name: "br", cover: 0, area: 0, frac: 0 },
  ];
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const qi = (y < midY ? 0 : 2) + (x < midX ? 0 : 1);
      quads[qi].area += 1;
      if (alpha[y * width + x] >= CORE) quads[qi].cover += 1;
    }
  }
  for (const q of quads) q.frac = q.area ? q.cover / q.area : 0;

  const rgba = new Uint8ClampedArray(data);
  return {
    width,
    height,
    aabb: { x: minX, y: minY, w: aabbW, h: aabbH },
    aabbAspect: aabbW / aabbH,
    core,
    mid,
    opaque,
    midFracOfOpaque: opaque ? mid / opaque : 0,
    coreFracOfAabb: (aabbW * aabbH) ? core / (aabbW * aabbH) : 0,
    corners,
    cornerWindow: win,
    quads,
    looksBinary: maskAlphaLooksBinary(rgba, width, height),
    sampleCore: data[(Math.floor((minY + maxY) / 2) * width + Math.floor((minX + maxX) / 2)) * 4 + 3],
    edge160: countEdge160(data, width * height),
  };
}

function countEdge160(data: Buffer, n: number): number {
  let c = 0;
  for (let i = 0; i < n; i++) {
    const a = data[i * 4 + 3];
    if (a >= 140 && a <= 180) c += 1;
  }
  return c;
}

function fail(msg: string): never {
  console.error(`[tapestry-mask-qa] FAIL ${msg}`);
  process.exit(1);
}

async function main() {
  const rawSize = argValue("size") || "";
  const sizeKey = rawSize ? extractDimensionalKey(rawSize) || rawSize : "";
  if (sizeKey && !SIZE_KEYS.includes(sizeKey)) {
    throw new Error(`Unknown tapestry size ${rawSize}. Expected one of: ${SIZE_KEYS.join(", ")}`);
  }

  let url = argValue("url") || "";
  if (!url) {
    if (!sizeKey) throw new Error("pass --size= or --url=");
    const {
      loadCanonicalManifest,
      loadCanonicalPublishedMeta,
      DEFAULT_CANONICAL_VERSION,
    } = await import("../server/canonicalFlatCalibration");
    const published = await loadCanonicalPublishedMeta(BLUEPRINT_ID);
    const version = published?.version || DEFAULT_CANONICAL_VERSION;
    const manifest = await loadCanonicalManifest(BLUEPRINT_ID, version);
    const geo = manifest?.geometryByBlank?.[sizeKey];
    url = geo?.front?.maskUrl || geo?.back?.maskUrl || "";
    if (!url) {
      fail(`no geometryByBlank[${sizeKey}] mask in canonical v${version}`);
    }
    const keys = Object.keys(manifest?.geometryByBlank || {});
    console.log(`[tapestry-mask-qa] canonical keys: ${keys.join(", ") || "(none)"}`);
  }

  const res = await fetch(url);
  if (!res.ok) fail(`download ${res.status} ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const s = analyzeMask(data, info.width, info.height);

  console.log(`[tapestry-mask-qa] size=${sizeKey || "?"} url=${url}`);
  console.log(
    `[tapestry-mask-qa] ${s.width}×${s.height} aabb=${s.aabb.w}×${s.aabb.h} @${s.aabb.x},${s.aabb.y} aspect=${s.aabbAspect.toFixed(3)}`,
  );
  console.log(
    `[tapestry-mask-qa] core=${s.core} mid=${s.mid} edge160=${s.edge160} opaque=${s.opaque} midFrac=${s.midFracOfOpaque.toFixed(4)} core/aabb=${s.coreFracOfAabb.toFixed(3)} looksBinaryHeuristic=${s.looksBinary} centerA=${s.sampleCore} featherR=${TAPESTRY_MASK_FEATHER_RADIUS_PX}`,
  );
  console.log(
    `[tapestry-mask-qa] corners(win=${s.cornerWindow}) tl=${s.corners.tl} tr=${s.corners.tr} bl=${s.corners.bl} br=${s.corners.br}`,
  );
  console.log(
    `[tapestry-mask-qa] quads ${s.quads.map((q) => `${q.name}=${(q.frac * 100).toFixed(1)}%`).join(" ")}`,
  );

  const missing = Object.entries(s.corners).filter(([, n]) => n < 8);
  if (missing.length) {
    fail(`incomplete corners: ${missing.map(([k, n]) => `${k}=${n}`).join(", ")}`);
  }

  const tl = s.quads.find((q) => q.name === "tl")!.frac;
  const tr = s.quads.find((q) => q.name === "tr")!.frac;
  if (tl > 0.35 && tr < tl * 0.55) {
    fail(`top-right quadrant ${(tr * 100).toFixed(1)}% vs top-left ${(tl * 100).toFixed(1)}% — probe miss`);
  }
  for (const q of s.quads) {
    if (q.frac < 0.45) fail(`sparse ${q.name} quadrant ${(q.frac * 100).toFixed(1)}%`);
  }

  if (s.sampleCore < 250) fail(`core not solid (center alpha ${s.sampleCore})`);
  // r=1 sets the boundary to 160. On a ~1200² droop the mid band is ~0.5% of
  // opaque — maskAlphaLooksBinary still says "binary" (2% cutoff), so do not
  // use that heuristic as a harvest fail. Over-blur (old r=2) pushes midFrac up.
  if (s.edge160 < 200) fail(`almost no r=1 edge (edge160=${s.edge160})`);
  if (s.midFracOfOpaque > 0.08) fail(`over-feathered midFrac=${s.midFracOfOpaque.toFixed(4)}`);
  if (s.coreFracOfAabb < 0.62) fail(`hollow silhouette core/aabb=${s.coreFracOfAabb.toFixed(3)}`);

  console.log("[tapestry-mask-qa] PASS complete corners + edge-only feather");
  process.exit(0);
}

main().catch((err) => {
  console.error("[tapestry-mask-qa]", err?.message || err);
  process.exit(1);
});
