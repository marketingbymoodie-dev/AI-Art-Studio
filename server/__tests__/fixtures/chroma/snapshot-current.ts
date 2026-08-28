/**
 * Write BEFORE alpha PNGs for WP2 Ticket 1 — run against current processApparelMotif
 * before changing Pass C. Usage: npx tsx server/__tests__/fixtures/chroma/snapshot-current.ts
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { processApparelMotif } from "../../../apparel-matting";
import { CHROMA_FIXTURES, FIXTURE_SIZE, rgbaBuffer } from "./paintChromaFixtures";

const here = path.dirname(fileURLToPath(import.meta.url));
const beforeDir = path.join(here, "before");

async function alphaPng(buffer: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const grey = Buffer.alloc(info.width * info.height);
  for (let i = 0, p = 0; i < data.length; i += info.channels, p++) {
    grey[p] = data[i + 3];
  }
  return sharp(grey, { raw: { width: info.width, height: info.height, channels: 1 } }).png().toBuffer();
}

async function main() {
  fs.mkdirSync(beforeDir, { recursive: true });
  for (const name of Object.keys(CHROMA_FIXTURES) as (keyof typeof CHROMA_FIXTURES)[]) {
    const src = await rgbaBuffer(FIXTURE_SIZE, FIXTURE_SIZE, CHROMA_FIXTURES[name]);
    const { buffer } = await processApparelMotif(src, {
      useMlFallback: false,
      allowWhiteKey: true,
      vectorize: false,
    });
    const alpha = await alphaPng(buffer);
    const out = path.join(beforeDir, `${name}.alpha.png`);
    fs.writeFileSync(out, alpha);
    fs.writeFileSync(path.join(beforeDir, `${name}.png`), buffer);
    console.log(`[chroma fixtures] wrote ${out}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
