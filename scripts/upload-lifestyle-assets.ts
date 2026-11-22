/**
 * One-time: upload the per-garment static references for "See it worn"
 * lifestyle mockups to the hoodie-templates bucket (lifestyle/<garment>/...).
 * Reference 3 = plain hoodie photo, reference 4 = pocket close-up.
 *
 *   npx tsx scripts/upload-lifestyle-assets.ts <dir-with-the-four-pngs>          # dry run
 *   npx tsx scripts/upload-lifestyle-assets.ts <dir-with-the-four-pngs> --apply
 */
import "../server/load-env";
import fs from "node:fs";
import path from "node:path";
import {
  downloadFromHoodieTemplatesBucket,
  publicHoodieTemplateUrl,
  uploadToHoodieTemplatesBucket,
} from "../server/supabaseHoodieTemplates";
import { lifestyleAssetPaths } from "../server/lifestyle-mockup";

const SOURCES = {
  zip: { blank: "Blank zip hoodie pocket reference.png", pocket: "zip_pocket_closeup.png" },
  pullover: { blank: "Blank pullover hoodie pocket reference.png", pocket: "pullover_pocket_closeup.png" },
} as const;

async function main() {
  const dir = process.argv[2];
  const apply = process.argv.includes("--apply");
  if (!dir) throw new Error("usage: upload-lifestyle-assets.ts <dir> [--apply]");
  for (const garment of ["zip", "pullover"] as const) {
    const dest = lifestyleAssetPaths(garment);
    for (const kind of ["blank", "pocket"] as const) {
      const src = path.join(dir, SOURCES[garment][kind]);
      const buf = fs.readFileSync(src);
      if (buf.subarray(1, 4).toString("latin1") !== "PNG") throw new Error(`${src} is not a PNG`);
      const existing = await downloadFromHoodieTemplatesBucket(dest[kind]).catch(() => null);
      const same = existing != null && Buffer.compare(existing, buf) === 0;
      console.log(`${garment} ${kind}: ${path.basename(src)} (${(buf.length / 1024).toFixed(0)} KB) -> ${dest[kind]}` +
        (existing ? (same ? "  [already identical]" : "  [EXISTS, differs]") : "  [new]"));
      if (!apply || same) continue;
      if (existing && !same) throw new Error(`${dest[kind]} already exists with different bytes — refusing to overwrite`);
      await uploadToHoodieTemplatesBucket(dest[kind], buf, "image/png");
      console.log(`   uploaded -> ${publicHoodieTemplateUrl(dest[kind])}`);
    }
  }
  if (!apply) console.log("\nDRY RUN — nothing uploaded.");
}
main().catch((e) => { console.error("FAILED:", e?.message || e); process.exitCode = 1; });
