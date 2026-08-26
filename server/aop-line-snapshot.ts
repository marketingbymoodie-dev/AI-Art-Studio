/**
 * Freeze AOP print panels onto a cart line at add-to-cart.
 * Two ATCs from the same generation job otherwise share the latest
 * designState.aopPrintPanelUrls and Printify bakes one placement twice.
 */
import {
  downloadFlatCalibrationFile,
  uploadToFlatCalibrationBucket,
} from "./supabaseFlatCalibration";
import { LINE_AOP_PANELS_KEY } from "@shared/linePlacementSnapshot";
import { storage } from "./storage";

export type AopPanel = { position: string; url: string };

export function normalizeAopPanels(raw: unknown): AopPanel[] {
  if (!Array.isArray(raw)) return [];
  const out: AopPanel[] = [];
  for (const p of raw) {
    const position = String((p as { position?: unknown })?.position || "").trim();
    const url = String((p as { url?: unknown })?.url || "").trim();
    if (!position || !url) continue;
    if (!url.startsWith("http") && !url.startsWith("/")) continue;
    out.push({ position, url });
  }
  return out;
}

export function pickAopPanelsForOrderLine(
  lineSnapshot: AopPanel[] | null | undefined,
  jobPanels: AopPanel[],
): AopPanel[] {
  return lineSnapshot && lineSnapshot.length > 0 ? lineSnapshot : jobPanels;
}

function jobIdFromLineValue(raw: string): string {
  const s = String(raw || "").trim();
  return s.includes("::") ? s.split("::")[0] : s;
}

const AOP_SNAPSHOT_MAX_PANELS = 32;
const AOP_SNAPSHOT_MAX_URL_LEN = 2048;

export async function persistAopLinePanelSnapshot(
  jobId: string,
  panels: AopPanel[],
): Promise<string | null> {
  const capped = panels
    .filter((p) => p.url.length <= AOP_SNAPSHOT_MAX_URL_LEN)
    .slice(0, AOP_SNAPSHOT_MAX_PANELS);
  if (capped.length === 0) return null;
  const safeJob = jobIdFromLineValue(jobId).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40) || "job";
  const filename = `aop-line-snapshots/${safeJob}/${Date.now().toString(36)}.json`;
  await uploadToFlatCalibrationBucket(
    filename,
    Buffer.from(JSON.stringify(capped)),
    "application/json",
  );
  return filename.length < 255 ? filename : null;
}

export async function loadAopLinePanelSnapshot(raw?: string | null): Promise<AopPanel[] | null> {
  const s = String(raw || "").trim();
  if (!s) return null;
  if (s.startsWith("{") || s.startsWith("[")) {
    try {
      const parsed = JSON.parse(s);
      const panels = normalizeAopPanels(Array.isArray(parsed) ? parsed : parsed?.panels);
      return panels.length ? panels : null;
    } catch {
      return null;
    }
  }
  try {
    if (s.startsWith("http")) {
      const res = await fetch(s);
      if (!res.ok) return null;
      const parsed = await res.json();
      const panels = normalizeAopPanels(Array.isArray(parsed) ? parsed : parsed?.panels);
      return panels.length ? panels : null;
    }
    const buf = await downloadFlatCalibrationFile(s);
    if (!buf) return null;
    const parsed = JSON.parse(buf.toString("utf8"));
    const panels = normalizeAopPanels(Array.isArray(parsed) ? parsed : parsed?.panels);
    return panels.length ? panels : null;
  } catch {
    return null;
  }
}

export async function attachAopPanelSnapshotToLineAttributes(
  attributes?: Array<{ key: string; value: string }>,
): Promise<Array<{ key: string; value: string }>> {
  const attrs = [...(attributes || [])];
  if (attrs.some((a) => a.key === LINE_AOP_PANELS_KEY && String(a.value || "").trim())) {
    return attrs;
  }
  const jobRaw = attrs.find((a) => a.key === "_appai_job_id")?.value || "";
  const jobId = jobIdFromLineValue(jobRaw);
  if (!jobId) return attrs;
  try {
    const job = await storage.getGenerationJob(jobId);
    const designState =
      job?.designState && typeof job.designState === "object"
        ? (job.designState as Record<string, unknown>)
        : typeof job?.designState === "string"
          ? (JSON.parse(job.designState || "{}") as Record<string, unknown>)
          : {};
    const panels = normalizeAopPanels(designState?.aopPrintPanelUrls);
    if (panels.length === 0) return attrs;
    const snap = await persistAopLinePanelSnapshot(jobId, panels);
    if (snap) attrs.push({ key: LINE_AOP_PANELS_KEY, value: snap });
  } catch (e: any) {
    console.warn("[aop-line-snapshot] attach failed:", e?.message || e);
  }
  return attrs;
}
