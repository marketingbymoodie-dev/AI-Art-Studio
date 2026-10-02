/**
 * Staging-only render probe (QA tooling).
 *
 * POST /api/staging/render-probe sends a prompt VERBATIM to a configured direct
 * renderer (Google Nano Banana family or OpenAI GPT Image) on the Petposterous
 * dedicated credentials — no prompt layers, decor rules or customer storage — so
 * a model/API path can be isolated from our prompt stack. Results (metadata +
 * image in a PRIVATE bucket) are kept for comparison over time and shown on
 * GET /staging/render-probe.
 *
 * Every route is 404 unless the Railway environment is staging AND the
 * x-appai-probe-token header matches STAGING_PROBE_TOKEN. Never in production.
 * The browser never receives provider keys, bucket URLs or full prompt text
 * (only a prompt id and length).
 */
import type { Express, Request, Response } from "express";
import { createHash, timingSafeEqual } from "node:crypto";
import sharp from "sharp";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { desc, eq } from "drizzle-orm";
import { renderProbeResults } from "@shared/schema";
import {
  CREDENTIALS,
  GOOGLE_RENDERERS,
  RENDERERS,
  readCredential,
  type GoogleImageSize,
} from "../generation-providers";
import { estimateGoogleImageCostUsd, renderGoogleImage } from "../google-image-client";
import { estimateOpenAIImageCostUsd, renderOpenAIImage, type OpenAIImageUsage } from "../openai-image-client";
import { recordGenerationEvent } from "../generation-events";

export function stagingProbeAllowed(req: Pick<Request, "get">, env: Record<string, string | undefined> = process.env): boolean {
  const envName = String(env.RAILWAY_ENVIRONMENT_NAME ?? "").toLowerCase();
  const expected = env.STAGING_PROBE_TOKEN ?? "";
  const got = req.get("x-appai-probe-token") ?? "";
  if (envName !== "staging" || expected.length < 24 || got.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}

function stagingOnly(env: Record<string, string | undefined> = process.env): boolean {
  return String(env.RAILWAY_ENVIRONMENT_NAME ?? "").toLowerCase() === "staging" && (env.STAGING_PROBE_TOKEN ?? "").length >= 24;
}

export type EdgeSide = { palePct: number; uniformPct: number };
export type EdgeReport = { bandPx: number; top: EdgeSide; bottom: EdgeSide; left: EdgeSide; right: EdgeSide };

/**
 * Outer-1% band per side: share of near-white "bare paper" pixels, and share of
 * pixels within a small distance of the band's median colour (a solid margin of
 * any colour — cream, mustard — reads high; painted content reads low).
 */
export async function measureEdges(buf: Buffer): Promise<EdgeReport> {
  const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width;
  const H = info.height;
  const c = info.channels;
  const band = Math.max(1, Math.round(Math.min(W, H) * 0.01));
  const sides = ["top", "bottom", "left", "right"] as const;
  const px: Record<(typeof sides)[number], number[]> = { top: [], bottom: [], left: [], right: [] };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const k = y < band ? "top" : y >= H - band ? "bottom" : x < band ? "left" : x >= W - band ? "right" : null;
      if (k) px[k].push((y * W + x) * c);
    }
  }
  const median = (arr: number[]) => arr.sort((a, b) => a - b)[arr.length >> 1] ?? 0;
  const out = { bandPx: band } as EdgeReport;
  for (const s of sides) {
    const idx = px[s];
    const r = median(idx.map((i) => data[i]));
    const g = median(idx.map((i) => data[i + 1]));
    const b = median(idx.map((i) => data[i + 2]));
    let pale = 0;
    let uniform = 0;
    for (const i of idx) {
      const R = data[i], G = data[i + 1], B = data[i + 2];
      if (R > 225 && G > 220 && B > 205 && Math.max(R, G, B) - Math.min(R, G, B) < 40) pale++;
      if (Math.abs(R - r) + Math.abs(G - g) + Math.abs(B - b) < 36) uniform++;
    }
    out[s] = { palePct: Math.round((pale / idx.length) * 100), uniformPct: Math.round((uniform / idx.length) * 100) };
  }
  return out;
}

// ---- private storage for probe images -------------------------------------
const BUCKET = "staging-render-probes";
let _sb: SupabaseClient | null | undefined;
function sb(): SupabaseClient | null {
  if (_sb !== undefined) return _sb;
  const url = process.env.SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  _sb = url && key ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
  return _sb;
}
let bucketReady: Promise<void> | null = null;
function ensureBucket(c: SupabaseClient): Promise<void> {
  bucketReady ??= (async () => {
    const { data } = await c.storage.getBucket(BUCKET);
    if (data) {
      if (data.public) throw new Error(`${BUCKET} bucket is public — refusing`);
      return;
    }
    const { error } = await c.storage.createBucket(BUCKET, { public: false, fileSizeLimit: "40MB" });
    if (error && !/already exists/i.test(error.message)) throw new Error(`createBucket failed: ${error.message}`);
  })().catch((e) => {
    bucketReady = null;
    throw e;
  });
  return bucketReady;
}

async function db() {
  return (await import("../db")).db;
}

type ProbeBody = {
  prompt?: unknown;
  promptId?: unknown;
  experiment?: unknown;
  run?: unknown;
  renderer?: unknown;
  aspectRatio?: unknown;
  imageSize?: unknown;
};

const str = (v: unknown, max: number, fallback = "") => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : fallback);

export function registerStagingRenderProbeRoutes(app: Express): void {
  app.post("/api/staging/render-probe", async (req: Request, res: Response) => {
    if (!stagingProbeAllowed(req)) return res.status(404).json({ error: "Not found" });
    const body = (req.body ?? {}) as ProbeBody;
    const prompt = typeof body.prompt === "string" ? body.prompt : "";
    if (!prompt) return res.status(400).json({ error: "prompt required" });
    const promptHash = createHash("sha256").update(prompt).digest("hex").slice(0, 12);
    const promptId = str(body.promptId, 60, `prompt-${promptHash}`);
    const experiment = str(body.experiment, 80, "ad-hoc");
    const run = Number.isInteger(body.run) ? (body.run as number) : null;
    const aspectRatio = str(body.aspectRatio, 8, "4:3");
    const imageSize = (["1K", "2K", "4K"].includes(String(body.imageSize)) ? body.imageSize : "2K") as GoogleImageSize;
    const rendererId = str(body.renderer, 40, "google-nb2");
    const google = GOOGLE_RENDERERS[rendererId];
    const openai = RENDERERS[rendererId];
    if (!google && !openai) return res.status(400).json({ error: "unknown renderer" });
    const credential = google ? CREDENTIALS["google:petposterous"] : CREDENTIALS["openai:petposterous"];

    const started = Date.now();
    let mimeType = "";
    let data = "";
    let usage: OpenAIImageUsage | null = null;
    let requestId: string | null = null;
    let providerMs = 0;
    let estimatedCostUsd: number | null = null;
    let thoughtsTokens = 0;
    try {
      const apiKey = await readCredential(credential);
      if (google) {
        const r = await renderGoogleImage({ apiKey, credential, renderer: google, prompt, aspectRatio, imageSize });
        ({ mimeType, data, usage, requestId, thoughtsTokens } = r);
        providerMs = r.durationMs;
        estimatedCostUsd = estimateGoogleImageCostUsd(usage, google);
      } else {
        const r = await renderOpenAIImage({ apiKey, credential, renderer: openai, prompt, aspectRatio, background: "opaque" });
        ({ mimeType, data, usage, requestId } = r);
        providerMs = r.durationMs;
        estimatedCostUsd = estimateOpenAIImageCostUsd(usage, openai);
      }
    } catch (err) {
      const message = String((err as Error)?.message ?? err).slice(0, 300);
      void recordGenerationEvent(
        { kind: "image", route: "staging-render-probe", experienceProfile: "petposterous", legacyModel: (google ?? openai).model },
        { success: false, durationMs: Date.now() - started, error: err },
      );
      try {
        await (await db()).insert(renderProbeResults).values({
          experiment, promptId, promptChars: prompt.length, run, provider: credential.provider, model: (google ?? openai).model,
          rendererId, aspectRatio, imageSize: google ? imageSize : null, success: false, error: message,
        });
      } catch { /* best effort */ }
      return res.status(502).json({ error: message });
    }

    const buf = Buffer.from(data, "base64");
    const meta = await sharp(buf).metadata();
    const edges = await measureEdges(buf);
    const model = (google ?? openai).model;
    const sizeLabel = `${meta.width}x${meta.height}`;
    void recordGenerationEvent(
      { kind: "image", route: "staging-render-probe", experienceProfile: "petposterous" },
      {
        success: true,
        durationMs: Date.now() - started,
        meta: {
          provider: credential.provider as "google" | "openai",
          credentialRefId: credential.id,
          credentialScope: credential.scope,
          model,
          quality: google ? (google.supportsImageSize === false ? "native" : imageSize) : openai.quality,
          size: sizeLabel,
          attempts: 1,
          durationMs: providerMs,
          transparent: null,
          transparentFraction: null,
          usage,
          estimatedCostUsd,
          providerRequestId: requestId,
          providerMime: mimeType,
        },
      },
    );

    let storagePath: string | null = null;
    let storageError: string | null = null;
    const c = sb();
    if (c) {
      try {
        await ensureBucket(c);
        const ext = mimeType.includes("png") ? "png" : mimeType.includes("webp") ? "webp" : "jpg";
        const path = `${experiment.replace(/[^A-Za-z0-9_-]/g, "-")}/${Date.now()}-${rendererId}-${run ?? "x"}.${ext}`;
        const { error } = await c.storage.from(BUCKET).upload(path, buf, { contentType: mimeType, upsert: false });
        if (error) throw new Error(error.message);
        storagePath = path;
      } catch (e) {
        storageError = String((e as Error)?.message ?? e).slice(0, 200);
      }
    }
    const [row] = await (await db())
      .insert(renderProbeResults)
      .values({
        experiment, promptId, promptChars: prompt.length, run, provider: credential.provider, model, rendererId,
        aspectRatio, imageSize: google ? (google.supportsImageSize === false ? "native" : imageSize) : openai.quality,
        width: meta.width ?? null, height: meta.height ?? null, mimeType, providerMs, totalMs: Date.now() - started,
        usage, thoughtsTokens, estimatedCostUsd: estimatedCostUsd != null ? estimatedCostUsd.toFixed(6) : null,
        edges, providerRequestId: requestId, storagePath, success: true, error: storageError,
      })
      .returning({ id: renderProbeResults.id });

    return res.json({
      id: row?.id, experiment, promptId, run, provider: credential.provider, model, credentialRef: credential.id,
      mimeType, width: meta.width, height: meta.height, durationMs: providerMs, usage, thoughtsTokens,
      estimatedCostUsd, requestId, edges, stored: !!storagePath, storageError,
    });
  });

  app.get("/api/staging/render-probe/results", async (req: Request, res: Response) => {
    if (!stagingProbeAllowed(req)) return res.status(404).json({ error: "Not found" });
    const rows = await (await db()).select().from(renderProbeResults).orderBy(desc(renderProbeResults.id)).limit(500);
    // storagePath stays server-side; the page asks for images by id.
    return res.json({
      results: rows.map(({ storagePath, ...r }) => ({ ...r, hasImage: !!storagePath })),
    });
  });

  app.get("/api/staging/render-probe/image/:id", async (req: Request, res: Response) => {
    if (!stagingProbeAllowed(req)) return res.status(404).json({ error: "Not found" });
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "bad id" });
    const [row] = await (await db()).select().from(renderProbeResults).where(eq(renderProbeResults.id, id)).limit(1);
    const c = sb();
    if (!row?.storagePath || !c) return res.status(404).json({ error: "Not found" });
    const { data, error } = await c.storage.from(BUCKET).download(row.storagePath);
    if (error || !data) return res.status(404).json({ error: "Not found" });
    let buf = Buffer.from(await data.arrayBuffer());
    let type = row.mimeType || "application/octet-stream";
    if (req.query.thumb === "1") {
      buf = await sharp(buf).resize(640, 640, { fit: "inside" }).jpeg({ quality: 82 }).toBuffer();
      type = "image/jpeg";
    }
    res.setHeader("Content-Type", type);
    res.setHeader("Cache-Control", "private, no-store");
    return res.send(buf);
  });

  app.get("/staging/render-probe", (_req: Request, res: Response) => {
    if (!stagingOnly()) return res.status(404).send("Not found");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Robots-Tag", "noindex");
    res.type("html").send(RESULTS_PAGE);
  });
}

const RESULTS_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Render Probe Results</title>
<style>
:root{--bg:#f6f5f2;--card:#fff;--ink:#1d1d1b;--muted:#6b6a66;--line:#e2e0da;--bad:#b3261e;--ok:#1b6b3a}
*{box-sizing:border-box}body{margin:0;font:14px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--ink)}
header{padding:16px;border-bottom:1px solid var(--line);background:var(--card);display:flex;gap:12px;align-items:center;flex-wrap:wrap}
h1{font-size:18px;margin:0 auto 0 0}main{padding:16px;max-width:1500px;margin:0 auto}
input,button,select{font:inherit;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:#fff}button{cursor:pointer}
h2{font-size:16px;margin:24px 0 8px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;overflow:hidden}
.card img{display:block;width:100%;aspect-ratio:4/3;object-fit:contain;background:repeating-conic-gradient(#eee 0 25%,#fff 0 50%) 0 0/16px 16px;cursor:zoom-in}
.meta{padding:10px 12px;display:grid;grid-template-columns:auto 1fr;gap:2px 10px;font-size:12.5px}.meta b{color:var(--muted);font-weight:500}
.tag{display:inline-block;padding:1px 6px;border-radius:6px;background:#eceae4;font-size:12px;margin-right:4px}
.bad{color:var(--bad)}.ok{color:var(--ok)}.err{padding:12px;color:var(--bad)}
dialog{border:0;padding:0;max-width:96vw;max-height:96vh;background:#111}dialog img{display:block;max-width:96vw;max-height:92vh}
dialog::backdrop{background:rgba(0,0,0,.8)}dialog .bar{color:#ddd;padding:6px 10px;font-size:12px;display:flex;justify-content:space-between;gap:8px}
@media (prefers-color-scheme:dark){:root{--bg:#141413;--card:#1e1e1c;--ink:#ecebe7;--muted:#a3a19b;--line:#33322f}input,button,select{background:#262624;color:var(--ink)}.tag{background:#2c2b28}}
</style></head><body>
<header><h1>Render Probe Results</h1>
<form id="auth"><input id="token" type="password" placeholder="Probe token" autocomplete="off" aria-label="Probe token"> <button>Unlock</button></form>
<select id="exp" aria-label="Experiment"><option value="">All experiments</option></select>
</header><main id="main"><p>Enter the staging probe token to load results. The token stays in this tab only.</p></main>
<dialog id="full"><div class="bar"><span id="fulltitle"></span><button id="close">Close</button></div><img id="fullimg" alt=""></dialog>
<script>
const KEY="appai-probe-token";let token=sessionStorage.getItem(KEY)||"";let rows=[];const blobs={};
const h=(s)=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
async function api(path){const r=await fetch(path,{headers:{"x-appai-probe-token":token}});if(!r.ok)throw new Error(r.status);return r}
async function img(id,thumb){const k=id+(thumb?"t":"");if(blobs[k])return blobs[k];const r=await api("/api/staging/render-probe/image/"+id+(thumb?"?thumb=1":""));blobs[k]=URL.createObjectURL(await r.blob());return blobs[k]}
function edge(e){if(!e)return"–";const s=["top","bottom","left","right"];return s.map(k=>k[0].toUpperCase()+" "+e[k].palePct+"% / "+e[k].uniformPct+"%").join(" · ")}
function render(){const exp=document.getElementById("exp").value;const main=document.getElementById("main");main.innerHTML="";
const groups={};for(const r of rows){if(exp&&r.experiment!==exp)continue;(groups[r.experiment]??=[]).push(r)}
for(const [name,list] of Object.entries(groups)){const sec=document.createElement("section");sec.innerHTML="<h2>"+h(name)+"</h2>";const g=document.createElement("div");g.className="grid";
list.sort((a,b)=>(a.model+a.run).localeCompare(b.model+b.run));
for(const r of list){const c=document.createElement("div");c.className="card";
c.innerHTML=(r.hasImage?'<img alt="'+h(r.model)+' run '+h(r.run)+'" data-id="'+r.id+'">':'<div class="err">'+h(r.error||"no image")+"</div>")+
'<div class="meta"><b>Model</b><span><span class="tag">'+h(r.provider)+"</span>"+h(r.model)+'</span><b>Run</b><span>'+h(r.run??"–")+" · "+h(r.promptId)+" ("+h(r.promptChars)+' chars)</span><b>Size</b><span>'+h(r.width)+"×"+h(r.height)+" · "+h(r.aspectRatio)+" · "+h(r.imageSize)+'</span><b>MIME</b><span>'+h(r.mimeType)+'</span><b>Latency</b><span>'+(r.providerMs!=null?(r.providerMs/1000).toFixed(1)+"s provider":"–")+'</span><b>Cost</b><span>'+(r.estimatedCostUsd!=null?"$"+Number(r.estimatedCostUsd).toFixed(4):"–")+(r.usage?" · "+h(r.usage.inputTokens)+" in / "+h(r.usage.outputTokens)+" out":"")+'</span><b>Edges</b><span title="outer 1% band: bare-paper % / single-colour %">'+edge(r.edges)+'</span><b>When</b><span>'+h(new Date(r.createdAt).toLocaleString())+"</span></div>";
g.appendChild(c)}sec.appendChild(g);main.appendChild(sec)}
if(!main.children.length)main.innerHTML="<p>No results yet.</p>";
for(const el of main.querySelectorAll("img[data-id]")){img(el.dataset.id,true).then(u=>el.src=u).catch(()=>{});el.onclick=async()=>{const r=rows.find(x=>String(x.id)===el.dataset.id);document.getElementById("fulltitle").textContent=r.model+" · run "+(r.run??"–")+" · "+r.width+"×"+r.height;document.getElementById("fullimg").src=await img(el.dataset.id,false);document.getElementById("full").showModal()}}}
async function load(){try{const r=await api("/api/staging/render-probe/results");rows=(await r.json()).results;const sel=document.getElementById("exp");const cur=sel.value;sel.innerHTML='<option value="">All experiments</option>'+[...new Set(rows.map(r=>r.experiment))].map(e=>'<option'+(e===cur?" selected":"")+">"+h(e)+"</option>").join("");render()}catch(e){document.getElementById("main").innerHTML='<p class="err">Not authorised or unavailable ('+h(e.message)+").</p>"}}
document.getElementById("auth").onsubmit=(e)=>{e.preventDefault();token=document.getElementById("token").value.trim();sessionStorage.setItem(KEY,token);load()};
document.getElementById("exp").onchange=render;document.getElementById("close").onclick=()=>document.getElementById("full").close();
if(token)load();
</script></body></html>`;
