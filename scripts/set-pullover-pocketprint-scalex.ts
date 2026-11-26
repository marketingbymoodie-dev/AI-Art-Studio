/**
 * Pullover (bp 450) pocketPrint horizontal + position correction, calibrated
 * against Printify renders of circle/grid art (2026-09-27):
 *
 *   pocketPrint.scaleX  = 1.176   print  (NEW field — added, not changed)
 *   pocketPrint.offsetX = 3.3     print  (was 0)
 *   pocketPrint.offsetY = -17.5   print  (was -14.55)
 *
 * Display `pocket` is untouched. Requires the scaleX code (b87ac74e) — older
 * code ignores scaleX and would apply only the offsets.
 *
 *   npx tsx scripts/set-pullover-pocketprint-scalex.ts            # dry run
 *   npx tsx scripts/set-pullover-pocketprint-scalex.ts --apply
 */
import "../server/load-env";
import fs from "node:fs";
import {
  downloadFromHoodieTemplatesBucket,
  uploadToHoodieTemplatesBucket,
} from "../server/supabaseHoodieTemplates";
import {
  normalizeHoodieTemplate,
  resolveFrontBodyPanelBias,
  resolvePrintFrontBodyPanelBias,
} from "../shared/hoodieTemplate";

const SCRATCH =
  "C:/Users/young/AppData/Local/Temp/claude/c--Users-young-AppAI-appai-pod/114556d2-dd60-40fd-ae3b-3d34eacce6ee/scratchpad/";
const TARGET = "templates/unisex-pullover-hoodie-aop-L.json";
const SCALE_X = 1.176;
const OFFSET_X = 3.3;
const OFFSET_Y = -17.5;

const fb = (t: any) => (t.designGroups || []).find((g: any) => g.id === "front-body");

function applyEdit(t: any) {
  const pp = fb(t).panelPlacementBias.pocketPrint;
  pp.offsetX = OFFSET_X;
  pp.offsetY = OFFSET_Y;
  pp.scaleX = SCALE_X;
}

async function main() {
  const apply = process.argv.includes("--apply");

  const buf = await downloadFromHoodieTemplatesBucket(TARGET);
  if (!buf) throw new Error(`${TARGET} not found`);
  const backup = SCRATCH + `published-pullover-L.backup-scalex-${Date.now()}.json`;
  fs.writeFileSync(backup, buf);
  console.log(`[pull] downloaded ${TARGET} (${(buf.length / 1024).toFixed(0)} KB)`);
  console.log(`[pull] backup -> ${backup}\n`);

  const orig = JSON.parse(buf.toString("utf8"));
  const tpl = JSON.parse(buf.toString("utf8"));
  const beforePocket = JSON.stringify(fb(orig).panelPlacementBias?.pocket);
  const pp0 = fb(orig).panelPlacementBias?.pocketPrint;

  // PRECONDITION: pocketPrint must still be exactly what we calibrated against.
  console.log(`[pull] pocket      BEFORE: ${beforePocket}`);
  console.log(`[pull] pocketPrint BEFORE: ${JSON.stringify(pp0)}`);
  const pre =
    pp0 != null &&
    (pp0.offsetX ?? 0) === 0 &&
    pp0.offsetY === -14.55 &&
    (pp0.scale ?? 1) === 1 &&
    pp0.scaleX == null;
  if (!pre) throw new Error("PRECONDITION FAILED: pocketPrint drifted from offsetX 0 / offsetY -14.55 / scale 1 / no scaleX — aborting");
  console.log(`[pull] PRECONDITION OK`);

  applyEdit(tpl);
  console.log(`[pull] pocketPrint AFTER : ${JSON.stringify(fb(tpl).panelPlacementBias.pocketPrint)}`);

  // ISOLATION 1: deterministic edit.
  const probe = JSON.parse(buf.toString("utf8"));
  applyEdit(probe);
  if (JSON.stringify(probe) !== JSON.stringify(tpl)) throw new Error("edit is not deterministic — aborting");

  // ISOLATION 2: classified leaf diff over the WHOLE template. Must be exactly
  // offsetX + offsetY changed and scaleX added, nothing removed, nothing else.
  const changed: string[] = [];
  const added: string[] = [];
  const removed: string[] = [];
  (function walk(a: any, b: any, p: string) {
    if (a === undefined && b !== undefined) { added.push(`${p} = ${JSON.stringify(b)}`); return; }
    if (a !== undefined && b === undefined) { removed.push(`${p} (was ${JSON.stringify(a)})`); return; }
    if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) {
      if (JSON.stringify(a) !== JSON.stringify(b)) changed.push(`${p}: ${JSON.stringify(a)} -> ${JSON.stringify(b)}`);
      return;
    }
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) walk(a[k], b[k], `${p}.${k}`);
  })(orig, tpl, "");
  const fbIdx = (orig.designGroups || []).findIndex((g: any) => g.id === "front-body");
  const root = `.designGroups.${fbIdx}.panelPlacementBias.pocketPrint`;
  console.log(`\n[pull] ISOLATION CHECK`);
  console.log(`   changed (${changed.length}): ${changed.join(" | ")}`);
  console.log(`   added   (${added.length}): ${added.join(" | ")}`);
  console.log(`   removed (${removed.length}): ${removed.join(" | ") || "-"}`);
  const okIso =
    changed.length === 2 &&
    changed.includes(`${root}.offsetX: 0 -> ${OFFSET_X}`) &&
    changed.includes(`${root}.offsetY: -14.55 -> ${OFFSET_Y}`) &&
    added.length === 1 &&
    added[0] === `${root}.scaleX = ${SCALE_X}` &&
    removed.length === 0;
  if (!okIso) throw new Error("isolation check failed — diff is not exactly 2 changed + 1 added — aborting");
  console.log(`   -> exactly offsetX/offsetY changed + scaleX added under ${root}`);

  // DISPLAY GUARD: display pocket byte-identical; display resolve has no scaleX.
  const afterPocket = JSON.stringify(fb(tpl).panelPlacementBias.pocket);
  const disp = resolveFrontBodyPanelBias(fb(tpl), "front_pocket") as any;
  console.log(`\n[pull] DISPLAY GUARD`);
  console.log(`   pocket unchanged: ${afterPocket === beforePocket ? "YES" : "NO"}`);
  console.log(`   display resolve  : ${JSON.stringify(disp)}`);
  if (afterPocket !== beforePocket || disp?.scaleX != null || disp?.offsetY !== -5.74) {
    throw new Error("display guard failed — aborting");
  }

  // NORMALIZE + PRINT GUARD: values survive load, and the print resolver
  // (the order-bake path) returns scaleX.
  const n = fb(normalizeHoodieTemplate(JSON.parse(JSON.stringify(tpl)) as any) as any);
  const print = resolvePrintFrontBodyPanelBias(n, "front_pocket") as any;
  const nDisp = resolveFrontBodyPanelBias(n, "front_pocket") as any;
  console.log(`\n[pull] NORMALIZE + PRINT GUARD`);
  console.log(`   normalized pocketPrint: ${JSON.stringify(n.panelPlacementBias.pocketPrint)}`);
  console.log(`   print resolve          : ${JSON.stringify(print)}`);
  console.log(`   display resolve        : ${JSON.stringify(nDisp)}`);
  const okNorm =
    print?.scaleX === SCALE_X && print?.offsetX === OFFSET_X && print?.offsetY === OFFSET_Y &&
    nDisp?.scaleX == null && nDisp?.offsetY === -5.74;
  if (!okNorm) throw new Error("normalize/print guard failed — aborting");
  console.log(`   -> scaleX survives normalize and resolves on print; display has none`);

  // VIEWS GUARD: every mask, mesh and mockup byte-identical.
  const viewsUnchanged = JSON.stringify(orig.views) === JSON.stringify(tpl.views);
  const meshes = (tpl.views?.front?.layers || [])
    .filter((l: any) => l.mesh?.targetPoints?.length)
    .map((l: any) => `${l.panelKey}(${l.mesh.targetPoints.length})`);
  console.log(`\n[pull] VIEWS GUARD: front meshes ${meshes.join(", ")}`);
  console.log(`   views subtree unchanged: ${viewsUnchanged ? "YES" : "NO"}`);
  if (!viewsUnchanged) throw new Error("views subtree changed — aborting");

  if (!apply) { console.log("\n[pull] DRY RUN — nothing written."); return; }
  const out = Buffer.from(JSON.stringify(tpl), "utf8");
  await uploadToHoodieTemplatesBucket(TARGET, out, "application/json");
  console.log(`\n[pull] WROTE ${TARGET} (${(out.length / 1024).toFixed(0)} KB)`);

  // READ-BACK: the stored object is exactly what we wrote.
  const back = await downloadFromHoodieTemplatesBucket(TARGET);
  const same = back != null && back.toString("utf8") === out.toString("utf8");
  console.log(`[pull] READ-BACK identical to written bytes: ${same ? "YES" : "NO"}`);
  if (!same) throw new Error("read-back mismatch");
}
main().catch((e) => { console.error("[pull] FAILED:", e?.message || e); process.exitCode = 1; });
