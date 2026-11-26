#!/usr/bin/env node
/**
 * Parse-check every theme-extension JS asset before `shopify app deploy`
 * ships it to merchants' storefronts.
 *
 * Why this exists: staging-94 (commit f6030560, 2026-11-07) shipped a
 * broken file because a JSDoc block comment contained the literal
 * sequence "_appai_*​/_design_id" — the "*​/" closed the block comment
 * early, and the rest of the "sentence" became invalid JS. Our normal
 * `npm run build` only bundles client+server with esbuild/vite; the
 * extension assets are copied verbatim by `shopify app deploy`, so no
 * bundler ever parses them. `tsc` doesn't touch .js assets either, and
 * eslint wasn't configured for the extensions folder. Result: a syntax
 * error with zero local signal — the whole storefront script 404'd its
 * parse step and every PDP went dark.
 *
 * `node --check <file>` runs the full JS parser without executing
 * anything. Any SyntaxError exits non-zero, which cascades to a failed
 * `npm run shopify:deploy:*` — the deploy never reaches Shopify, and
 * the broken file never leaves the dev box.
 *
 * All 13 current assets pass today. Add new files to extensions/theme-
 * extension/assets/*.js and they're picked up automatically.
 */
import { readdir, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const assetsDir = path.resolve(here, "../extensions/theme-extension/assets");

function runCheck(file) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--check", file], { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (b) => (stderr += b.toString()));
    child.on("exit", (code) => resolve({ code: code ?? 1, stderr }));
  });
}

async function main() {
  let entries;
  try {
    entries = await readdir(assetsDir);
  } catch (err) {
    console.error(`[ext:parse-check] cannot read ${assetsDir}: ${err.message}`);
    process.exit(2);
  }
  const jsFiles = [];
  for (const name of entries) {
    if (!name.endsWith(".js")) continue;
    const full = path.join(assetsDir, name);
    try {
      const s = await stat(full);
      if (s.isFile()) jsFiles.push(full);
    } catch {}
  }
  if (!jsFiles.length) {
    console.error(`[ext:parse-check] no .js assets found in ${assetsDir}`);
    process.exit(2);
  }

  let failed = 0;
  for (const file of jsFiles) {
    const rel = path.relative(process.cwd(), file);
    const { code, stderr } = await runCheck(file);
    if (code === 0) {
      console.log(`  ok   ${rel}`);
    } else {
      failed++;
      console.error(`  FAIL ${rel}`);
      if (stderr) console.error(stderr.trim().split("\n").map((l) => "       " + l).join("\n"));
    }
  }
  if (failed > 0) {
    console.error(`\n[ext:parse-check] ${failed} file(s) failed to parse — aborting deploy.`);
    process.exit(1);
  }
  console.log(`\n[ext:parse-check] ${jsFiles.length} file(s) parsed clean.`);
}

main().catch((err) => {
  console.error(`[ext:parse-check] unexpected failure: ${err?.message || err}`);
  process.exit(2);
});
