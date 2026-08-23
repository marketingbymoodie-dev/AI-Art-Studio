/**
 * Phase 3 — Shopify delivery-profile reconciler.
 *
 * Idempotent diff/apply of the desired state (shared/shipping-desired-state)
 * against a shop's live delivery profiles, keyed by the shipping_store_* ID
 * map. Per-profile apply order (rollback story, plan §rollout):
 *
 *   zones + rates → persist IDs → variant weights → variantsToAssociate
 *
 * so a killed run leaves incomplete profiles WITHOUT variants — those
 * products keep checking out on the General profile (pre-Phase-3 behaviour).
 *
 * Safety gates:
 * - `shippingMode` must be "table" for a non-dry-run apply.
 * - Pre-flight R1: existing custom profiles + desired ≤ 90 (warn at 70).
 * - Pre-flight R2: per-shop scratch-probe re-validation of the rates-per-zone
 *   cap on first apply (platform-level probe 2026-08-23 measured ≥40; the
 *   engine writes maxBands+1 = 21).
 * - Table mode never attaches the CarrierService; existing "AI Art Studio"
 *   participant methods are detached before rates are written.
 */
import { and, eq, inArray, or, sql as dsql } from "drizzle-orm";
import { db } from "./db";
import {
  designSkuMappings,
  productTypes,
  publishedProducts,
  shippingClasses,
  shippingStoreProfiles,
  shippingStoreRates,
  shippingStoreSettings,
  shippingStoreVariants,
  shippingStoreZones,
  shippingTableSnapshots,
  shippingRates,
  variantShipping,
  type ShippingStoreProfile,
  type ShippingStoreSettings,
} from "@shared/schema";
import {
  DEFAULT_BAND_CONFIG,
  buildClassRateTable,
  type BandConfig,
  type ExclusionSet,
} from "@shared/shipping-bands";
import {
  buildShopDesiredState,
  maxRatesPerZone,
  type DesiredClassInput,
  type DesiredProfile,
  type DesiredShopState,
  type DesiredZone,
  type MembershipVariant,
} from "@shared/shipping-desired-state";
import { normalizeMyshopifyShopDomain } from "./shopDomain";
import { normalizeVariantKeyLoose } from "@shared/variantMapResolve";
import { storage } from "./storage";
import { ensureValidOfflineAccessToken } from "./shopify-offline-token";

const ADMIN_API = "2025-10";
const CARRIER_NAME = "AI Art Studio";
const RATE_NAME = "Standard Shipping";
/** Leave ≈9 custom slots for merchant/human profiles below the 99 cap. */
const PROFILE_BUDGET = 90;
const PROFILE_WARN = 70;
const ZONES_PER_MUTATION = 5;
const VARIANTS_PER_MUTATION = 100;
const FX_BUFFER = Number(process.env.SHIPPING_FX_BUFFER || 1.05);
const FX_REPIN_DRIFT = Number(process.env.SHIPPING_FX_REPIN_DRIFT || 0.075);

// ── GraphQL helper ────────────────────────────────────────────────────────────

class ShopifyGqlError extends Error {
  constructor(
    message: string,
    public readonly userErrors: Array<{ field?: unknown; message?: string }> = [],
  ) {
    super(message);
  }
}

async function gql<T = any>(
  shop: string,
  accessToken: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`https://${shop}/admin/api/${ADMIN_API}/graphql.json`, {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": accessToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
    });
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      continue;
    }
    const body: any = await res.json().catch(() => ({}));
    const throttled = (body.errors || []).some((e: any) => e?.extensions?.code === "THROTTLED");
    if (throttled) {
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      continue;
    }
    if (!res.ok || body.errors) {
      throw new ShopifyGqlError(
        `graphql ${res.status}: ${JSON.stringify(body.errors ?? body).slice(0, 500)}`,
      );
    }
    return body.data as T;
  }
  throw new ShopifyGqlError("graphql throttled after retries");
}

function collectUserErrors(payload: any): Array<{ message?: string }> {
  return payload?.userErrors ?? [];
}

function throwOnUserErrors(op: string, payload: any): void {
  const errs = collectUserErrors(payload);
  if (errs.length) {
    throw new ShopifyGqlError(`${op}: ${JSON.stringify(errs).slice(0, 500)}`, errs);
  }
}

// ── Settings / token ──────────────────────────────────────────────────────────

export async function getStoreShippingSettings(shopRaw: string): Promise<ShippingStoreSettings> {
  const shop = normalizeMyshopifyShopDomain(shopRaw);
  const [existing] = await db
    .select()
    .from(shippingStoreSettings)
    .where(eq(shippingStoreSettings.shopDomain, shop));
  if (existing) return existing;
  const [created] = await db
    .insert(shippingStoreSettings)
    .values({ shopDomain: shop })
    .onConflictDoNothing()
    .returning();
  if (created) return created;
  const [raced] = await db
    .select()
    .from(shippingStoreSettings)
    .where(eq(shippingStoreSettings.shopDomain, shop));
  return raced;
}

export async function updateStoreShippingSettings(
  shopRaw: string,
  patch: Partial<typeof shippingStoreSettings.$inferInsert>,
): Promise<ShippingStoreSettings> {
  const shop = normalizeMyshopifyShopDomain(shopRaw);
  await getStoreShippingSettings(shop);
  const [updated] = await db
    .update(shippingStoreSettings)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(shippingStoreSettings.shopDomain, shop))
    .returning();
  return updated;
}

async function getShopAccessToken(shop: string): Promise<string> {
  const inst = await storage.getShopifyInstallationByShop(shop);
  if (!inst || !inst.accessToken || inst.accessToken === "NEEDS_RECONNECT") {
    throw new Error(`No installation/token for ${shop}`);
  }
  const refreshed = await ensureValidOfflineAccessToken(inst);
  if (refreshed.ok) return refreshed.accessToken;
  // Local/CLI runs have no app credentials — fall back to the stored token if
  // it still looks unexpired (the shop's server keeps it refreshed).
  const expiresAt = inst.accessTokenExpiresAt ? new Date(inst.accessTokenExpiresAt).getTime() : null;
  if (expiresAt === null || expiresAt > Date.now() + 60_000) return inst.accessToken;
  throw new Error(`Token unavailable for ${shop}: ${refreshed.error}`);
}

// ── Desired-state loading ─────────────────────────────────────────────────────

async function loadClassInputs(): Promise<Map<string, DesiredClassInput>> {
  const classes = await db
    .select()
    .from(shippingClasses)
    .where(dsql`${shippingClasses.lastError} is null`);
  const out = new Map<string, DesiredClassInput>();
  for (const cls of classes) {
    const [snap] = await db
      .select({ rawJson: shippingTableSnapshots.rawJson })
      .from(shippingTableSnapshots)
      .where(eq(shippingTableSnapshots.shippingClassId, cls.id))
      .orderBy(dsql`${shippingTableSnapshots.fetchedAt} desc`)
      .limit(1);
    if (!snap) continue;
    let groups: Array<{ group: string; label?: string; printifyVariantIds: string[] }>;
    let raw: any;
    try {
      groups = JSON.parse(cls.variantGroupsJson);
      raw = JSON.parse(snap.rawJson);
    } catch {
      continue;
    }
    const classKey = `${cls.blueprintId}:${cls.providerId}`;
    const table = buildClassRateTable(classKey, raw.byVariant, groups);
    const rateRows = await db
      .select({
        countryCode: shippingRates.countryCode,
        variantGroup: shippingRates.variantGroup,
        shippable: shippingRates.shippable,
      })
      .from(shippingRates)
      .where(eq(shippingRates.shippingClassId, cls.id));
    const excluded: ExclusionSet = new Set(
      rateRows.filter((r) => !r.shippable).map((r) => `${r.countryCode}::${r.variantGroup}`),
    );
    const config: BandConfig =
      cls.groupDeltaSplitThresholdCents != null
        ? { ...DEFAULT_BAND_CONFIG, groupDeltaSplitThresholdCents: cls.groupDeltaSplitThresholdCents }
        : DEFAULT_BAND_CONFIG;
    out.set(classKey, {
      shippingClassId: cls.id,
      className: cls.name || classKey,
      table,
      excluded,
      config,
    });
  }
  return out;
}

/**
 * Membership (plan §membership): every purchasable app variant on this shop.
 * 1. Base variants — variant_shipping rows whose product type is published to
 *    this shop. The Shopify variant id resolves live through the product
 *    type's shopifyVariantIds JSON (display-label keys, bridged by
 *    normalizeVariantKeyLoose), falling back to the id ingest wrote. Live
 *    lookup wins so a page republish (new variant ids) is picked up without
 *    waiting for the next table sync.
 * 2. Shadow variants — active published_products + non-expired
 *    design_sku_mappings rows; each inherits the class/group of its base variant.
 * Credit packs / non-POD products are never in variant_shipping → excluded.
 */
async function loadShopMemberships(shop: string): Promise<MembershipVariant[]> {
  const bare = shop.replace(/\.myshopify\.com$/i, "");
  const rows = await db
    .select({
      productTypeId: variantShipping.productTypeId,
      sizeColorKey: variantShipping.sizeColorKey,
      shopifyVariantId: variantShipping.shopifyVariantId,
      variantGroup: variantShipping.variantGroup,
      shopifyVariantIdsJson: productTypes.shopifyVariantIds,
      blueprintId: shippingClasses.blueprintId,
      providerId: shippingClasses.providerId,
    })
    .from(variantShipping)
    .innerJoin(productTypes, eq(variantShipping.productTypeId, productTypes.id))
    .innerJoin(shippingClasses, eq(variantShipping.shippingClassId, shippingClasses.id))
    .where(inArray(productTypes.shopifyShopDomain, [shop, bare]));

  const looseIdCache = new Map<number, Map<string, string>>();
  function shopifyIdsOf(productTypeId: number, json: unknown): Map<string, string> {
    let map = looseIdCache.get(productTypeId);
    if (!map) {
      map = new Map<string, string>();
      const obj =
        typeof json === "string"
          ? (() => {
              try {
                return JSON.parse(json);
              } catch {
                return {};
              }
            })()
          : json && typeof json === "object"
            ? json
            : {};
      for (const [label, vid] of Object.entries(obj as Record<string, unknown>)) {
        if (vid != null) map.set(normalizeVariantKeyLoose(label), String(vid));
      }
      looseIdCache.set(productTypeId, map);
    }
    return map;
  }

  const memberships: MembershipVariant[] = [];
  const byVariantId = new Map<string, MembershipVariant>();
  for (const r of rows) {
    const live = shopifyIdsOf(r.productTypeId, r.shopifyVariantIdsJson).get(
      normalizeVariantKeyLoose(r.sizeColorKey),
    );
    const vid = String(live ?? r.shopifyVariantId ?? "").replace(/\D/g, "");
    if (!vid) continue;
    const m: MembershipVariant = {
      classKey: `${r.blueprintId}:${r.providerId}`,
      group: r.variantGroup,
      shopifyVariantId: vid,
      source: "base",
    };
    if (!byVariantId.has(vid)) {
      byVariantId.set(vid, m);
      memberships.push(m);
    }
  }

  // Shadows inherit class/group from their base variant (eager backfill).
  // Two registries: published_products (current resolve-design-variant path)
  // and design_sku_mappings (legacy design-sku path).
  const currentShadows = await db
    .select({
      sourceVariantId: publishedProducts.baseVariantId,
      shadowVariantId: publishedProducts.shopifyVariantId,
    })
    .from(publishedProducts)
    .where(
      and(
        inArray(publishedProducts.shop, [shop, bare]),
        eq(publishedProducts.status, "active"),
        or(dsql`${publishedProducts.expiresAt} is null`, dsql`${publishedProducts.expiresAt} > now()`),
      ),
    );
  const legacyShadows = await db
    .select({
      sourceVariantId: designSkuMappings.sourceVariantId,
      shadowVariantId: designSkuMappings.shadowShopifyVariantId,
    })
    .from(designSkuMappings)
    .where(
      and(
        eq(designSkuMappings.shopDomain, shop),
        dsql`${designSkuMappings.expiresAt} > now()`,
      ),
    );
  const shadows = [...currentShadows, ...legacyShadows];
  for (const s of shadows) {
    const sourceVid = String(s.sourceVariantId || "").replace(/\D/g, "");
    const shadowVid = String(s.shadowVariantId || "").replace(/\D/g, "");
    if (!sourceVid || !shadowVid || byVariantId.has(shadowVid)) continue;
    const base = byVariantId.get(sourceVid);
    if (!base) continue; // base not in an ingested class — nothing to inherit
    const m: MembershipVariant = {
      classKey: base.classKey,
      group: base.group,
      shopifyVariantId: shadowVid,
      source: "shadow",
    };
    byVariantId.set(shadowVid, m);
    memberships.push(m);
  }
  return memberships;
}

async function resolveFxRate(
  shop: string,
  shopCurrency: string,
  settings: ShippingStoreSettings,
  persist: boolean,
): Promise<number> {
  if (shopCurrency === "USD") return 1;
  const pinned = settings.pinnedFxRate ? Number(settings.pinnedFxRate) : null;
  let live: number | null = null;
  try {
    const res = await fetch(
      `https://api.frankfurter.app/latest?from=USD&to=${encodeURIComponent(shopCurrency)}`,
    );
    if (res.ok) {
      const json: any = await res.json();
      const r = Number(json?.rates?.[shopCurrency]);
      if (r > 0) live = r * FX_BUFFER;
    }
  } catch {
    /* pinned/env fallback below */
  }
  if (pinned && pinned > 0) {
    if (live == null || Math.abs(live - pinned) / pinned <= FX_REPIN_DRIFT) return pinned;
  }
  const next = live ?? Number(process.env[`PRINTIFY_SHIPPING_USD_${shopCurrency}`] || 0) * FX_BUFFER;
  if (!(next > 0)) {
    if (pinned && pinned > 0) return pinned;
    throw new Error(`No FX rate available for ${shopCurrency}`);
  }
  const rounded = Math.round(next * 10000) / 10000;
  if (persist) {
    await updateStoreShippingSettings(shop, {
      pinnedFxRate: String(rounded),
      pinnedFxAt: new Date(),
    });
  }
  return rounded;
}

export async function loadDesiredShopState(
  shop: string,
  opts: { shopCurrency: string; fxRate: number },
): Promise<DesiredShopState> {
  const classInputs = await loadClassInputs();
  const memberships = await loadShopMemberships(shop);
  return buildShopDesiredState({
    classes: Array.from(classInputs.values()),
    memberships,
    shopCurrency: opts.shopCurrency,
    usdPerShopUnit: opts.fxRate,
  });
}

// ── Live-shop queries ─────────────────────────────────────────────────────────

async function fetchShopBasics(shop: string, token: string): Promise<{
  currencyCode: string;
  locationIds: string[];
  customProfileCount: number;
}> {
  const data = await gql<any>(
    shop,
    token,
    `query {
      shop { currencyCode }
      locations(first: 20) { nodes { id isActive } }
      deliveryProfiles(first: 100) { nodes { id default } }
    }`,
  );
  const locationIds = (data.locations?.nodes || [])
    .filter((l: any) => l.isActive)
    .map((l: any) => l.id);
  const customProfileCount = (data.deliveryProfiles?.nodes || []).filter(
    (p: any) => !p.default,
  ).length;
  return { currencyCode: data.shop.currencyCode, locationIds, customProfileCount };
}

type LiveZone = {
  zoneId: string;
  name: string;
  methodDefinitionIds: string[];
};

async function fetchLiveProfileZones(
  shop: string,
  token: string,
  profileId: string,
): Promise<{ exists: boolean; locationGroupId: string | null; zones: LiveZone[] }> {
  const data = await gql<any>(
    shop,
    token,
    `query($id: ID!) {
      deliveryProfile(id: $id) {
        id
        profileLocationGroups {
          locationGroup { id }
          locationGroupZones(first: 50) {
            edges {
              node {
                zone { id name }
                methodDefinitions(first: 50) { edges { node { id } } }
              }
            }
          }
        }
      }
    }`,
    { id: profileId },
  );
  const profile = data.deliveryProfile;
  if (!profile) return { exists: false, locationGroupId: null, zones: [] };
  const group = profile.profileLocationGroups?.[0];
  const zones: LiveZone[] = (group?.locationGroupZones?.edges || []).map((e: any) => ({
    zoneId: e.node.zone.id,
    name: e.node.zone.name || "",
    methodDefinitionIds: (e.node.methodDefinitions?.edges || []).map((d: any) => d.node.id),
  }));
  return { exists: true, locationGroupId: group?.locationGroup?.id || null, zones };
}

// ── Mutation input builders ───────────────────────────────────────────────────

function methodDefinitionInputs(zone: DesiredZone, currency: string): any[] {
  return zone.rates.map((r) => {
    const conditions: any[] = [
      {
        criteria: { unit: "GRAMS", value: r.lowerGrams },
        operator: "GREATER_THAN_OR_EQUAL_TO",
      },
    ];
    if (r.upperGrams != null) {
      conditions.push({
        criteria: { unit: "GRAMS", value: r.upperGrams },
        operator: "LESS_THAN_OR_EQUAL_TO",
      });
    }
    return {
      // Identical name across every profile — Shopify sums same-named rates
      // into one checkout line (plan §desired-state).
      name: RATE_NAME,
      active: true,
      rateDefinition: { price: { amount: (r.priceCents / 100).toFixed(2), currencyCode: currency } },
      weightConditionsToCreate: conditions,
    };
  });
}

function zoneCreateInput(zone: DesiredZone, currency: string): any {
  return {
    name: zone.name,
    countries: zone.restOfWorld
      ? [{ restOfWorld: true }]
      : zone.countries.map((code) => ({ code, includeAllProvinces: true })),
    methodDefinitionsToCreate: methodDefinitionInputs(zone, currency),
  };
}

// ── Reconcile ────────────────────────────────────────────────────────────────

export type ReconcileSummary = {
  shop: string;
  dryRun: boolean;
  status: "ok" | "error" | "partial" | "noop";
  desiredProfiles: number;
  createdProfiles: number;
  updatedProfiles: number;
  unchangedProfiles: number;
  removedProfiles: number;
  zonesWritten: number;
  ratesWritten: number;
  variantsAssociated: number;
  weightsWritten: number;
  unresolvedVariants: number;
  customProfilesUsed: number;
  profileBudget: number;
  warnings: string[];
  errors: string[];
};

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Per-shop R2 re-validation: scratch profile with `needed` same-named weight
 * rates in one zone, then delete. Run once per shop before the first apply.
 */
async function revalidateRateCap(
  shop: string,
  token: string,
  locationIds: string[],
  needed: number,
  currency: string,
): Promise<number> {
  const rates = Array.from({ length: needed }, (_, i) => ({
    bandIndex: i,
    lowerGrams: i * 1000,
    upperGrams: i === needed - 1 ? null : (i + 1) * 1000 - 1,
    priceCents: 500 + i,
  }));
  const zone: DesiredZone = {
    zoneKey: "PROBE",
    name: "Probe US",
    countries: ["US"],
    restOfWorld: false,
    blocked: false,
    rates,
  };
  const created = await gql<any>(
    shop,
    token,
    `mutation($profile: DeliveryProfileInput!) {
      deliveryProfileCreate(profile: $profile) {
        profile { id }
        userErrors { field message }
      }
    }`,
    {
      profile: {
        name: "AppAI rate-cap check — safe to delete",
        locationGroupsToCreate: [
          { locations: locationIds, zonesToCreate: [zoneCreateInput(zone, currency)] },
        ],
      },
    },
  );
  const payload = created.deliveryProfileCreate;
  const profileId = payload?.profile?.id;
  try {
    throwOnUserErrors("rate-cap probe", payload);
  } finally {
    if (profileId) {
      await gql(
        shop,
        token,
        `mutation($id: ID!) { deliveryProfileRemove(id: $id) { userErrors { message } } }`,
        { id: profileId },
      ).catch((e) => console.warn(`[shipping-reconciler] probe cleanup failed for ${shop}:`, e?.message));
    }
  }
  return needed;
}

export async function reconcileShopShipping(
  shopRaw: string,
  opts: { dryRun: boolean; source?: string },
): Promise<ReconcileSummary> {
  const shop = normalizeMyshopifyShopDomain(shopRaw);
  const summary: ReconcileSummary = {
    shop,
    dryRun: opts.dryRun,
    status: "ok",
    desiredProfiles: 0,
    createdProfiles: 0,
    updatedProfiles: 0,
    unchangedProfiles: 0,
    removedProfiles: 0,
    zonesWritten: 0,
    ratesWritten: 0,
    variantsAssociated: 0,
    weightsWritten: 0,
    unresolvedVariants: 0,
    customProfilesUsed: 0,
    profileBudget: PROFILE_BUDGET,
    warnings: [],
    errors: [],
  };

  const settings = await getStoreShippingSettings(shop);
  if (!opts.dryRun && settings.shippingMode !== "table") {
    throw new Error(
      `Refusing non-dry-run apply: shippingMode=${settings.shippingMode} (set to "table" first)`,
    );
  }

  const token = await getShopAccessToken(shop);
  const basics = await fetchShopBasics(shop, token);
  summary.customProfilesUsed = basics.customProfileCount;
  if (basics.locationIds.length === 0) throw new Error(`No active locations on ${shop}`);

  const fxRate = await resolveFxRate(shop, basics.currencyCode, settings, !opts.dryRun);
  const desired = await loadDesiredShopState(shop, {
    shopCurrency: basics.currencyCode,
    fxRate,
  });
  summary.desiredProfiles = desired.profiles.length;
  summary.unresolvedVariants = desired.unresolvedVariants.length;
  if (desired.unresolvedVariants.length) {
    summary.warnings.push(
      `${desired.unresolvedVariants.length} variant(s) belong to classes without ingested tables`,
    );
  }

  // Pre-flight R1: profile budget.
  const mapped = await db
    .select()
    .from(shippingStoreProfiles)
    .where(eq(shippingStoreProfiles.shopDomain, shop));
  const mappedByKey = new Map(mapped.map((m) => [m.profileKey, m]));
  const netNew = desired.profiles.filter((p) => !mappedByKey.get(p.profileKey)?.shopifyProfileId)
    .length;
  const projected = basics.customProfileCount + netNew;
  if (projected > PROFILE_BUDGET) {
    throw new Error(
      `Pre-flight: projected custom profiles ${projected} exceeds budget ${PROFILE_BUDGET}. ` +
        `Interim lever: raise group_delta_split_threshold_cents on wide classes; long-term: Exact Mode.`,
    );
  }
  if (projected >= PROFILE_WARN) {
    summary.warnings.push(`Profile budget warning: ${projected}/${PROFILE_BUDGET} custom profiles`);
  }

  // Pre-flight R2: desired rates-per-zone vs (re-validated) cap.
  const neededRates = maxRatesPerZone(desired);
  let cap = settings.probedMaxRatesPerZone;
  if (!opts.dryRun && (!cap || cap < neededRates)) {
    cap = await revalidateRateCap(shop, token, basics.locationIds, Math.max(neededRates, 21), basics.currencyCode);
    await updateStoreShippingSettings(shop, {
      probedMaxRatesPerZone: cap,
      probedAt: new Date(),
    });
  }
  if (cap && neededRates > cap) {
    throw new Error(`Pre-flight: desired ${neededRates} rates/zone exceeds shop cap ${cap}`);
  }

  if (opts.dryRun) {
    for (const p of desired.profiles) {
      const row = mappedByKey.get(p.profileKey);
      if (!row?.shopifyProfileId) summary.createdProfiles++;
      else if (row.desiredHash !== p.hash || row.status !== "synced") summary.updatedProfiles++;
      else summary.unchangedProfiles++;
      summary.zonesWritten += p.zones.length;
      summary.ratesWritten += p.zones.reduce((s, z) => s + z.rates.length, 0);
      summary.variantsAssociated += p.variants.length;
    }
    const desiredKeys = new Set(desired.profiles.map((p) => p.profileKey));
    summary.removedProfiles = mapped.filter(
      (m) => m.shopifyProfileId && !desiredKeys.has(m.profileKey),
    ).length;
    summary.status = "noop";
    return summary;
  }

  // Table mode must not run the CarrierService — detach participant methods.
  try {
    const detached = await detachCarrierMethods(shop, token);
    if (detached > 0) summary.warnings.push(`Detached ${detached} CarrierService method(s)`);
  } catch (e: any) {
    summary.warnings.push(`Carrier detach failed: ${e?.message || e}`);
  }

  // ── Apply, profile by profile ───────────────────────────────────────────────
  let failures = 0;
  for (const p of desired.profiles) {
    try {
      const result = await applyProfile(shop, token, basics, p, mappedByKey.get(p.profileKey));
      summary.createdProfiles += result.created ? 1 : 0;
      summary.updatedProfiles += result.updated ? 1 : 0;
      summary.unchangedProfiles += result.unchanged ? 1 : 0;
      summary.zonesWritten += result.zonesWritten;
      summary.ratesWritten += result.ratesWritten;
      summary.variantsAssociated += result.variantsAssociated;
      summary.weightsWritten += result.weightsWritten;
    } catch (e: any) {
      failures++;
      const msg = `${p.profileKey}: ${e?.message || e}`;
      summary.errors.push(msg.slice(0, 400));
      console.error(`[shipping-reconciler] ${shop} profile failed:`, msg);
      await db
        .update(shippingStoreProfiles)
        .set({ status: "error", lastError: String(e?.message || e).slice(0, 800), updatedAt: new Date() })
        .where(
          and(
            eq(shippingStoreProfiles.shopDomain, shop),
            eq(shippingStoreProfiles.profileKey, p.profileKey),
          ),
        );
    }
  }

  // ── GC: mapped profiles whose class/group no longer has members (amendment A)
  const desiredKeys = new Set(desired.profiles.map((p) => p.profileKey));
  for (const row of mapped) {
    if (desiredKeys.has(row.profileKey)) continue;
    try {
      if (row.shopifyProfileId) {
        // Removing the profile returns its variants to the General profile.
        const removed = await gql<any>(
          shop,
          token,
          `mutation($id: ID!) { deliveryProfileRemove(id: $id) { userErrors { message } } }`,
          { id: row.shopifyProfileId },
        );
        const errs = collectUserErrors(removed.deliveryProfileRemove);
        if (errs.length && !/not found|doesn't exist/i.test(JSON.stringify(errs))) {
          throw new ShopifyGqlError(JSON.stringify(errs).slice(0, 300));
        }
      }
      await deleteProfileMapRows(row.id, shop);
      summary.removedProfiles++;
    } catch (e: any) {
      summary.errors.push(`GC ${row.profileKey}: ${e?.message || e}`.slice(0, 400));
    }
  }

  summary.status = failures === 0 && summary.errors.length === 0 ? "ok" : "partial";
  await updateStoreShippingSettings(shop, {
    lastReconcileAt: new Date(),
    lastReconcileStatus: summary.status,
    lastReconcileError: summary.errors.length ? summary.errors.join(" | ").slice(0, 1000) : null,
    lastReconcileSummaryJson: JSON.stringify(summary).slice(0, 8000),
  });
  return summary;
}

async function deleteProfileMapRows(storeProfileId: number, shop: string): Promise<void> {
  const zones = await db
    .select({ id: shippingStoreZones.id })
    .from(shippingStoreZones)
    .where(eq(shippingStoreZones.storeProfileId, storeProfileId));
  if (zones.length) {
    await db.delete(shippingStoreRates).where(
      inArray(
        shippingStoreRates.storeZoneId,
        zones.map((z) => z.id),
      ),
    );
  }
  await db.delete(shippingStoreZones).where(eq(shippingStoreZones.storeProfileId, storeProfileId));
  await db
    .delete(shippingStoreVariants)
    .where(eq(shippingStoreVariants.storeProfileId, storeProfileId));
  await db.delete(shippingStoreProfiles).where(eq(shippingStoreProfiles.id, storeProfileId));
}

// ── Per-profile apply ─────────────────────────────────────────────────────────

type ApplyResult = {
  created: boolean;
  updated: boolean;
  unchanged: boolean;
  zonesWritten: number;
  ratesWritten: number;
  variantsAssociated: number;
  weightsWritten: number;
};

async function applyProfile(
  shop: string,
  token: string,
  basics: { currencyCode: string; locationIds: string[] },
  desired: DesiredProfile,
  mapRow: ShippingStoreProfile | undefined,
): Promise<ApplyResult> {
  const result: ApplyResult = {
    created: false,
    updated: false,
    unchanged: false,
    zonesWritten: 0,
    ratesWritten: 0,
    variantsAssociated: 0,
    weightsWritten: 0,
  };
  const currency = basics.currencyCode;

  // Ensure map row exists.
  let row = mapRow;
  if (!row) {
    const [inserted] = await db
      .insert(shippingStoreProfiles)
      .values({
        shopDomain: shop,
        profileKey: desired.profileKey,
        shippingClassId: desired.shippingClassId,
        variantGroup: desired.variantGroup,
        status: "pending",
      })
      .onConflictDoNothing()
      .returning();
    row =
      inserted ??
      (
        await db
          .select()
          .from(shippingStoreProfiles)
          .where(
            and(
              eq(shippingStoreProfiles.shopDomain, shop),
              eq(shippingStoreProfiles.profileKey, desired.profileKey),
            ),
          )
      )[0];
  }

  // Verify the mapped Shopify profile still exists; clear stale IDs (plan:
  // never blind-recreate — but a 404'd ID means the profile is gone).
  let live: { exists: boolean; locationGroupId: string | null; zones: LiveZone[] } = {
    exists: false,
    locationGroupId: null,
    zones: [],
  };
  if (row.shopifyProfileId) {
    live = await fetchLiveProfileZones(shop, token, row.shopifyProfileId);
    if (!live.exists) {
      await db
        .update(shippingStoreProfiles)
        .set({ shopifyProfileId: null, shopifyLocationGroupId: null, desiredHash: null, updatedAt: new Date() })
        .where(eq(shippingStoreProfiles.id, row.id));
      row = { ...row, shopifyProfileId: null, shopifyLocationGroupId: null, desiredHash: null };
    }
  }

  const zonesAndRatesUnchanged =
    !!row.shopifyProfileId && row.desiredHash === desired.hash && row.status === "synced";

  let profileId = row.shopifyProfileId;
  let locationGroupId = row.shopifyLocationGroupId || live.locationGroupId;

  if (!profileId) {
    // Create with the first zone chunk.
    const zoneChunks = chunk(desired.zones, ZONES_PER_MUTATION);
    const created = await gql<any>(
      shop,
      token,
      `mutation($profile: DeliveryProfileInput!) {
        deliveryProfileCreate(profile: $profile) {
          profile {
            id
            profileLocationGroups { locationGroup { id } }
          }
          userErrors { field message }
        }
      }`,
      {
        profile: {
          name: desired.name,
          locationGroupsToCreate: [
            {
              locations: basics.locationIds,
              zonesToCreate: (zoneChunks[0] || []).map((z) => zoneCreateInput(z, currency)),
            },
          ],
        },
      },
    );
    throwOnUserErrors("deliveryProfileCreate", created.deliveryProfileCreate);
    profileId = created.deliveryProfileCreate.profile.id;
    locationGroupId =
      created.deliveryProfileCreate.profile.profileLocationGroups?.[0]?.locationGroup?.id || null;
    await db
      .update(shippingStoreProfiles)
      .set({ shopifyProfileId: profileId, shopifyLocationGroupId: locationGroupId, updatedAt: new Date() })
      .where(eq(shippingStoreProfiles.id, row.id));

    for (const zones of zoneChunks.slice(1)) {
      await gqlZonesCreate(shop, token, profileId!, locationGroupId!, zones, currency);
    }
    result.created = true;
    result.zonesWritten = desired.zones.length;
    result.ratesWritten = desired.zones.reduce((s, z) => s + z.rates.length, 0);
  } else if (!zonesAndRatesUnchanged) {
    // Wholesale zone rewrite inside the existing profile. zonesToDelete and
    // the first zonesToCreate chunk ride in ONE mutation so the profile is
    // never left zone-less if the run dies between calls.
    if (!locationGroupId) throw new Error("missing location group id");
    const zoneChunks = chunk(desired.zones, ZONES_PER_MUTATION);
    const updated = await gql<any>(
      shop,
      token,
      `mutation($id: ID!, $profile: DeliveryProfileInput!) {
        deliveryProfileUpdate(id: $id, profile: $profile) {
          profile { id }
          userErrors { field message }
        }
      }`,
      {
        id: profileId,
        profile: {
          name: desired.name,
          zonesToDelete: live.zones.map((z) => z.zoneId),
          locationGroupsToUpdate: [
            {
              id: locationGroupId,
              zonesToCreate: (zoneChunks[0] || []).map((z) => zoneCreateInput(z, currency)),
            },
          ],
        },
      },
    );
    throwOnUserErrors("deliveryProfileUpdate(zones)", updated.deliveryProfileUpdate);
    for (const zones of zoneChunks.slice(1)) {
      await gqlZonesCreate(shop, token, profileId, locationGroupId, zones, currency);
    }
    result.updated = true;
    result.zonesWritten = desired.zones.length;
    result.ratesWritten = desired.zones.reduce((s, z) => s + z.rates.length, 0);
  } else {
    result.unchanged = true;
  }

  // Persist zone/rate map (IDs re-read from live state for bookkeeping).
  if (!zonesAndRatesUnchanged) {
    await persistZoneMap(shop, token, row.id, profileId!, desired);
  }

  // Weights BEFORE association (plan §rollback: never associate with stale weights).
  result.weightsWritten = await writeVariantWeights(shop, token, desired);

  // Associate variants last. Shopify moves variants between profiles on
  // associate, so this is naturally idempotent and exclusive.
  const gids = desired.variants.map((v) => `gid://shopify/ProductVariant/${v.shopifyVariantId}`);
  for (const ids of chunk(gids, VARIANTS_PER_MUTATION)) {
    const assoc = await gql<any>(
      shop,
      token,
      `mutation($id: ID!, $profile: DeliveryProfileInput!) {
        deliveryProfileUpdate(id: $id, profile: $profile) {
          profile { id }
          userErrors { field message }
        }
      }`,
      { id: profileId, profile: { variantsToAssociate: ids } },
    );
    throwOnUserErrors("variantsToAssociate", assoc.deliveryProfileUpdate);
    result.variantsAssociated += ids.length;
  }
  const now = new Date();
  for (const v of desired.variants) {
    await db
      .insert(shippingStoreVariants)
      .values({
        shopDomain: shop,
        storeProfileId: row.id,
        shopifyVariantId: v.shopifyVariantId,
        source: v.source,
        pseudoWeightGrams: v.pseudoWeightGrams,
        associatedAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [shippingStoreVariants.shopDomain, shippingStoreVariants.shopifyVariantId],
        set: {
          storeProfileId: row.id,
          source: v.source,
          pseudoWeightGrams: v.pseudoWeightGrams,
          associatedAt: now,
          updatedAt: now,
        },
      });
  }

  await db
    .update(shippingStoreProfiles)
    .set({ desiredHash: desired.hash, status: "synced", lastError: null, updatedAt: new Date() })
    .where(eq(shippingStoreProfiles.id, row.id));
  return result;
}

async function gqlZonesCreate(
  shop: string,
  token: string,
  profileId: string,
  locationGroupId: string,
  zones: DesiredZone[],
  currency: string,
): Promise<void> {
  const updated = await gql<any>(
    shop,
    token,
    `mutation($id: ID!, $profile: DeliveryProfileInput!) {
      deliveryProfileUpdate(id: $id, profile: $profile) {
        profile { id }
        userErrors { field message }
      }
    }`,
    {
      id: profileId,
      profile: {
        locationGroupsToUpdate: [
          { id: locationGroupId, zonesToCreate: zones.map((z) => zoneCreateInput(z, currency)) },
        ],
      },
    },
  );
  throwOnUserErrors("zonesToCreate", updated.deliveryProfileUpdate);
}

async function persistZoneMap(
  shop: string,
  token: string,
  storeProfileId: number,
  profileId: string,
  desired: DesiredProfile,
): Promise<void> {
  const live = await fetchLiveProfileZones(shop, token, profileId);
  const liveByName = new Map(live.zones.map((z) => [z.name, z]));
  // Replace map rows wholesale (zones were rewritten wholesale).
  const oldZones = await db
    .select({ id: shippingStoreZones.id })
    .from(shippingStoreZones)
    .where(eq(shippingStoreZones.storeProfileId, storeProfileId));
  if (oldZones.length) {
    await db.delete(shippingStoreRates).where(
      inArray(
        shippingStoreRates.storeZoneId,
        oldZones.map((z) => z.id),
      ),
    );
    await db.delete(shippingStoreZones).where(eq(shippingStoreZones.storeProfileId, storeProfileId));
  }
  for (const z of desired.zones) {
    const liveZone = liveByName.get(z.name);
    const [zoneRow] = await db
      .insert(shippingStoreZones)
      .values({
        storeProfileId,
        zoneKey: z.zoneKey,
        shopifyZoneId: liveZone?.zoneId || null,
        countriesJson: JSON.stringify(z.countries),
        restOfWorld: z.restOfWorld,
        desiredHash: null,
        updatedAt: new Date(),
      })
      .returning();
    if (z.rates.length) {
      await db.insert(shippingStoreRates).values(
        z.rates.map((r) => ({
          storeZoneId: zoneRow.id,
          bandIndex: r.bandIndex,
          lowerGrams: r.lowerGrams,
          upperGrams: r.upperGrams,
          priceCents: r.priceCents,
          updatedAt: new Date(),
        })),
      );
    }
  }
}

// ── Variant weights ───────────────────────────────────────────────────────────

async function writeVariantWeights(
  shop: string,
  token: string,
  desired: DesiredProfile,
): Promise<number> {
  const settings = await getStoreShippingSettings(shop);
  if (!settings.manageVariantWeights) return 0;

  const targets = desired.variants;
  if (targets.length === 0) return 0;
  let written = 0;
  for (const batch of chunk(targets, 50)) {
    const gids = batch.map((v) => `gid://shopify/ProductVariant/${v.shopifyVariantId}`);
    const data = await gql<any>(
      shop,
      token,
      `query($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on ProductVariant {
            id
            inventoryItem { id measurement { weight { unit value } } }
          }
        }
      }`,
      { ids: gids },
    );
    const nodes: any[] = (data.nodes || []).filter(Boolean);
    for (const node of nodes) {
      const vid = String(node.id || "").replace(/\D/g, "");
      const target = batch.find((v) => v.shopifyVariantId === vid);
      if (!target || !node.inventoryItem?.id) continue;
      const current = node.inventoryItem.measurement?.weight;
      const desiredGrams = target.pseudoWeightGrams;
      const currentGrams =
        current?.unit === "GRAMS"
          ? Number(current.value)
          : current?.unit === "KILOGRAMS"
            ? Number(current.value) * 1000
            : null;
      if (currentGrams != null && Math.abs(currentGrams - desiredGrams) < 0.5) continue;
      const updated = await gql<any>(
        shop,
        token,
        `mutation($id: ID!, $input: InventoryItemInput!) {
          inventoryItemUpdate(id: $id, input: $input) {
            inventoryItem { id }
            userErrors { field message }
          }
        }`,
        {
          id: node.inventoryItem.id,
          input: { measurement: { weight: { unit: "GRAMS", value: desiredGrams } } },
        },
      );
      throwOnUserErrors("inventoryItemUpdate", updated.inventoryItemUpdate);
      written++;
      await db
        .update(shippingStoreVariants)
        .set({ weightWrittenAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(shippingStoreVariants.shopDomain, shop),
            eq(shippingStoreVariants.shopifyVariantId, vid),
          ),
        );
    }
  }
  return written;
}

// ── CarrierService detach (table mode is mutually exclusive with Exact Mode) ─

async function detachCarrierMethods(shop: string, token: string): Promise<number> {
  const res = await fetch(`https://${shop}/admin/api/${ADMIN_API}/carrier_services.json`, {
    headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
  });
  if (!res.ok) return 0;
  const listed: any = await res.json();
  const carrier = (listed.carrier_services || []).find((c: any) => c.name === CARRIER_NAME);
  if (!carrier?.id) return 0;
  const carrierGid = `gid://shopify/DeliveryCarrierService/${carrier.id}`;

  const data = await gql<any>(
    shop,
    token,
    `query {
      deliveryProfiles(first: 50) {
        nodes {
          id
          profileLocationGroups {
            locationGroupZones(first: 50) {
              edges {
                node {
                  methodDefinitions(first: 50) {
                    edges {
                      node {
                        id
                        rateProvider {
                          ... on DeliveryParticipant { carrierService { id } }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }`,
  );
  let removed = 0;
  for (const profile of data.deliveryProfiles?.nodes || []) {
    const toDelete: string[] = [];
    for (const group of profile.profileLocationGroups || []) {
      for (const zoneEdge of group.locationGroupZones?.edges || []) {
        for (const defEdge of zoneEdge.node.methodDefinitions?.edges || []) {
          if (defEdge.node.rateProvider?.carrierService?.id === carrierGid) {
            toDelete.push(defEdge.node.id);
          }
        }
      }
    }
    if (!toDelete.length) continue;
    const updated = await gql<any>(
      shop,
      token,
      `mutation($id: ID!, $profile: DeliveryProfileInput!) {
        deliveryProfileUpdate(id: $id, profile: $profile) {
          profile { id }
          userErrors { field message }
        }
      }`,
      { id: profile.id, profile: { methodDefinitionsToDelete: toDelete } },
    );
    throwOnUserErrors("carrier detach", updated.deliveryProfileUpdate);
    removed += toDelete.length;
  }
  return removed;
}

// ── Kill switch / uninstall cleanup ──────────────────────────────────────────

/**
 * Kill switch: remove every app-owned profile (variants revert to General),
 * keep the ID-map rows' history out of the way by deleting them. Token must
 * still be valid — for uninstall (revoked token) use clearShopShippingState.
 */
export async function removeAllShopShippingProfiles(shopRaw: string): Promise<number> {
  const shop = normalizeMyshopifyShopDomain(shopRaw);
  const token = await getShopAccessToken(shop);
  const rows = await db
    .select()
    .from(shippingStoreProfiles)
    .where(eq(shippingStoreProfiles.shopDomain, shop));
  let removed = 0;
  for (const row of rows) {
    if (row.shopifyProfileId) {
      await gql(
        shop,
        token,
        `mutation($id: ID!) { deliveryProfileRemove(id: $id) { userErrors { message } } }`,
        { id: row.shopifyProfileId },
      ).catch((e) =>
        console.warn(`[shipping-reconciler] remove ${row.profileKey} failed:`, e?.message),
      );
    }
    await deleteProfileMapRows(row.id, shop);
    removed++;
  }
  return removed;
}

/**
 * Uninstall cleanup: the token is revoked, so no Shopify calls are possible
 * (Shopify deletes app-owned carrier services on uninstall; app delivery
 * profiles are cleaned up by Shopify's app-removal flow). Clear our map and
 * flip the mode off so a reinstall starts from a clean slate.
 */
export async function clearShopShippingState(shopRaw: string): Promise<void> {
  const shop = normalizeMyshopifyShopDomain(shopRaw);
  const rows = await db
    .select({ id: shippingStoreProfiles.id })
    .from(shippingStoreProfiles)
    .where(eq(shippingStoreProfiles.shopDomain, shop));
  for (const row of rows) {
    await deleteProfileMapRows(row.id, shop);
  }
  await db
    .update(shippingStoreSettings)
    .set({ shippingMode: "off", updatedAt: new Date() })
    .where(eq(shippingStoreSettings.shopDomain, shop));
}

// ── onProductImported (plan §reconciler triggers) ─────────────────────────────

/**
 * Fast-path membership hook for newly created variants (shadow resolve, page
 * publish). Associates the variant into its mapped profile + writes weight.
 * No-op unless the shop is in table mode with a synced profile map. Fire and
 * forget from hot paths — never block checkout.
 */
export async function attachVariantToShipping(params: {
  shop: string;
  shopifyVariantId: string;
  /** For shadows: the base variant whose profile membership is inherited. */
  sourceVariantId?: string;
  source: "base" | "shadow";
}): Promise<void> {
  const shop = normalizeMyshopifyShopDomain(params.shop);
  const settings = await getStoreShippingSettings(shop);
  if (settings.shippingMode !== "table") return;

  const vid = String(params.shopifyVariantId).replace(/\D/g, "");
  if (!vid) return;

  let profileRowId: number | null = null;
  let pseudoWeightGrams: number | null = null;

  if (params.source === "shadow" && params.sourceVariantId) {
    const sourceVid = String(params.sourceVariantId).replace(/\D/g, "");
    const [baseRow] = await db
      .select()
      .from(shippingStoreVariants)
      .where(
        and(
          eq(shippingStoreVariants.shopDomain, shop),
          eq(shippingStoreVariants.shopifyVariantId, sourceVid),
        ),
      );
    if (baseRow) {
      profileRowId = baseRow.storeProfileId;
      pseudoWeightGrams = baseRow.pseudoWeightGrams;
    }
  }
  if (profileRowId == null) {
    // Base variant (or shadow whose base is unmapped): fall back to a full
    // reconcile, which resolves class/group membership from scratch.
    await reconcileShopShipping(shop, { dryRun: false, source: "onProductImported" }).catch((e) =>
      console.error(`[shipping-reconciler] onProductImported reconcile failed for ${shop}:`, e?.message),
    );
    return;
  }

  const [profileRow] = await db
    .select()
    .from(shippingStoreProfiles)
    .where(eq(shippingStoreProfiles.id, profileRowId));
  if (!profileRow?.shopifyProfileId) return;

  const token = await getShopAccessToken(shop);
  // Weight first, then associate (same ordering as the full reconciler).
  if (settings.manageVariantWeights && pseudoWeightGrams != null) {
    try {
      const data = await gql<any>(
        shop,
        token,
        `query($ids: [ID!]!) {
          nodes(ids: $ids) { ... on ProductVariant { id inventoryItem { id } } }
        }`,
        { ids: [`gid://shopify/ProductVariant/${vid}`] },
      );
      const item = (data.nodes || [])[0]?.inventoryItem?.id;
      if (item) {
        await gql(
          shop,
          token,
          `mutation($id: ID!, $input: InventoryItemInput!) {
            inventoryItemUpdate(id: $id, input: $input) { userErrors { message } }
          }`,
          { id: item, input: { measurement: { weight: { unit: "GRAMS", value: pseudoWeightGrams } } } },
        );
      }
    } catch (e: any) {
      console.warn(`[shipping-reconciler] weight write failed for ${shop}/${vid}:`, e?.message);
    }
  }
  const assoc = await gql<any>(
    shop,
    token,
    `mutation($id: ID!, $profile: DeliveryProfileInput!) {
      deliveryProfileUpdate(id: $id, profile: $profile) {
        profile { id }
        userErrors { field message }
      }
    }`,
    {
      id: profileRow.shopifyProfileId,
      profile: { variantsToAssociate: [`gid://shopify/ProductVariant/${vid}`] },
    },
  );
  throwOnUserErrors("attachVariant associate", assoc.deliveryProfileUpdate);
  const now = new Date();
  await db
    .insert(shippingStoreVariants)
    .values({
      shopDomain: shop,
      storeProfileId: profileRowId,
      shopifyVariantId: vid,
      source: params.source,
      pseudoWeightGrams,
      associatedAt: now,
      weightWrittenAt: settings.manageVariantWeights ? now : null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [shippingStoreVariants.shopDomain, shippingStoreVariants.shopifyVariantId],
      set: { storeProfileId: profileRowId, associatedAt: now, updatedAt: now },
    });
}

/** Nightly/boot trigger: reconcile every shop currently in table mode. */
export async function reconcileAllTableModeShops(source: string): Promise<void> {
  const shops = await db
    .select({ shopDomain: shippingStoreSettings.shopDomain })
    .from(shippingStoreSettings)
    .where(eq(shippingStoreSettings.shippingMode, "table"));
  for (const s of shops) {
    try {
      const summary = await reconcileShopShipping(s.shopDomain, { dryRun: false, source });
      console.log(
        `[shipping-reconciler] ${source} reconcile ${s.shopDomain}: ${summary.status} ` +
          `(+${summary.createdProfiles}/${summary.updatedProfiles}~ profiles, ${summary.variantsAssociated} variants)`,
      );
    } catch (e: any) {
      console.error(`[shipping-reconciler] ${source} reconcile failed for ${s.shopDomain}:`, e?.message);
    }
  }
}
