/**
 * Staging-only Petposterous art-style QA batch.
 *
 *   STAGING_PROBE_URL=https://ai-art-studio-staging.up.railway.app ^
 *   STAGING_PROBE_TOKEN=… ^
 *   REFERENCE_IMAGE=./spaniel.jpg ^
 *   npx tsx scripts/staging-petposterous-art-style-batch.ts
 *
 * Ten styles × 2, plus the woodcut short-prompt control × 2.
 * Flare, native transparent, pinned Hostile Negotiations. Never production.
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const base = (process.env.STAGING_PROBE_URL || "").replace(/\/$/, "");
const token = process.env.STAGING_PROBE_TOKEN || "";
const imagePath = process.env.REFERENCE_IMAGE || "";
if (!base || token.length < 24 || !imagePath) {
  console.error("Need STAGING_PROBE_URL, STAGING_PROBE_TOKEN (24+ chars), and REFERENCE_IMAGE.");
  process.exit(1);
}
if (/production/i.test(base)) {
  console.error("Refusing a production URL.");
  process.exit(1);
}

const buf = readFileSync(resolve(imagePath));
const ext = imagePath.toLowerCase();
const mime = ext.endsWith(".png") ? "image/png" : ext.endsWith(".webp") ? "image/webp" : "image/jpeg";
const photoDataUrl = `data:${mime};base64,${buf.toString("base64")}`;

async function post(path: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-appai-probe-token": token },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(`${path} ${res.status}: ${json.error || "failed"}`);
  return json;
}

const prep = await post("/api/staging/render-probe/art-style/prepare", { photoDataUrl });
const styles = prep.styles as { id: string; label: string }[];
const variants = Number(prep.variants) || 2;
const jobs: { artStyle: string; label: string; variant: number; promptLength: "full" | "short" }[] = [];
for (const style of styles) {
  for (let variant = 1; variant <= variants; variant++) jobs.push({ artStyle: style.id, label: style.label, variant, promptLength: "full" });
}
jobs.push(
  { artStyle: "woodcut", label: "Woodcut short", variant: 1, promptLength: "short" },
  { artStyle: "woodcut", label: "Woodcut short", variant: 2, promptLength: "short" },
);

const manifest: Record<string, unknown>[] = [];
let cursor = 0;
async function one(job: (typeof jobs)[number]) {
  const row = await post("/api/staging/render-probe/art-style", {
    batchId: prep.batchId,
    referencePhotoId: prep.referencePhotoId,
    ...job,
  });
  manifest.push({ ...job, ...row });
  const alpha = (row.edges as { alpha?: { transparentPct?: number; featherPct?: number; haloPct?: number } } | undefined)?.alpha;
  console.log(
    `${job.label} ${job.promptLength} #${job.variant} id=${row.id} ${row.width}x${row.height} ` +
      `${Number(row.durationMs || 0) / 1000}s $${row.estimatedCostUsd ?? "?"} ` +
      (alpha ? `clear=${alpha.transparentPct}% feather=${alpha.featherPct}% halo=${alpha.haloPct}%` : ""),
  );
}
async function worker() {
  while (cursor < jobs.length) await one(jobs[cursor++]);
}
await Promise.all([worker(), worker()]);

const outDir = resolve("tmp/art-style-batch");
mkdirSync(outDir, { recursive: true });
const out = resolve(outDir, `${prep.batchId}.json`);
writeFileSync(out, JSON.stringify({ batchId: prep.batchId, referencePhotoId: prep.referencePhotoId, results: manifest }, null, 2));
const cost = manifest.reduce((sum, row) => sum + (Number(row.estimatedCostUsd) || 0), 0);
console.log(`Wrote ${manifest.length} rows to ${out}. Estimated cost $${cost.toFixed(4)}.`);
console.log(`Grid: ${base}/staging/render-probe  experiment art-styles:${prep.batchId}`);
