/**
 * Daily Printify stock scan across the active catalogue (Resend email +
 * per-product-type DB status). Mirrors the founder-generation-alerts.ts
 * pattern (single Resend digest, audit table for cadence/dedupe).
 *
 * Provider-scoped: each product type's stored `printifyProviderId` is queried
 * separately (JAMS Designs vs T Shirt and Sons are never merged). Uses the
 * same `show-out-of-stock=1` catalog endpoint as the Resync Prices cost
 * waterfall (server/routes.ts `fetchPrintifyCostsWaterfall`).
 */
import { storage } from "./storage";
import {
  buildActivePrintifyVariantLabels,
} from "@shared/printifyVariantLabels";
import {
  summarizeVariantAvailability,
  type VariantAvailabilityStatus,
} from "@shared/printifyAvailability";
import type { Merchant, ProductType } from "@shared/schema";

const TAG = "[oos-catalogue-report]";

// Guards against the in-process daily interval and an external cron trigger
// (or a redeploy restarting the interval) double-running — and double-emailing —
// on the same calendar day.
const SCAN_GUARD_MS = 20 * 60 * 60 * 1000;
// Printify's catalog endpoint is public-token rate limited; stay well under it
// across a catalogue with many distinct blueprint/provider pairs.
const CATALOG_FETCH_DELAY_MS = 350;

function criticalOosRatio(): number | undefined {
  const raw = process.env.OOS_CRITICAL_RATIO;
  if (!raw) return undefined;
  const parsed = parseFloat(raw);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 1 ? parsed : undefined;
}

export type OosScanRowStatus = VariantAvailabilityStatus | "error";

export type OosScanRowResult = {
  productTypeId: number;
  productTypeName: string;
  merchantId: string | null;
  status: OosScanRowStatus;
  availableSelected: number;
  totalSelected: number;
  unavailableLabels: string[];
  providerId?: number | null;
  providerName?: string | null;
  error?: string;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function providerLabel(result: OosScanRowResult): string {
  if (result.providerName) return result.providerName;
  if (result.providerId != null) return `Provider #${result.providerId}`;
  return "unknown provider";
}

/** Cache blueprint → providerId → title for the duration of one catalogue scan. */
const providerNameCache = new Map<string, string | null>();

async function resolveProviderName(
  blueprintId: number,
  providerId: number,
  apiToken: string,
): Promise<string | null> {
  const cacheKey = `${blueprintId}:${providerId}`;
  if (providerNameCache.has(cacheKey)) return providerNameCache.get(cacheKey) ?? null;

  try {
    const resp = await fetch(
      `https://api.printify.com/v1/catalog/blueprints/${blueprintId}/print_providers.json`,
      { headers: { Authorization: `Bearer ${apiToken}` } },
    );
    if (!resp.ok) {
      providerNameCache.set(cacheKey, null);
      return null;
    }
    const providers = await resp.json();
    const list = Array.isArray(providers) ? providers : [];
    for (const p of list) {
      const id = Number(p?.id);
      const title = typeof p?.title === "string" ? p.title.trim() : "";
      if (Number.isFinite(id) && title) {
        providerNameCache.set(`${blueprintId}:${id}`, title);
      }
    }
    if (!providerNameCache.has(cacheKey)) providerNameCache.set(cacheKey, null);
    return providerNameCache.get(cacheKey) ?? null;
  } catch {
    providerNameCache.set(cacheKey, null);
    return null;
  }
}

async function fetchCatalogVariants(
  blueprintId: number,
  providerId: number,
  apiToken: string,
): Promise<{ ok: true; variants: unknown[] } | { ok: false; error: string }> {
  try {
    const resp = await fetch(
      `https://api.printify.com/v1/catalog/blueprints/${blueprintId}/print_providers/${providerId}/variants.json?show-out-of-stock=1`,
      { headers: { Authorization: `Bearer ${apiToken}` } },
    );
    if (!resp.ok) {
      return { ok: false, error: `Printify catalog API ${resp.status}` };
    }
    const data = await resp.json();
    const variants = Array.isArray(data?.variants) ? data.variants : Array.isArray(data) ? data : [];
    return { ok: true, variants };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? String(err) };
  }
}

/**
 * Scan one product type's stock and persist the result on the row.
 * Used by both the full daily catalogue scan and the admin "Scan stock now"
 * single-product trigger.
 */
export async function scanProductTypeStock(
  pt: ProductType,
  apiToken: string,
): Promise<OosScanRowResult> {
  const providerId = pt.printifyProviderId ?? null;
  let providerName: string | null = null;
  if (pt.printifyBlueprintId && providerId != null) {
    providerName = await resolveProviderName(pt.printifyBlueprintId, providerId, apiToken);
  }

  const base = {
    productTypeId: pt.id,
    productTypeName: pt.name,
    merchantId: pt.merchantId ?? null,
    providerId,
    providerName,
  };

  let result: OosScanRowResult;

  if (!pt.printifyBlueprintId || !providerId) {
    result = {
      ...base,
      status: "error",
      availableSelected: 0,
      totalSelected: 0,
      unavailableLabels: [],
      error: "Missing Printify blueprint/provider",
    };
  } else {
    const labels = buildActivePrintifyVariantLabels(pt);
    const selectedIds = Object.keys(labels)
      .map((id) => Number(id))
      .filter((id) => Number.isFinite(id) && id > 0);

    const catalog = await fetchCatalogVariants(pt.printifyBlueprintId, providerId, apiToken);
    if (!catalog.ok) {
      result = {
        ...base,
        status: "error",
        availableSelected: 0,
        totalSelected: selectedIds.length,
        unavailableLabels: [],
        error: catalog.error,
      };
    } else {
      const summary = summarizeVariantAvailability({
        catalogVariants: catalog.variants as any[],
        selectedPrintifyVariantIds: selectedIds,
        labelsByPrintifyVariantId: labels,
        criticalRatio: criticalOosRatio(),
      });
      result = {
        ...base,
        status: summary.status,
        availableSelected: summary.availableSelected,
        totalSelected: summary.totalSelected,
        unavailableLabels: summary.unavailableLabels,
      };
    }
  }

  await storage.updateProductType(pt.id, {
    lastOosScanAt: new Date(),
    oosAvailableVariants: result.availableSelected,
    oosTotalVariants: result.totalSelected,
    oosStatus: result.status,
    oosDetail: JSON.stringify({
      unavailableLabels: result.unavailableLabels,
      error: result.error ?? null,
      providerId: result.providerId ?? null,
      providerName: result.providerName ?? null,
    }),
  } as Partial<ProductType>);

  return result;
}

/** Parse provider name from a product type's last oosDetail JSON (no Printify call). */
export function parseOosProviderName(oosDetail: unknown): string | null {
  if (!oosDetail) return null;
  try {
    const parsed = typeof oosDetail === "string" ? JSON.parse(oosDetail || "{}") : oosDetail;
    const name = (parsed as { providerName?: unknown })?.providerName;
    return typeof name === "string" && name.trim() ? name.trim() : null;
  } catch {
    return null;
  }
}

function formatDigestBody(results: OosScanRowResult[]): { subject: string; text: string } {
  const fullyOos = results.filter((r) => r.status === "fully_oos");
  const critical = results.filter((r) => r.status === "critical");
  const errored = results.filter((r) => r.status === "error");
  const ok = results.filter((r) => r.status === "ok");

  const lines: string[] = [
    `AppAI daily catalogue stock report — ${new Date().toISOString().slice(0, 10)}`,
    "",
    "Stock is checked per product's stored Printify provider (not merged across suppliers).",
    "",
  ];

  if (fullyOos.length === 0 && critical.length === 0 && errored.length === 0) {
    lines.push(`All ${ok.length} scanned product(s) have stock. No action needed.`);
  } else {
    if (fullyOos.length > 0) {
      lines.push(`FULLY OUT OF STOCK (${fullyOos.length}) — Resync Prices / customizer will likely fail for these:`);
      for (const r of fullyOos) {
        lines.push(`  - ${r.productTypeName} via ${providerLabel(r)} (product type ${r.productTypeId})`);
      }
      lines.push("");
    }
    if (critical.length > 0) {
      lines.push(`CRITICAL — mostly out of stock (${critical.length}):`);
      for (const r of critical) {
        const sample = r.unavailableLabels.slice(0, 3).join(", ");
        lines.push(
          `  - ${r.productTypeName} via ${providerLabel(r)}: ${r.availableSelected}/${r.totalSelected} variants in stock${sample ? ` (e.g. ${sample})` : ""}`,
        );
      }
      lines.push("");
    }
    if (errored.length > 0) {
      lines.push(`COULD NOT SCAN (${errored.length}) — check Printify token/blueprint:`);
      for (const r of errored) {
        lines.push(`  - ${r.productTypeName} via ${providerLabel(r)}: ${r.error ?? "unknown error"}`);
      }
      lines.push("");
    }
    lines.push(`${ok.length} other product(s) OK.`);
  }

  const subject =
    fullyOos.length > 0
      ? `[AppAI] ${fullyOos.length} product(s) fully out of stock`
      : critical.length > 0
        ? `[AppAI] ${critical.length} product(s) critically low stock`
        : `[AppAI] Daily catalogue stock report — all clear`;

  return { subject, text: lines.join("\n") };
}

async function sendOosDigestEmail(results: OosScanRowResult[]): Promise<boolean> {
  const to = (process.env.OOS_REPORT_EMAIL || process.env.FOUNDER_ALERT_EMAIL)?.trim();
  const resendKey = process.env.RESEND_API_KEY;
  if (!to || !resendKey) {
    console.warn(`${TAG} OOS_REPORT_EMAIL/FOUNDER_ALERT_EMAIL or RESEND_API_KEY not set — skipping email`);
    return false;
  }

  const { subject, text } = formatDigestBody(results);

  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "AppAI Alerts <onboarding@resend.dev>",
        to: [to],
        subject,
        text,
      }),
    });
    if (!resp.ok) {
      console.error(`${TAG} Resend error ${resp.status}:`, await resp.text());
      return false;
    }
    return true;
  } catch (err: any) {
    console.error(`${TAG} email send failed:`, err?.message ?? err);
    return false;
  }
}

/**
 * Scan every active product type with a Printify connection and email a
 * daily digest. Guarded by the most recent `oos_catalogue_scans` row so the
 * in-process interval and an external cron trigger don't double-run/email
 * within the same day. Pass `force: true` to bypass the guard (manual runs).
 */
export async function runOosCatalogueScan(
  opts: { force?: boolean } = {},
): Promise<{ ran: boolean; results?: OosScanRowResult[]; emailSent?: boolean }> {
  if (!opts.force) {
    const last = await storage.getLastOosCatalogueScan();
    if (last?.ranAt && Date.now() - last.ranAt.getTime() < SCAN_GUARD_MS) {
      const hoursAgo = Math.round((Date.now() - last.ranAt.getTime()) / (60 * 60 * 1000));
      console.log(`${TAG} Skipping — last scan ran ${hoursAgo}h ago`);
      return { ran: false };
    }
  }

  providerNameCache.clear();

  const productTypes = (await storage.getActiveProductTypes()).filter(
    (pt) => pt.printifyBlueprintId != null && pt.printifyProviderId != null && pt.merchantId != null,
  );

  const merchantCache = new Map<string, Merchant | null>();
  const results: OosScanRowResult[] = [];

  for (const pt of productTypes) {
    const merchantId = pt.merchantId as string;
    let merchant = merchantCache.get(merchantId);
    if (merchant === undefined) {
      merchant = (await storage.getMerchant(merchantId)) ?? null;
      merchantCache.set(merchantId, merchant);
    }
    const apiToken = merchant?.printifyApiToken?.trim();
    if (!apiToken) continue; // Printify not connected for this merchant — nothing to scan

    try {
      results.push(await scanProductTypeStock(pt, apiToken));
    } catch (err: any) {
      console.error(`${TAG} unexpected error scanning product type ${pt.id}:`, err);
      results.push({
        productTypeId: pt.id,
        productTypeName: pt.name,
        merchantId,
        status: "error",
        availableSelected: 0,
        totalSelected: 0,
        unavailableLabels: [],
        providerId: pt.printifyProviderId ?? null,
        providerName: null,
        error: err?.message ?? String(err),
      });
    }

    await sleep(CATALOG_FETCH_DELAY_MS);
  }

  const emailSent = results.length > 0 ? await sendOosDigestEmail(results) : false;

  await storage.insertOosCatalogueScan({
    productsScanned: results.length,
    fullyOosCount: results.filter((r) => r.status === "fully_oos").length,
    criticalCount: results.filter((r) => r.status === "critical").length,
    errorCount: results.filter((r) => r.status === "error").length,
    emailSent,
  });

  console.log(
    `${TAG} Scan complete — ${results.length} product(s), fully_oos=${results.filter((r) => r.status === "fully_oos").length}, critical=${results.filter((r) => r.status === "critical").length}, errors=${results.filter((r) => r.status === "error").length}, emailSent=${emailSent}`,
  );

  return { ran: true, results, emailSent };
}
