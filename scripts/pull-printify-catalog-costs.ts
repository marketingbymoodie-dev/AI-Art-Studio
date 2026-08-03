/**
 * Pull Free-plan Printify production COGS (front-only vs front+back) + shipping
 * tiers for every published platform-catalog blueprint.
 *
 *   npx tsx scripts/pull-printify-catalog-costs.ts
 *
 * Requires in `.env`:
 *   PRINTIFY_API_TOKEN  (platform token — same as Railway activate-product)
 *   PRINTIFY_SHOP_ID    (optional; auto-detected from /v1/shops.json if missing)
 *   DATABASE_URL        (to list platform_catalog_blueprints)
 *
 * Writes gitignored output to tmp/printify-cost-matrix.json (+ .csv summary).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "../server/load-env";
import {
  extractCostsFromCatalogVariants,
  extractCostsFromPrintifyProduct,
} from "../shared/printifyProductionCosts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_JSON = path.join(ROOT, "tmp", "printify-cost-matrix.json");
const OUT_CSV = path.join(ROOT, "tmp", "printify-cost-matrix.csv");
const API = "https://api.printify.com/v1";
const API_V2 = "https://api.printify.com/v2";
const SLEEP_MS = 350;

type CatalogRow = {
  printifyBlueprintId: number;
  label: string;
  brand: string | null;
  category: string | null;
  kind: string;
  status: string;
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function printify<T = any>(
  token: string,
  url: string,
  init?: RequestInit,
): Promise<{ ok: boolean; status: number; data: T | null; text: string }> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "AppAI-cost-pull/1.0",
      ...(init?.headers || {}),
    },
  });
  const text = await res.text();
  let data: T | null = null;
  try {
    data = text ? (JSON.parse(text) as T) : null;
  } catch {
    data = null;
  }
  return { ok: res.ok, status: res.status, data, text };
}

async function resolveShopId(token: string): Promise<string> {
  const fromEnv = process.env.PRINTIFY_SHOP_ID?.trim();
  if (fromEnv) return fromEnv;
  const { ok, data } = await printify<{ data?: Array<{ id: number | string }> }>(
    token,
    `${API}/shops.json`,
  );
  if (!ok || !data) throw new Error("Failed to list Printify shops — set PRINTIFY_SHOP_ID");
  const shops = Array.isArray((data as any).data)
    ? (data as any).data
    : Array.isArray(data)
      ? data
      : [];
  if (!shops.length) throw new Error("No Printify shops on this token — set PRINTIFY_SHOP_ID");
  return String(shops[0].id);
}

async function ensureProbeImageId(token: string): Promise<string | null> {
  const list = await printify<any>(token, `${API}/uploads.json?limit=1`);
  const uploads = list.data?.data || list.data || [];
  if (Array.isArray(uploads) && uploads[0]?.id) return String(uploads[0].id);

  // 1×1 PNG data URL via Printify URL upload of a tiny public pixel
  const up = await printify<any>(token, `${API}/uploads/images.json`, {
    method: "POST",
    body: JSON.stringify({
      file_name: "cost_probe.png",
      url: "https://cdn.printify.com/assets/logo.png",
    }),
  });
  return up.data?.id ? String(up.data.id) : null;
}

async function tryTempProductCosts(
  token: string,
  shopId: string,
  blueprintId: number,
  providerId: number,
  variantIds: number[],
  positions: string[],
  imageId: string | null,
): Promise<Record<string, number>> {
  const placeholders = positions.map((position) => ({
    position,
    images: imageId ? [{ id: imageId, x: 0.5, y: 0.5, scale: 1, angle: 0 }] : [],
  }));
  const body = {
    title: `_cost_matrix_${Date.now()}`,
    description: "Temp cost probe — delete immediately",
    blueprint_id: blueprintId,
    print_provider_id: providerId,
    variants: variantIds.map((id) => ({ id, price: 2499, is_enabled: true })),
    print_areas: [{ variant_ids: variantIds, placeholders }],
  };
  const created = await printify<any>(token, `${API}/shops/${encodeURIComponent(shopId)}/products.json`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!created.ok || !created.data?.id) {
    console.warn(
      `  temp product failed (${created.status}): ${created.text.slice(0, 160).replace(/\s+/g, " ")}`,
    );
    return {};
  }
  const productId = String(created.data.id);
  let costs = extractCostsFromPrintifyProduct(created.data);
  if (Object.keys(costs).length === 0) {
    const fetched = await printify<any>(
      token,
      `${API}/shops/${encodeURIComponent(shopId)}/products/${productId}.json`,
    );
    if (fetched.ok && fetched.data) costs = extractCostsFromPrintifyProduct(fetched.data);
  }
  await printify(token, `${API}/shops/${encodeURIComponent(shopId)}/products/${productId}.json`, {
    method: "DELETE",
  });
  return costs;
}

async function fetchShipping(
  token: string,
  blueprintId: number,
  providerId: number,
): Promise<{
  version: string;
  tiers: string[];
  countries: string[];
  /** tier → country → { firstItem, additionalItems, currency } (min across variants) */
  byTierCountry: Record<
    string,
    Record<string, { firstItem: number; additionalItems: number; currency: string }>
  >;
}> {
  const list = await printify<any>(
    token,
    `${API_V2}/catalog/blueprints/${blueprintId}/print_providers/${providerId}/shipping.json`,
  );
  if (!list.ok) {
    const v1 = await printify<any>(
      token,
      `${API}/catalog/blueprints/${blueprintId}/print_providers/${providerId}/shipping.json`,
    );
    return {
      version: "v1",
      tiers: [],
      countries: [],
      byTierCountry: {},
      ...(v1.ok ? { rawV1: v1.data } as any : {}),
    };
  }
  const tiers = (list.data?.data || []).map((m: any) => m.attributes?.name).filter(Boolean);
  const byTierCountry: Record<
    string,
    Record<string, { firstItem: number; additionalItems: number; currency: string }>
  > = {};
  const countries = new Set<string>();

  for (const tier of tiers) {
    await sleep(SLEEP_MS);
    const tierResp = await printify<any>(
      token,
      `${API_V2}/catalog/blueprints/${blueprintId}/print_providers/${providerId}/shipping/${tier}.json`,
    );
    byTierCountry[tier] = {};
    if (!tierResp.ok) continue;
    for (const entry of tierResp.data?.data || []) {
      const country = entry.attributes?.country?.code;
      const first = entry.attributes?.shippingCost?.firstItem?.amount;
      const add = entry.attributes?.shippingCost?.additionalItems?.amount;
      const currency = entry.attributes?.shippingCost?.firstItem?.currency || "USD";
      if (!country || first == null) continue;
      countries.add(country);
      const prev = byTierCountry[tier][country];
      if (!prev || first < prev.firstItem) {
        byTierCountry[tier][country] = {
          firstItem: Number(first),
          additionalItems: Number(add ?? first),
          currency,
        };
      }
    }
  }

  return {
    version: "v2",
    tiers,
    countries: [...countries].sort((a, b) => {
      if (a === "US") return -1;
      if (b === "US") return 1;
      return a.localeCompare(b);
    }),
    byTierCountry,
  };
}

function summarizeCosts(costs: Record<string, number>) {
  const values = Object.values(costs);
  if (!values.length) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const avg = Math.round(values.reduce((a, b) => a + b, 0) / values.length);
  return { minCents: min, maxCents: max, avgCents: avg, variantCount: values.length };
}

async function loadPublishedCatalog(): Promise<CatalogRow[]> {
  const { db } = await import("../server/db");
  const { platformCatalogBlueprints } = await import("../shared/schema");
  const { eq, asc } = await import("drizzle-orm");
  const rows = await db
    .select()
    .from(platformCatalogBlueprints)
    .where(eq(platformCatalogBlueprints.status, "published"))
    .orderBy(asc(platformCatalogBlueprints.label));
  return rows.map((r) => ({
    printifyBlueprintId: r.printifyBlueprintId,
    label: r.label,
    brand: r.brand,
    category: r.category,
    kind: r.kind,
    status: r.status,
  }));
}

/** Prefer a US-located provider, else first. */
async function pickProvider(
  token: string,
  blueprintId: number,
): Promise<{ id: number; title: string } | null> {
  const resp = await printify<any>(
    token,
    `${API}/catalog/blueprints/${blueprintId}/print_providers.json`,
  );
  if (!resp.ok) return null;
  const providers: any[] = resp.data || [];
  if (!Array.isArray(providers) || !providers.length) return null;
  const us = providers.find(
    (p) =>
      String(p.location?.country || "").toUpperCase() === "US" ||
      /printify choice/i.test(String(p.title || "")),
  );
  const pick = us || providers[0];
  return { id: Number(pick.id), title: String(pick.title || pick.id) };
}

async function main() {
  const token = process.env.PRINTIFY_API_TOKEN?.trim();
  if (!token) {
    console.error("PRINTIFY_API_TOKEN missing in .env");
    process.exit(1);
  }
  if (!process.env.DATABASE_URL?.trim()) {
    console.error("DATABASE_URL missing in .env");
    process.exit(1);
  }

  const shopId = await resolveShopId(token);
  console.log(`Using Printify shop ${shopId}`);
  const probeImageId = await ensureProbeImageId(token);
  console.log(`Probe image id: ${probeImageId || "(none — empty placeholders)"}`);

  const catalog = await loadPublishedCatalog();
  console.log(`Published catalog entries: ${catalog.length}`);

  const results: any[] = [];

  for (let i = 0; i < catalog.length; i++) {
    const entry = catalog[i];
    const bp = entry.printifyBlueprintId;
    console.log(`\n[${i + 1}/${catalog.length}] ${entry.label} (bp ${bp}, ${entry.kind})`);

    await sleep(SLEEP_MS);
    const provider = await pickProvider(token, bp);
    if (!provider) {
      console.warn("  no print providers");
      results.push({ ...entry, error: "no_providers" });
      continue;
    }
    console.log(`  provider ${provider.id} — ${provider.title}`);

    await sleep(SLEEP_MS);
    const variantsResp = await printify<any>(
      token,
      `${API}/catalog/blueprints/${bp}/print_providers/${provider.id}/variants.json`,
    );
    const variants: any[] = Array.isArray(variantsResp.data?.variants)
      ? variantsResp.data.variants
      : Array.isArray(variantsResp.data)
        ? variantsResp.data
        : [];
    const variantIds = variants.map((v) => Number(v.id)).filter((id) => Number.isFinite(id) && id > 0);
    const sampleIds = variantIds.slice(0, 8);
    const placeholders: string[] = Array.from(
      new Set(
        (variants[0]?.placeholders || []).map((p: any) => String(p.position || "").toLowerCase()).filter(Boolean),
      ),
    );
    const hasBack = placeholders.includes("back");
    console.log(`  variants=${variantIds.length} sample=${sampleIds.length} placeholders=${placeholders.join(",") || "—"}`);

    let frontCosts = extractCostsFromCatalogVariants(variants);
    if (Object.keys(frontCosts).length === 0 && sampleIds.length) {
      await sleep(SLEEP_MS);
      frontCosts = await tryTempProductCosts(
        token,
        shopId,
        bp,
        provider.id,
        sampleIds,
        hasBack ? ["front"] : placeholders[0] ? [placeholders[0]] : ["front"],
        probeImageId,
      );
    }

    let bothCosts: Record<string, number> = {};
    if (hasBack && entry.kind !== "aop" && sampleIds.length) {
      await sleep(SLEEP_MS);
      bothCosts = await tryTempProductCosts(
        token,
        shopId,
        bp,
        provider.id,
        sampleIds,
        ["front", "back"],
        probeImageId,
      );
    }

    await sleep(SLEEP_MS);
    const shipping = await fetchShipping(token, bp, provider.id);
    const usStandard =
      shipping.byTierCountry?.standard?.US ||
      shipping.byTierCountry?.["standard"]?.US ||
      Object.values(shipping.byTierCountry || {})[0]?.US ||
      null;

    const frontSummary = summarizeCosts(frontCosts);
    const bothSummary = summarizeCosts(bothCosts);
    const backSurchargeCents =
      frontSummary && bothSummary ? bothSummary.minCents - frontSummary.minCents : null;

    console.log(
      `  front min=$${((frontSummary?.minCents ?? 0) / 100).toFixed(2)}` +
        (bothSummary
          ? ` both min=$${(bothSummary.minCents / 100).toFixed(2)} (+$${((backSurchargeCents || 0) / 100).toFixed(2)})`
          : " (no both)"),
    );
    if (usStandard) {
      console.log(
        `  US ship first=$${(usStandard.firstItem / 100).toFixed(2)} add=$${(usStandard.additionalItems / 100).toFixed(2)}`,
      );
    }

    results.push({
      blueprintId: bp,
      label: entry.label,
      brand: entry.brand,
      category: entry.category,
      kind: entry.kind,
      providerId: provider.id,
      providerTitle: provider.title,
      placeholders,
      hasBackPlaceholder: hasBack,
      front: frontSummary,
      both: bothSummary,
      backSurchargeCents,
      frontCostsSample: frontCosts,
      bothCostsSample: bothCosts,
      shipping: {
        version: shipping.version,
        tiers: shipping.tiers,
        countries: shipping.countries,
        usStandard,
        byTierCountry: shipping.byTierCountry,
      },
    });
  }

  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
  fs.writeFileSync(
    OUT_JSON,
    JSON.stringify(
      {
        pulledAt: new Date().toISOString(),
        shopId,
        note: "Free-plan COGS for the token's Printify account. Premium differs. front vs both from temp product probes.",
        products: results,
      },
      null,
      2,
    ),
  );

  const csvLines = [
    [
      "blueprintId",
      "label",
      "kind",
      "providerId",
      "hasBack",
      "frontMinUsd",
      "frontMaxUsd",
      "bothMinUsd",
      "bothMaxUsd",
      "backSurchargeUsd",
      "usShipFirstUsd",
      "usShipAddUsd",
    ].join(","),
  ];
  for (const r of results) {
    csvLines.push(
      [
        r.blueprintId,
        JSON.stringify(r.label || ""),
        r.kind,
        r.providerId ?? "",
        r.hasBackPlaceholder ? "yes" : "no",
        r.front ? (r.front.minCents / 100).toFixed(2) : "",
        r.front ? (r.front.maxCents / 100).toFixed(2) : "",
        r.both ? (r.both.minCents / 100).toFixed(2) : "",
        r.both ? (r.both.maxCents / 100).toFixed(2) : "",
        r.backSurchargeCents != null ? (r.backSurchargeCents / 100).toFixed(2) : "",
        r.shipping?.usStandard ? (r.shipping.usStandard.firstItem / 100).toFixed(2) : "",
        r.shipping?.usStandard ? (r.shipping.usStandard.additionalItems / 100).toFixed(2) : "",
      ].join(","),
    );
  }
  fs.writeFileSync(OUT_CSV, csvLines.join("\n") + "\n");

  console.log(`\nWrote ${OUT_JSON}`);
  console.log(`Wrote ${OUT_CSV}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
