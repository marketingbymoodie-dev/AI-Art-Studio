/**
 * Shipping Coverage Service — Phase 1 foundation.
 * Spec: docs/Shipping-rates-plan/shipping-rates-and-geo-gating-spec.md (Part 0).
 *
 * Ingests Printify v2 shipping tables (standard tier only) per
 * (blueprint_id, print_provider_id) pair, normalises them into
 * shipping_classes / shipping_rates / variant_shipping, evaluates operator
 * exclusion tiers (normal | warned | excluded), and materialises the
 * shipping_coverage matrix used by geo-gating consumers.
 *
 * All money is USD cents (Printify ceiling table). FX to shop currency is a
 * Phase 3 concern (pinned buffered rate at profile-generation time).
 */
import crypto from "crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "./db";
import {
  catalogVariantCosts,
  platformConfig,
  productTypes,
  shippingClasses,
  shippingCoverage,
  shippingRateAudit,
  shippingRates,
  shippingSyncRuns,
  shippingTableSnapshots,
  shippingZoneRules,
  variantShipping,
  type ShippingClass,
  type ShippingZoneRule,
} from "@shared/schema";

// ── Config ────────────────────────────────────────────────────────────────────

export const SHIPPING_CONFIG_KEYS = {
  /** ratio = firstItem/typicalRetail; ≤ offer → normal (basis points). */
  offerThresholdBp: "SHIPPING_OFFER_THRESHOLD_BP",
  /** offer < ratio ≤ exclude → warned; above → excluded (basis points). */
  excludeThresholdBp: "SHIPPING_EXCLUDE_THRESHOLD_BP",
  /** firstItem above this is always excluded (USD cents). */
  absoluteCapCents: "SHIPPING_ABSOLUTE_CAP_CENTS",
  /** Retail fallback = median group COGS × this multiplier (basis points; 30000 = 3.0×). */
  retailMarkupBp: "SHIPPING_RETAIL_FALLBACK_MARKUP_BP",
  /** ISO timestamp of the last completed sync (nightly/boot dedupe guard). */
  lastSyncAt: "SHIPPING_TABLES_LAST_SYNC_AT",
} as const;

export type ShippingTierConfig = {
  offerThresholdBp: number;
  excludeThresholdBp: number;
  absoluteCapCents: number;
  retailMarkupBp: number;
};

export const DEFAULT_TIER_CONFIG: ShippingTierConfig = {
  offerThresholdBp: 4000,
  excludeThresholdBp: 8000,
  absoluteCapCents: 15000,
  retailMarkupBp: 30000,
};

async function readConfigValue(key: string): Promise<string | null> {
  const [row] = await db
    .select({ value: platformConfig.value })
    .from(platformConfig)
    .where(eq(platformConfig.key, key))
    .limit(1);
  return row?.value ?? null;
}

async function writeConfigValue(key: string, value: string): Promise<void> {
  await db
    .insert(platformConfig)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: platformConfig.key,
      set: { value, updatedAt: new Date() },
    });
}

export async function getShippingTierConfig(): Promise<ShippingTierConfig> {
  const out = { ...DEFAULT_TIER_CONFIG };
  const entries: Array<[keyof ShippingTierConfig, string]> = [
    ["offerThresholdBp", SHIPPING_CONFIG_KEYS.offerThresholdBp],
    ["excludeThresholdBp", SHIPPING_CONFIG_KEYS.excludeThresholdBp],
    ["absoluteCapCents", SHIPPING_CONFIG_KEYS.absoluteCapCents],
    ["retailMarkupBp", SHIPPING_CONFIG_KEYS.retailMarkupBp],
  ];
  for (const [field, key] of entries) {
    const raw = await readConfigValue(key);
    const n = raw == null ? NaN : parseInt(raw, 10);
    if (Number.isFinite(n) && n > 0) out[field] = n;
  }
  return out;
}

export async function setShippingTierConfig(
  patch: Partial<ShippingTierConfig>,
): Promise<ShippingTierConfig> {
  const mapping: Array<[keyof ShippingTierConfig, string]> = [
    ["offerThresholdBp", SHIPPING_CONFIG_KEYS.offerThresholdBp],
    ["excludeThresholdBp", SHIPPING_CONFIG_KEYS.excludeThresholdBp],
    ["absoluteCapCents", SHIPPING_CONFIG_KEYS.absoluteCapCents],
    ["retailMarkupBp", SHIPPING_CONFIG_KEYS.retailMarkupBp],
  ];
  for (const [field, key] of mapping) {
    const v = patch[field];
    if (v != null && Number.isFinite(v) && v > 0) {
      await writeConfigValue(key, String(Math.round(v)));
    }
  }
  return getShippingTierConfig();
}

// ── Printify fetch + normalisation ───────────────────────────────────────────

export type NormalizedCell = { first: number; additional: number };
/** variantId -> countryCode ("US" | … | "REST_OF_THE_WORLD") -> cell. */
export type NormalizedTable = {
  method: string;
  byVariant: Record<string, Record<string, NormalizedCell>>;
};

const PRINTIFY_BASE = "https://api.printify.com";

function printifyToken(): string {
  return String(process.env.PRINTIFY_API_TOKEN || "").trim();
}

function printifyHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${printifyToken()}`,
    "Content-Type": "application/json",
  };
}

/** Prefer the true standard tier; fall back to ground, then economy, then first. */
export function pickStandardMethod(methods: string[]): string | null {
  if (methods.length === 0) return null;
  const exact = methods.find((m) => /^standard$/i.test(m));
  if (exact) return exact;
  const standardish = methods.find((m) => /standard|ground/i.test(m));
  if (standardish) return standardish;
  const economy = methods.find((m) => /econom/i.test(m));
  if (economy) return economy;
  return methods[0];
}

/** Normalise Printify country codes; ROW is stored as "ROW". */
function normalizeCountry(raw: unknown): string | null {
  const code = String(raw || "").trim().toUpperCase();
  if (!code) return null;
  if (code === "REST_OF_THE_WORLD" || code === "ROW") return "ROW";
  return code;
}

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url, { headers: printifyHeaders() });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Printify ${res.status} for ${url}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

/**
 * Fetch the standard-tier shipping table for a (blueprint, provider) pair.
 * Follows pagination links if the v2 API returns them.
 */
export async function fetchStandardShippingTable(
  blueprintId: number,
  providerId: number,
): Promise<NormalizedTable> {
  if (!printifyToken()) throw new Error("PRINTIFY_API_TOKEN is not set");
  const base = `${PRINTIFY_BASE}/v2/catalog/blueprints/${blueprintId}/print_providers/${providerId}/shipping`;
  const listData = await fetchJson(`${base}.json`);
  const methods = ((listData?.data || []) as Array<{ attributes?: { name?: string } }>)
    .map((m) => m.attributes?.name)
    .filter(Boolean) as string[];
  const method = pickStandardMethod(methods);
  if (!method) {
    throw new Error(`No shipping methods published for bp ${blueprintId} / provider ${providerId}`);
  }

  const byVariant: Record<string, Record<string, NormalizedCell>> = {};
  let url: string | null = `${base}/${encodeURIComponent(method)}.json`;
  let pageGuard = 0;
  while (url && pageGuard < 50) {
    pageGuard++;
    const tierData: any = await fetchJson(url);
    for (const entry of tierData?.data || []) {
      const variantId = entry?.attributes?.variantId;
      const country = normalizeCountry(entry?.attributes?.country?.code);
      const first = Number(entry?.attributes?.shippingCost?.firstItem?.amount);
      const extra = Number(entry?.attributes?.shippingCost?.additionalItems?.amount);
      if (variantId == null || !country || !Number.isFinite(first)) continue;
      const vid = String(variantId);
      if (!byVariant[vid]) byVariant[vid] = {};
      byVariant[vid][country] = {
        first: Math.round(first),
        additional: Number.isFinite(extra) ? Math.round(extra) : Math.round(first),
      };
    }
    const next = tierData?.links?.next;
    url = typeof next === "string" && next ? (next.startsWith("http") ? next : `${PRINTIFY_BASE}${next}`) : null;
  }

  return { method, byVariant };
}

/** Deterministic JSON (sorted keys) so hashes are stable across fetches. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`)
    .join(",")}}`;
}

export function computeTableHash(table: NormalizedTable): string {
  return crypto.createHash("sha256").update(stableStringify(table)).digest("hex");
}

// ── Cross-zone variant grouping (spec 1.3 grouping key) ──────────────────────

export type VariantGroupDef = {
  group: string;
  label: string;
  printifyVariantIds: string[];
};

/**
 * Two variants share a group iff their (first, additional) pair is identical
 * in EVERY zone of the table. Groups are ordered by US first-item ascending
 * (falling back to cheapest zone) and named g1..gN.
 */
export function deriveVariantGroups(
  table: NormalizedTable,
): { groups: VariantGroupDef[]; groupByVariant: Record<string, string> } {
  const vectorKeyByVariant: Record<string, string> = {};
  const variantsByVector = new Map<string, string[]>();

  for (const [vid, countries] of Object.entries(table.byVariant)) {
    const vector = Object.keys(countries)
      .sort()
      .map((c) => `${c}=${countries[c].first}/${countries[c].additional}`)
      .join("|");
    vectorKeyByVariant[vid] = vector;
    const list = variantsByVector.get(vector) || [];
    list.push(vid);
    variantsByVector.set(vector, list);
  }

  const sortPrice = (vids: string[]): number => {
    const sample = table.byVariant[vids[0]] || {};
    if (sample.US) return sample.US.first;
    const firsts = Object.values(sample).map((c) => c.first);
    return firsts.length ? Math.min(...firsts) : Number.MAX_SAFE_INTEGER;
  };

  const ordered = Array.from(variantsByVector.entries()).sort((a, b) => {
    const pa = sortPrice(a[1]);
    const pb = sortPrice(b[1]);
    if (pa !== pb) return pa - pb;
    return a[0] < b[0] ? -1 : 1;
  });

  const groups: VariantGroupDef[] = [];
  const groupByVariant: Record<string, string> = {};
  ordered.forEach(([, vids], i) => {
    const group = `g${i + 1}`;
    vids.sort((a, b) => Number(a) - Number(b));
    groups.push({ group, label: "", printifyVariantIds: vids });
    for (const vid of vids) groupByVariant[vid] = group;
  });
  return { groups, groupByVariant };
}

/** Human labels from catalog_variant_costs size/variant names (best-effort). */
async function labelGroups(
  blueprintId: number,
  providerId: number,
  groups: VariantGroupDef[],
): Promise<void> {
  const allIds = groups.flatMap((g) => g.printifyVariantIds);
  if (allIds.length === 0) return;
  const rows = await db
    .select({
      supplierVariantId: catalogVariantCosts.supplierVariantId,
      size: catalogVariantCosts.size,
      variantName: catalogVariantCosts.variantName,
    })
    .from(catalogVariantCosts)
    .where(
      and(
        eq(catalogVariantCosts.blueprintId, blueprintId),
        eq(catalogVariantCosts.providerId, providerId),
        inArray(catalogVariantCosts.supplierVariantId, allIds),
      ),
    );
  const nameByVid = new Map<string, string>();
  for (const r of rows) {
    const label = (r.size || r.variantName || "").trim();
    if (label) nameByVid.set(String(r.supplierVariantId), label);
  }
  // No catalogue rows for this pair (class added ahead of import) — pull
  // variant titles from the Printify catalog so groups stay readable.
  if (nameByVid.size === 0) {
    try {
      const data = await fetchJson(
        `${PRINTIFY_BASE}/v1/catalog/blueprints/${blueprintId}/print_providers/${providerId}/variants.json`,
      );
      for (const v of data?.variants || []) {
        const id = v?.id != null ? String(v.id) : "";
        const title = String(v?.title || "").trim();
        if (!id || !title) continue;
        // Titles look like `11" x 14" / Black` — the size segment is the group-relevant part.
        nameByVid.set(id, title.split(" / ")[0].trim() || title);
      }
    } catch {
      /* labels stay as variant counts */
    }
  }
  for (const g of groups) {
    const names = Array.from(
      new Set(g.printifyVariantIds.map((v) => nameByVid.get(v)).filter(Boolean) as string[]),
    );
    g.label = names.length
      ? names.slice(0, 6).join(", ") + (names.length > 6 ? ", …" : "")
      : `${g.printifyVariantIds.length} variant(s)`;
  }
}

// ── Exclusion tier engine (spec 0.4) ─────────────────────────────────────────

export type TierVerdict = {
  tier: "normal" | "warned" | "excluded";
  shippable: boolean;
  ratioBp: number | null;
  typicalRetailCents: number | null;
  tierReason: string;
};

export function evaluateTier(params: {
  firstItemCents: number;
  typicalRetailCents: number | null;
  config: ShippingTierConfig;
  absoluteCapCents: number;
  manualRule: "block" | "allow" | null;
}): TierVerdict {
  const { firstItemCents, typicalRetailCents, config, absoluteCapCents, manualRule } = params;

  if (manualRule === "block") {
    return {
      tier: "excluded",
      shippable: false,
      ratioBp: null,
      typicalRetailCents,
      tierReason: "manual_block",
    };
  }
  if (manualRule === "allow") {
    return {
      tier: "normal",
      shippable: true,
      ratioBp: null,
      typicalRetailCents,
      tierReason: "manual_allow",
    };
  }
  if (firstItemCents > absoluteCapCents) {
    return {
      tier: "excluded",
      shippable: false,
      ratioBp:
        typicalRetailCents && typicalRetailCents > 0
          ? Math.round((firstItemCents / typicalRetailCents) * 10000)
          : null,
      typicalRetailCents,
      tierReason: "absolute_cap",
    };
  }
  if (!typicalRetailCents || typicalRetailCents <= 0) {
    return {
      tier: "normal",
      shippable: true,
      ratioBp: null,
      typicalRetailCents: null,
      tierReason: "no_retail",
    };
  }
  const ratioBp = Math.round((firstItemCents / typicalRetailCents) * 10000);
  if (ratioBp > config.excludeThresholdBp) {
    return { tier: "excluded", shippable: false, ratioBp, typicalRetailCents, tierReason: "threshold" };
  }
  if (ratioBp > config.offerThresholdBp) {
    return { tier: "warned", shippable: true, ratioBp, typicalRetailCents, tierReason: "threshold" };
  }
  return { tier: "normal", shippable: true, ratioBp, typicalRetailCents, tierReason: "threshold" };
}

function median(values: number[]): number | null {
  const v = values.filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 === 1 ? v[mid] : Math.round((v[mid - 1] + v[mid]) / 2);
}

/**
 * typicalRetailCents per variant group:
 *   1. Manual per-class override.
 *   2. Median catalog COGS of the group's variants × retail-fallback markup.
 *   3. null → only the absolute cap applies.
 */
async function resolveGroupRetailCents(params: {
  cls: Pick<ShippingClass, "blueprintId" | "providerId" | "typicalRetailCentsOverride">;
  groups: VariantGroupDef[];
  config: ShippingTierConfig;
}): Promise<Record<string, number | null>> {
  const { cls, groups, config } = params;
  const out: Record<string, number | null> = {};
  if (cls.typicalRetailCentsOverride && cls.typicalRetailCentsOverride > 0) {
    for (const g of groups) out[g.group] = cls.typicalRetailCentsOverride;
    return out;
  }
  const allIds = groups.flatMap((g) => g.printifyVariantIds);
  const rows = allIds.length
    ? await db
        .select({
          supplierVariantId: catalogVariantCosts.supplierVariantId,
          baseCogsCents: catalogVariantCosts.baseCogsCents,
        })
        .from(catalogVariantCosts)
        .where(
          and(
            eq(catalogVariantCosts.blueprintId, cls.blueprintId),
            eq(catalogVariantCosts.providerId, cls.providerId),
            inArray(catalogVariantCosts.supplierVariantId, allIds),
            eq(catalogVariantCosts.printAreaKey, "front"),
          ),
        )
    : [];
  const cogsByVid = new Map<string, number>();
  for (const r of rows) {
    if (r.baseCogsCents && r.baseCogsCents > 0) {
      cogsByVid.set(String(r.supplierVariantId), r.baseCogsCents);
    }
  }
  for (const g of groups) {
    const cogs = median(
      g.printifyVariantIds.map((v) => cogsByVid.get(v) ?? NaN).filter((n) => Number.isFinite(n)),
    );
    out[g.group] = cogs ? Math.round((cogs * config.retailMarkupBp) / 10000) : null;
  }
  return out;
}

async function loadZoneRules(classId: number): Promise<Map<string, "block" | "allow">> {
  const rows = await db
    .select()
    .from(shippingZoneRules)
    .where(inArray(shippingZoneRules.shippingClassId, [0, classId]));
  const map = new Map<string, "block" | "allow">();
  // Global rules first so class-specific rules override them.
  const ordered = rows.sort((a: ShippingZoneRule, b: ShippingZoneRule) =>
    a.shippingClassId === b.shippingClassId ? 0 : a.shippingClassId === 0 ? -1 : 1,
  );
  for (const r of ordered) {
    if (r.action === "block" || r.action === "allow") {
      map.set(r.countryCode.toUpperCase(), r.action);
    }
  }
  return map;
}

// ── Ingestion ─────────────────────────────────────────────────────────────────

export type IngestResult = {
  status: "created" | "updated" | "unchanged" | "failed";
  classId?: number;
  blueprintId: number;
  providerId: number;
  error?: string;
};

async function resolveClassName(blueprintId: number, providerId: number): Promise<string> {
  const [cvc] = await db
    .select({ productName: catalogVariantCosts.productName })
    .from(catalogVariantCosts)
    .where(
      and(
        eq(catalogVariantCosts.blueprintId, blueprintId),
        eq(catalogVariantCosts.providerId, providerId),
      ),
    )
    .limit(1);
  if (cvc?.productName) return `${cvc.productName} — provider ${providerId}`;
  const [pt] = await db
    .select({ name: productTypes.name })
    .from(productTypes)
    .where(
      and(
        eq(productTypes.printifyBlueprintId, blueprintId),
        eq(productTypes.printifyProviderId, providerId),
      ),
    )
    .limit(1);
  if (pt?.name) return `${pt.name} — provider ${providerId}`;
  return `Blueprint ${blueprintId} — provider ${providerId}`;
}

/** Rebuild variant_shipping rows for every product type using this class. */
async function rebuildVariantShipping(
  classId: number,
  blueprintId: number,
  providerId: number,
  groupByVariant: Record<string, string>,
): Promise<number[]> {
  const products = await db
    .select({
      id: productTypes.id,
      variantMap: productTypes.variantMap,
      shopifyVariantIds: productTypes.shopifyVariantIds,
    })
    .from(productTypes)
    .where(
      and(
        eq(productTypes.printifyBlueprintId, blueprintId),
        eq(productTypes.printifyProviderId, providerId),
      ),
    );

  await db.delete(variantShipping).where(eq(variantShipping.shippingClassId, classId));

  const productIds: number[] = [];
  const inserts: (typeof variantShipping.$inferInsert)[] = [];
  for (const p of products) {
    let map: Record<string, { printifyVariantId?: number | string }> = {};
    try {
      map = JSON.parse(p.variantMap || "{}");
    } catch {
      continue;
    }
    let shopifyIds: Record<string, unknown> = {};
    if (p.shopifyVariantIds && typeof p.shopifyVariantIds === "object") {
      shopifyIds = p.shopifyVariantIds as Record<string, unknown>;
    }
    let matched = 0;
    for (const [key, entry] of Object.entries(map)) {
      const pvid = entry?.printifyVariantId != null ? String(entry.printifyVariantId) : "";
      if (!pvid) continue;
      const group = groupByVariant[pvid];
      if (!group) continue; // variant not present in the shipping table
      matched++;
      inserts.push({
        shippingClassId: classId,
        productTypeId: p.id,
        sizeColorKey: key,
        printifyVariantId: pvid,
        shopifyVariantId: shopifyIds[key] != null ? String(shopifyIds[key]) : null,
        variantGroup: group,
        updatedAt: new Date(),
      });
    }
    if (matched > 0) productIds.push(p.id);
  }
  // Dedupe on (productTypeId, printifyVariantId) — multiple sizeColor keys can
  // map to the same Printify variant on odd imports; keep the first.
  const seen = new Set<string>();
  const deduped = inserts.filter((row) => {
    const k = `${row.productTypeId}:${row.printifyVariantId}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (deduped.length) await db.insert(variantShipping).values(deduped);
  return productIds;
}

/** Recompute tier verdicts + rewrite shipping_rates for a class from a table. */
async function rebuildRatesForClass(params: {
  cls: ShippingClass;
  table: NormalizedTable;
  groups: VariantGroupDef[];
  syncRunId?: number;
}): Promise<{ changed: boolean }> {
  const { cls, table, groups, syncRunId } = params;
  const config = await getShippingTierConfig();
  const rules = await loadZoneRules(cls.id);
  const retailByGroup = await resolveGroupRetailCents({ cls, groups, config });
  const capCents =
    cls.absoluteCapCentsOverride && cls.absoluteCapCentsOverride > 0
      ? cls.absoluteCapCentsOverride
      : config.absoluteCapCents;

  // Desired rate rows: (country, group) → representative cell. Every variant in
  // a group has identical vectors by construction, so take the first variant.
  const desired = new Map<
    string,
    { countryCode: string; variantGroup: string; first: number; additional: number }
  >();
  for (const g of groups) {
    const sampleVid = g.printifyVariantIds.find((v) => table.byVariant[v]);
    if (!sampleVid) continue;
    for (const [country, cell] of Object.entries(table.byVariant[sampleVid])) {
      desired.set(`${country}::${g.group}`, {
        countryCode: country,
        variantGroup: g.group,
        first: cell.first,
        additional: cell.additional,
      });
    }
  }

  const existing = await db
    .select()
    .from(shippingRates)
    .where(eq(shippingRates.shippingClassId, cls.id));
  const existingByKey = new Map(existing.map((r) => [`${r.countryCode}::${r.variantGroup}`, r]));

  const audits: (typeof shippingRateAudit.$inferInsert)[] = [];
  let changed = false;

  // Zone/rate removals
  for (const [key, old] of Array.from(existingByKey.entries())) {
    if (!desired.has(key)) {
      changed = true;
      audits.push({
        shippingClassId: cls.id,
        syncRunId: syncRunId ?? null,
        countryCode: old.countryCode,
        variantGroup: old.variantGroup,
        changeType: "zone_removed",
        oldValue: `${old.firstItemCents}/${old.additionalCents}`,
        newValue: null,
      });
    }
  }

  const inserts: (typeof shippingRates.$inferInsert)[] = [];
  for (const [key, want] of Array.from(desired.entries())) {
    const verdict = evaluateTier({
      firstItemCents: want.first,
      typicalRetailCents: retailByGroup[want.variantGroup] ?? null,
      config,
      absoluteCapCents: capCents,
      manualRule: rules.get(want.countryCode.toUpperCase()) ?? null,
    });
    const old = existingByKey.get(key);
    if (!old) {
      changed = true;
      audits.push({
        shippingClassId: cls.id,
        syncRunId: syncRunId ?? null,
        countryCode: want.countryCode,
        variantGroup: want.variantGroup,
        changeType: "zone_added",
        oldValue: null,
        newValue: `${want.first}/${want.additional} tier=${verdict.tier}`,
      });
    } else {
      if (old.firstItemCents !== want.first || old.additionalCents !== want.additional) {
        changed = true;
        audits.push({
          shippingClassId: cls.id,
          syncRunId: syncRunId ?? null,
          countryCode: want.countryCode,
          variantGroup: want.variantGroup,
          changeType: "rate_changed",
          oldValue: `${old.firstItemCents}/${old.additionalCents}`,
          newValue: `${want.first}/${want.additional}`,
        });
      }
      if (old.tier !== verdict.tier) {
        changed = true;
        audits.push({
          shippingClassId: cls.id,
          syncRunId: syncRunId ?? null,
          countryCode: want.countryCode,
          variantGroup: want.variantGroup,
          changeType: "tier_changed",
          oldValue: old.tier,
          newValue: `${verdict.tier} (${verdict.tierReason})`,
        });
      }
    }
    inserts.push({
      shippingClassId: cls.id,
      countryCode: want.countryCode,
      variantGroup: want.variantGroup,
      firstItemCents: want.first,
      additionalCents: want.additional,
      currency: "USD",
      shippable: verdict.shippable,
      tier: verdict.tier,
      ratioBp: verdict.ratioBp,
      typicalRetailCents: verdict.typicalRetailCents,
      tierReason: verdict.tierReason,
      updatedAt: new Date(),
    });
  }

  await db.delete(shippingRates).where(eq(shippingRates.shippingClassId, cls.id));
  if (inserts.length) {
    for (let i = 0; i < inserts.length; i += 500) {
      await db.insert(shippingRates).values(inserts.slice(i, i + 500));
    }
  }
  if (audits.length) {
    for (let i = 0; i < audits.length; i += 500) {
      await db.insert(shippingRateAudit).values(audits.slice(i, i + 500));
    }
  }
  return { changed };
}

const TIER_SEVERITY: Record<string, number> = { normal: 0, warned: 1, excluded: 2 };

/** Materialise shipping_coverage rows for every product attached to a class. */
export async function rebuildCoverageForClass(classId: number): Promise<number> {
  const [cls] = await db.select().from(shippingClasses).where(eq(shippingClasses.id, classId));
  if (!cls) return 0;

  const rates = await db
    .select()
    .from(shippingRates)
    .where(eq(shippingRates.shippingClassId, classId));
  const variants = await db
    .select()
    .from(variantShipping)
    .where(eq(variantShipping.shippingClassId, classId));

  const groupsByProduct = new Map<number, Set<string>>();
  for (const v of variants) {
    const set = groupsByProduct.get(v.productTypeId) || new Set<string>();
    set.add(v.variantGroup);
    groupsByProduct.set(v.productTypeId, set);
  }

  type RateRow = typeof shippingRates.$inferSelect;
  const ratesByCountry = new Map<string, RateRow[]>();
  for (const r of rates) {
    const list = ratesByCountry.get(r.countryCode) || [];
    list.push(r);
    ratesByCountry.set(r.countryCode, list);
  }

  const inserts: (typeof shippingCoverage.$inferInsert)[] = [];
  for (const [productTypeId, groupSet] of Array.from(groupsByProduct.entries())) {
    for (const [countryCode, countryRates] of Array.from(ratesByCountry.entries())) {
      const relevant = countryRates.filter((r: RateRow) => groupSet.has(r.variantGroup));
      if (relevant.length === 0) continue;
      const shippableRates = relevant.filter((r: RateRow) => r.shippable);
      const shippable = shippableRates.length > 0;
      const pool = shippable ? shippableRates : relevant;
      const bestTier = pool.reduce(
        (best: string, r: RateRow) => (TIER_SEVERITY[r.tier] < TIER_SEVERITY[best] ? r.tier : best),
        pool[0].tier,
      );
      const firstItemCents = Math.min(...pool.map((r: RateRow) => r.firstItemCents));
      const additionalCents = Math.min(...pool.map((r: RateRow) => r.additionalCents));
      inserts.push({
        productTypeId,
        countryCode,
        shippable,
        tier: shippable ? bestTier : "excluded",
        firstItemCents,
        additionalCents,
        shippingClassId: classId,
        tableHash: cls.tableHash,
        updatedAt: new Date(),
      });
    }
  }

  await db.delete(shippingCoverage).where(eq(shippingCoverage.shippingClassId, classId));
  if (inserts.length) {
    for (let i = 0; i < inserts.length; i += 500) {
      await db.insert(shippingCoverage).values(inserts.slice(i, i + 500));
    }
  }
  bumpCoverageCache();
  return inserts.length;
}

/**
 * Ingest (or refresh) one shipping class. Fetches the Printify table, diffs by
 * content hash, and rebuilds rates / variant mapping / coverage on change.
 */
export async function ingestShippingClass(opts: {
  blueprintId: number;
  providerId: number;
  syncRunId?: number;
  force?: boolean;
}): Promise<IngestResult> {
  const { blueprintId, providerId, syncRunId, force } = opts;
  const base = { blueprintId, providerId };

  let existing: ShippingClass | undefined;
  const found = await db
    .select()
    .from(shippingClasses)
    .where(
      and(eq(shippingClasses.blueprintId, blueprintId), eq(shippingClasses.providerId, providerId)),
    )
    .limit(1);
  existing = found[0];

  let table: NormalizedTable;
  try {
    table = await fetchStandardShippingTable(blueprintId, providerId);
  } catch (e: any) {
    const error = e?.message || String(e);
    if (existing) {
      await db
        .update(shippingClasses)
        .set({ lastError: error, updatedAt: new Date() })
        .where(eq(shippingClasses.id, existing.id));
    }
    return { ...base, status: "failed", classId: existing?.id, error };
  }

  const tableHash = computeTableHash(table);
  if (existing && existing.tableHash === tableHash && !force) {
    await db
      .update(shippingClasses)
      .set({ lastFetchedAt: new Date(), lastError: null, updatedAt: new Date() })
      .where(eq(shippingClasses.id, existing.id));
    return { ...base, status: "unchanged", classId: existing.id };
  }

  const { groups, groupByVariant } = deriveVariantGroups(table);
  await labelGroups(blueprintId, providerId, groups);
  const name = existing?.name || (await resolveClassName(blueprintId, providerId));

  const isNew = !existing;
  const now = new Date();
  if (!existing) {
    const [created] = await db
      .insert(shippingClasses)
      .values({
        blueprintId,
        providerId,
        name,
        shippingMethod: table.method,
        tableHash,
        variantGroupsJson: JSON.stringify(groups),
        lastFetchedAt: now,
        lastChangedAt: now,
        lastError: null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    existing = created;
    await db.insert(shippingRateAudit).values({
      shippingClassId: created.id,
      syncRunId: syncRunId ?? null,
      changeType: "class_added",
      newValue: `${groups.length} group(s), method=${table.method}`,
    });
  } else {
    const oldGroups = existing.variantGroupsJson;
    const newGroups = JSON.stringify(groups);
    if (oldGroups !== newGroups) {
      await db.insert(shippingRateAudit).values({
        shippingClassId: existing.id,
        syncRunId: syncRunId ?? null,
        changeType: "grouping_changed",
        oldValue: summarizeGroups(oldGroups),
        newValue: summarizeGroups(newGroups),
      });
    }
    await db
      .update(shippingClasses)
      .set({
        shippingMethod: table.method,
        tableHash,
        variantGroupsJson: newGroups,
        lastFetchedAt: now,
        lastChangedAt: now,
        lastError: null,
        updatedAt: now,
      })
      .where(eq(shippingClasses.id, existing.id));
    existing = { ...existing, tableHash, variantGroupsJson: newGroups };
  }

  await db.insert(shippingTableSnapshots).values({
    shippingClassId: existing.id,
    tableHash,
    rawJson: JSON.stringify(table),
    fetchedAt: now,
  });

  await rebuildRatesForClass({ cls: existing, table, groups, syncRunId });
  await rebuildVariantShipping(existing.id, blueprintId, providerId, groupByVariant);
  await rebuildCoverageForClass(existing.id);

  return { ...base, status: isNew ? "created" : "updated", classId: existing.id };
}

function summarizeGroups(json: string): string {
  try {
    const groups = JSON.parse(json) as VariantGroupDef[];
    return groups.map((g) => `${g.group}:${g.printifyVariantIds.length}v`).join(", ");
  } catch {
    return json.slice(0, 120);
  }
}

/**
 * Re-evaluate tiers + coverage for a class WITHOUT refetching from Printify —
 * used when thresholds, overrides, or zone rules change.
 */
export async function reevaluateClassTiers(classId: number, syncRunId?: number): Promise<void> {
  const [cls] = await db.select().from(shippingClasses).where(eq(shippingClasses.id, classId));
  if (!cls) return;
  const [snapshot] = await db
    .select()
    .from(shippingTableSnapshots)
    .where(eq(shippingTableSnapshots.shippingClassId, classId))
    .orderBy(desc(shippingTableSnapshots.fetchedAt))
    .limit(1);
  if (!snapshot) return;
  let table: NormalizedTable;
  try {
    table = JSON.parse(snapshot.rawJson) as NormalizedTable;
  } catch {
    return;
  }
  let groups: VariantGroupDef[] = [];
  try {
    groups = JSON.parse(cls.variantGroupsJson) as VariantGroupDef[];
  } catch {
    return;
  }
  await rebuildRatesForClass({ cls, table, groups, syncRunId });
  await rebuildCoverageForClass(classId);
}

export async function reevaluateAllClassTiers(): Promise<number> {
  const classes = await db.select({ id: shippingClasses.id }).from(shippingClasses);
  for (const c of classes) {
    await reevaluateClassTiers(c.id);
  }
  return classes.length;
}

// ── Seeding + nightly sync ────────────────────────────────────────────────────

/** Every (blueprint, provider) pair in use across the catalogue. */
export async function listInUsePairs(): Promise<Array<{ blueprintId: number; providerId: number }>> {
  const fromProducts = await db
    .selectDistinct({
      blueprintId: productTypes.printifyBlueprintId,
      providerId: productTypes.printifyProviderId,
    })
    .from(productTypes)
    .where(
      and(
        sql`${productTypes.printifyBlueprintId} IS NOT NULL`,
        sql`${productTypes.printifyProviderId} IS NOT NULL`,
      ),
    );
  const pairs = new Map<string, { blueprintId: number; providerId: number }>();
  for (const row of fromProducts) {
    if (row.blueprintId && row.providerId) {
      pairs.set(`${row.blueprintId}:${row.providerId}`, {
        blueprintId: row.blueprintId,
        providerId: row.providerId,
      });
    }
  }
  return Array.from(pairs.values());
}

/**
 * Sync targets = in-use pairs ∪ already-ingested classes, so classes added
 * ahead of product import (e.g. supplier-step candidates) keep re-syncing.
 */
export async function listSyncTargets(): Promise<Array<{ blueprintId: number; providerId: number }>> {
  const pairs = new Map<string, { blueprintId: number; providerId: number }>();
  for (const p of await listInUsePairs()) {
    pairs.set(`${p.blueprintId}:${p.providerId}`, p);
  }
  const classes = await db
    .select({ blueprintId: shippingClasses.blueprintId, providerId: shippingClasses.providerId })
    .from(shippingClasses);
  for (const c of classes) {
    pairs.set(`${c.blueprintId}:${c.providerId}`, c);
  }
  return Array.from(pairs.values());
}

const SYNC_GUARD_MS = 20 * 60 * 60 * 1000; // 20h — same dedupe pattern as PI sync

export type ShippingSyncSummary = {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  runId?: number;
  checked: number;
  changed: number;
  failed: number;
  results?: IngestResult[];
};

let syncInFlight = false;

/**
 * Full-catalogue diff sync. Nightly + run-on-boot catch-up share the same
 * lastRunAt guard (platform_config), so a boot never double-runs same-day.
 */
export async function runShippingTablesSync(opts: {
  source: "nightly" | "boot" | "manual" | "seed";
  force?: boolean;
}): Promise<ShippingSyncSummary> {
  const { source, force } = opts;
  if (syncInFlight) {
    return { ok: true, skipped: true, reason: "already_running", checked: 0, changed: 0, failed: 0 };
  }
  if (!printifyToken()) {
    return { ok: false, skipped: true, reason: "no_printify_token", checked: 0, changed: 0, failed: 0 };
  }
  if ((source === "nightly" || source === "boot") && !force) {
    const lastRaw = await readConfigValue(SHIPPING_CONFIG_KEYS.lastSyncAt);
    const last = lastRaw ? Date.parse(lastRaw) : NaN;
    if (Number.isFinite(last) && Date.now() - last < SYNC_GUARD_MS) {
      return { ok: true, skipped: true, reason: "recent_sync", checked: 0, changed: 0, failed: 0 };
    }
  }

  syncInFlight = true;
  const [run] = await db
    .insert(shippingSyncRuns)
    .values({ source, status: "running", startedAt: new Date() })
    .returning();
  const results: IngestResult[] = [];
  try {
    const pairs = await listSyncTargets();
    for (const pair of pairs) {
      const result = await ingestShippingClass({
        blueprintId: pair.blueprintId,
        providerId: pair.providerId,
        syncRunId: run.id,
        force,
      });
      results.push(result);
      // Gentle on Printify rate limits.
      await new Promise((r) => setTimeout(r, 350));
    }
    const changed = results.filter((r) => r.status === "created" || r.status === "updated").length;
    const failed = results.filter((r) => r.status === "failed").length;
    await db
      .update(shippingSyncRuns)
      .set({
        status: failed === results.length && results.length > 0 ? "failed" : "complete",
        classesChecked: results.length,
        classesChanged: changed,
        classesFailed: failed,
        summaryJson: JSON.stringify(
          results.map((r) => ({
            bp: r.blueprintId,
            provider: r.providerId,
            status: r.status,
            error: r.error,
          })),
        ),
        finishedAt: new Date(),
      })
      .where(eq(shippingSyncRuns.id, run.id));
    await writeConfigValue(SHIPPING_CONFIG_KEYS.lastSyncAt, new Date().toISOString());
    console.log(
      `[shipping-tables] sync ${source} done: checked=${results.length} changed=${changed} failed=${failed}`,
    );
    return { ok: true, runId: run.id, checked: results.length, changed, failed, results };
  } catch (e: any) {
    await db
      .update(shippingSyncRuns)
      .set({ status: "failed", error: e?.message || String(e), finishedAt: new Date() })
      .where(eq(shippingSyncRuns.id, run.id));
    console.error("[shipping-tables] sync failed:", e?.message || e);
    return {
      ok: false,
      runId: run.id,
      checked: results.length,
      changed: 0,
      failed: results.length,
      results,
    };
  } finally {
    syncInFlight = false;
  }
}

/** Boot catch-up + nightly interval. Call once from route registration. */
export function scheduleShippingTablesSync(): void {
  // Staggered 8 min after boot so it doesn't pile onto the OOS/PI syncs.
  setTimeout(() => {
    runShippingTablesSync({ source: "boot" }).catch((e: Error) =>
      console.error("[shipping-tables] boot sync error:", e),
    );
  }, 8 * 60 * 1000);
  setInterval(() => {
    runShippingTablesSync({ source: "nightly" }).catch((e: Error) =>
      console.error("[shipping-tables] nightly sync error:", e),
    );
  }, 24 * 60 * 60 * 1000);
}

// ── Coverage API (spec 0.3 / 2.4 internal service) ───────────────────────────

export type CoverageItem = {
  productTypeId: number;
  shippable: boolean;
  tier: string;
  firstItemCents: number | null;
  additionalCents: number | null;
  matchedZone: string;
};

let coverageCacheVersion = 0;
const coverageSetCache = new Map<string, { version: number; ids: number[] }>();

function bumpCoverageCache(): void {
  coverageCacheVersion++;
  coverageSetCache.clear();
}

/** Bulk (product, country) lookup. Falls back to the ROW zone per product. */
export async function getCoverageForProducts(
  countryRaw: string,
  productTypeIds: number[],
): Promise<CoverageItem[]> {
  const country = String(countryRaw || "").trim().toUpperCase();
  if (!country || productTypeIds.length === 0) return [];
  const rows = await db
    .select()
    .from(shippingCoverage)
    .where(
      and(
        inArray(shippingCoverage.productTypeId, productTypeIds),
        inArray(shippingCoverage.countryCode, [country, "ROW"]),
      ),
    );
  const byProduct = new Map<number, { exact?: (typeof rows)[number]; row?: (typeof rows)[number] }>();
  for (const r of rows) {
    const slot = byProduct.get(r.productTypeId) || {};
    if (r.countryCode === country) slot.exact = r;
    else slot.row = r;
    byProduct.set(r.productTypeId, slot);
  }
  return productTypeIds.map((id) => {
    const slot = byProduct.get(id);
    const hit = slot?.exact ?? slot?.row;
    if (!hit) {
      return {
        productTypeId: id,
        shippable: false,
        tier: "excluded",
        firstItemCents: null,
        additionalCents: null,
        matchedZone: "none",
      };
    }
    return {
      productTypeId: id,
      shippable: hit.shippable,
      tier: hit.tier,
      firstItemCents: hit.firstItemCents,
      additionalCents: hit.additionalCents,
      matchedZone: hit.countryCode,
    };
  });
}

/** Cached shippable product-id set per country (listing filters). */
export async function getShippableProductIdSet(countryRaw: string): Promise<number[]> {
  const country = String(countryRaw || "").trim().toUpperCase();
  if (!country) return [];
  const cached = coverageSetCache.get(country);
  if (cached && cached.version === coverageCacheVersion) return cached.ids;

  const exact = await db
    .select({ productTypeId: shippingCoverage.productTypeId, shippable: shippingCoverage.shippable })
    .from(shippingCoverage)
    .where(eq(shippingCoverage.countryCode, country));
  const rowZone = await db
    .select({ productTypeId: shippingCoverage.productTypeId, shippable: shippingCoverage.shippable })
    .from(shippingCoverage)
    .where(eq(shippingCoverage.countryCode, "ROW"));

  const verdict = new Map<number, boolean>();
  for (const r of rowZone) verdict.set(r.productTypeId, r.shippable);
  for (const r of exact) verdict.set(r.productTypeId, r.shippable); // exact zone wins
  const ids = Array.from(verdict.entries())
    .filter(([, ok]) => ok)
    .map(([id]) => id)
    .sort((a, b) => a - b);
  coverageSetCache.set(country, { version: coverageCacheVersion, ids });
  return ids;
}
