/**
 * Staging-only Petposterous art-style QA batch. Short form, ten styles × 2.
 * Does not delete earlier long-form rows.
 *
 *   STAGING_PROBE_URL=https://ai-art-studio-staging.up.railway.app ^
 *   STAGING_PROBE_TOKEN=… ^
 *   REFERENCE_PHOTO_ID=5eb9654283a8ab16 ^
 *   npx tsx scripts/staging-petposterous-art-style-batch.ts
 *
 * Flare, native transparent. Default is the pinned concept, which the validator
 * flags, so those renders pass renderAnyway. ART_STYLE_MODE=full requires
 * ART_STYLE_BEHAVIOUR, writes three truths, then a device per style, and renders
 * CONCEPT_INDEX (default 0). Never production.
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const base = (process.env.STAGING_PROBE_URL || "").replace(/\/$/, "");
const token = process.env.STAGING_PROBE_TOKEN || "";
const photoId = process.env.REFERENCE_PHOTO_ID || "";
const imagePath = process.env.REFERENCE_IMAGE || "";
if (!base || token.length < 24 || (!/^[a-f0-9]{16}$/.test(photoId) && !imagePath)) {
  console.error("Need STAGING_PROBE_URL, STAGING_PROBE_TOKEN (24+ chars), and REFERENCE_PHOTO_ID or REFERENCE_IMAGE.");
  process.exit(1);
}
if (/production/i.test(base)) {
  console.error("Refusing a production URL.");
  process.exit(1);
}

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

const prepareBody: Record<string, unknown> = {};
if (/^[a-f0-9]{16}$/.test(photoId)) {
  prepareBody.referencePhotoId = photoId;
} else {
  const buf = readFileSync(resolve(imagePath));
  const ext = imagePath.toLowerCase();
  const mime = ext.endsWith(".png") ? "image/png" : ext.endsWith(".webp") ? "image/webp" : "image/jpeg";
  prepareBody.photoDataUrl = `data:${mime};base64,${buf.toString("base64")}`;
}

const mode = process.env.ART_STYLE_MODE === "full" ? "full" : "pinned";
const prep = await post("/api/staging/render-probe/art-style/prepare", prepareBody);
let selectedIdea: Record<string, unknown> | null = null;
let ideas: unknown[] = [];
let behaviour = "";
if (mode === "full") {
  behaviour = process.env.ART_STYLE_BEHAVIOUR || "";
  if (!behaviour.trim()) throw new Error("ART_STYLE_MODE=full needs ART_STYLE_BEHAVIOUR.");
  const concepts = await post("/api/staging/render-probe/art-style/concepts", { behaviour, productFamily: "apparel" });
  behaviour = String(concepts.behaviour || behaviour);
  ideas = Array.isArray(concepts.options) ? concepts.options : [];
  ideas.forEach((idea, index) => {
    const row = idea as { punchline?: string; funnyTruth?: string; shotFlags?: string[]; rewritten?: boolean };
    console.log(`idea ${index + 1}: ${row.funnyTruth || ""} | ${row.punchline || "(no text)"}${row.rewritten ? " · rewritten" : ""}${row.shotFlags?.length ? " · shot" : ""}`);
  });
  const index = Math.max(0, Math.min(ideas.length - 1, Number(process.env.CONCEPT_INDEX || 0) || 0));
  selectedIdea = (ideas[index] as Record<string, unknown>) || null;
  if (!selectedIdea) throw new Error("Truth writer returned no ideas");
  console.log(`Rendering idea ${index + 1}. Truths took ${concepts.truthMs}ms.`);
}
const truth = mode === "full"
  ? String(selectedIdea?.funnyTruth || "")
  : String(prep.concept || "");
const punchline = mode === "full"
  ? String(selectedIdea?.punchline || "")
  : String(prep.words || "");
const renderAnyway = mode === "pinned" || (Array.isArray(selectedIdea?.shotFlags) && (selectedIdea?.shotFlags as unknown[]).length > 0);
const styleIds = (prep.styles as { id: string }[]).map((style) => style.id);
const deviceStarted = Date.now();
const deviceResult = await post("/api/staging/render-probe/art-style/device", { funnyTruth: truth, punchline, artStyles: styleIds });
const devices = new Map((deviceResult.devices as { styleId: string; device: string; deviceMs: number }[]).map((row) => [row.styleId, row]));
console.log(`Devices took ${deviceResult.deviceMs ?? Date.now() - deviceStarted}ms.`);
const styles = prep.styles as { id: string; label: string }[];
const variants = Number(prep.variants) || 2;
const jobs: { artStyle: string; label: string; variant: number; promptLength: "short" }[] = [];
for (const style of styles) {
  for (let variant = 1; variant <= variants; variant++) {
    jobs.push({ artStyle: style.id, label: style.label, variant, promptLength: "short" });
  }
}

const manifest: Record<string, unknown>[] = [];
let cursor = 0;
async function one(job: (typeof jobs)[number]) {
  const deviceRow = devices.get(job.artStyle);
  if (!deviceRow) throw new Error(`No device for ${job.artStyle}`);
  const row = await post("/api/staging/render-probe/art-style", {
    batchId: prep.batchId,
    referencePhotoId: prep.referencePhotoId,
    mode,
    behaviour,
    funnyTruth: truth,
    punchline,
    device: deviceRow.device,
    deviceMs: deviceRow.deviceMs,
    renderAnyway,
    speculativeHit: false,
    pickedIndex: mode === "full" ? Number(process.env.CONCEPT_INDEX || 0) || 0 : 0,
    ...job,
  });
  manifest.push({ ...job, ...row });
  const alpha = (row.edges as { alpha?: { transparentPct?: number; featherPct?: number; haloPct?: number } } | undefined)?.alpha;
  console.log(
    `${job.label} #${job.variant} chars=${row.promptChars} id=${row.id} ${row.width}x${row.height} ` +
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
writeFileSync(out, JSON.stringify({ batchId: prep.batchId, referencePhotoId: prep.referencePhotoId, mode, behaviour, ideas, selectedIdea, results: manifest }, null, 2));
const cost = manifest.reduce((sum, row) => sum + (Number(row.estimatedCostUsd) || 0), 0);
console.log(`Wrote ${manifest.length} rows to ${out}. Estimated cost $${cost.toFixed(4)}.`);
console.log(`Grid: ${base}/staging/render-probe  experiment art-styles:${prep.batchId}`);
