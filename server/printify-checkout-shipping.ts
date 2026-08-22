/**
 * Shopify Carrier Service: quote Printify first/additional shipping at checkout.
 */
import { eq } from "drizzle-orm";
import { db } from "./db";
import { customizerPages, designSkuMappings } from "@shared/schema";
import {
  convertUsdCentsToShop,
  countryLookupKeys,
  quotePrintifyLinesUsdCents,
  type PrintifyShippingLineQuote,
} from "@shared/printify-shipping-quote";
import { resolveVariantFromMap } from "@shared/variantMapResolve";
import { isCreatorCreditPackLine } from "./creator-packs";
import { isMerchantCreditPackLine } from "./merchant-packs";
import { isCreatorPlatformShop } from "./creator-host";
import {
  getCreatorPlatformShopCandidates,
  getCreatorPlatformShopDomain,
  isCreatorMarketplaceEnabled,
} from "./creator-config";
import { normalizeMyshopifyShopDomain } from "./shopDomain";
import { ensureValidOfflineAccessToken } from "./shopify-offline-token";
import { storage } from "./storage";
import { normalizeShopifyOrderLine } from "./flat-order-fulfillment";

const ADMIN_API = "2025-10";
const CARRIER_NAME = "AI Art Studio";
const TABLE_TTL_MS = 6 * 60 * 60 * 1000;
const FX_TTL_MS = 12 * 60 * 60 * 1000;

type ShippingCell = { firstItemCents: number; additionalItemCents: number };
type ShippingTable = {
  fetchedAt: number;
  /** tier → variantId → country → cell */
  tiers: Record<string, Record<string, Record<string, ShippingCell>>>;
};

const tableCache = new Map<string, ShippingTable>();
let fxCache: { at: number; usdTo: Record<string, number> } | null = null;

export type ShopifyCarrierRate = {
  service_name: string;
  service_code: string;
  description: string;
  currency: string;
  total_price: string;
};

export function carrierServiceCallbackUrl(origin: string): string {
  return `${origin.replace(/\/$/, "")}/shopify/carrier-service/rates`;
}

export function canRegisterCarrierService(origin: string, shop: string): boolean {
  const host = origin.replace(/^https?:\/\//, "").split("/")[0] || "";
  if (!origin.startsWith("https://")) return false;
  if (!host || host === "localhost" || host.startsWith("127.")) return false;
  if (isCreatorPlatformShop(shop) && /staging/i.test(host)) return false;
  return true;
}

function printifyToken(): string {
  return String(process.env.PRINTIFY_API_TOKEN || "").trim();
}

async function printifyTokenForShop(shop: string): Promise<string> {
  const envTok = printifyToken();
  try {
    const installation = await storage.getShopifyInstallationByShop(shop);
    if (installation?.merchantId) {
      const merchant = await storage.getMerchant(installation.merchantId);
      const tok = String(merchant?.printifyApiToken || "").trim();
      if (tok) return tok;
    }
  } catch {
    /* fall through */
  }
  return envTok;
}

export async function fetchPrintifyShippingTable(
  blueprintId: number,
  providerId: number,
  apiToken: string,
): Promise<ShippingTable> {
  const cacheKey = `${blueprintId}:${providerId}`;
  const hit = tableCache.get(cacheKey);
  if (hit && Date.now() - hit.fetchedAt < TABLE_TTL_MS) return hit;

  const headers = {
    Authorization: `Bearer ${apiToken}`,
    "Content-Type": "application/json",
  };
  const listResp = await fetch(
    `https://api.printify.com/v2/catalog/blueprints/${blueprintId}/print_providers/${providerId}/shipping.json`,
    { headers },
  );
  if (!listResp.ok) {
    throw new Error(`Printify shipping list ${listResp.status}`);
  }
  const listData = (await listResp.json()) as { data?: Array<{ attributes?: { name?: string } }> };
  const tiers = (listData.data || []).map((m) => m.attributes?.name).filter(Boolean) as string[];
  const ordered = [...tiers].sort((a, b) => {
    const rank = (t: string) =>
      /econom/i.test(t) ? 0 : /standard|ground/i.test(t) ? 1 : 2;
    return rank(a) - rank(b);
  });

  const table: ShippingTable = { fetchedAt: Date.now(), tiers: {} };
  await Promise.all(
    ordered.slice(0, 2).map(async (tier) => {
      const tierResp = await fetch(
        `https://api.printify.com/v2/catalog/blueprints/${blueprintId}/print_providers/${providerId}/shipping/${encodeURIComponent(tier)}.json`,
        { headers },
      );
      if (!tierResp.ok) return;
      const tierData = (await tierResp.json()) as { data?: any[] };
      const byVariant: Record<string, Record<string, ShippingCell>> = {};
      for (const entry of tierData.data || []) {
        const variantId = entry.attributes?.variantId;
        const country = String(entry.attributes?.country?.code || "").toUpperCase();
        const first = Number(entry.attributes?.shippingCost?.firstItem?.amount);
        const extra = Number(entry.attributes?.shippingCost?.additionalItems?.amount);
        if (variantId == null || !country || !Number.isFinite(first)) continue;
        const vid = String(variantId);
        if (!byVariant[vid]) byVariant[vid] = {};
        byVariant[vid][country] = {
          firstItemCents: Math.round(first),
          additionalItemCents: Number.isFinite(extra) ? Math.round(extra) : Math.round(first),
        };
      }
      table.tiers[tier] = byVariant;
    }),
  );
  tableCache.set(cacheKey, table);
  return table;
}

function cellFor(
  table: ShippingTable,
  tier: string,
  variantId: string,
  country: string,
): ShippingCell | null {
  const byVariant = table.tiers[tier];
  if (!byVariant) return null;
  const byCountry = byVariant[variantId] || byVariant["*"];
  if (!byCountry) return null;
  for (const key of countryLookupKeys(country)) {
    if (byCountry[key]) return byCountry[key];
  }
  return null;
}

async function usdToShopRate(shopCurrency: string): Promise<number> {
  const currency = String(shopCurrency || "USD").trim().toUpperCase() || "USD";
  if (currency === "USD") return 1;
  if (fxCache && Date.now() - fxCache.at < FX_TTL_MS && fxCache.usdTo[currency]) {
    return fxCache.usdTo[currency];
  }
  try {
    const res = await fetch(`https://api.frankfurter.app/latest?from=USD&to=${encodeURIComponent(currency)}`);
    if (res.ok) {
      const json = (await res.json()) as { rates?: Record<string, number> };
      const rate = Number(json.rates?.[currency]);
      if (rate > 0) {
        fxCache = { at: Date.now(), usdTo: { ...(fxCache?.usdTo || {}), [currency]: rate } };
        return rate;
      }
    }
  } catch {
    /* fallback */
  }
  const envKey = `PRINTIFY_SHIPPING_USD_${currency}`;
  const envRate = Number(process.env[envKey] || process.env.PRINTIFY_SHIPPING_USD_AUD || 0);
  return envRate > 0 ? envRate : 1;
}

async function resolveLineIdentity(
  shop: string,
  raw: any,
): Promise<{
  skip: boolean;
  reason?: string;
  blueprintId?: number;
  providerId?: number;
  printifyVariantId?: string;
  quantity: number;
} | null> {
  const line = normalizeShopifyOrderLine(raw);
  const qty = Math.max(1, line.quantity || Number(raw?.quantity) || 1);
  const props = line.properties || {};
  const sku = String(raw?.sku || "");
  if (
    raw?.requires_shipping === false ||
    isCreatorCreditPackLine(props, sku) ||
    isMerchantCreditPackLine(props, sku)
  ) {
    return { skip: true, reason: "no_shipping", quantity: qty };
  }

  let blueprintId = Number(props._printify_blueprint_id || 0);
  let providerId = Number(props._printify_provider_id || 0);
  let printifyVariantId = String(props._printify_variant_id || "").trim();
  let productTypeId = Number(props._product_type_id || 0);

  if ((!blueprintId || !providerId || !printifyVariantId) && productTypeId > 0) {
    const pt = await storage.getProductType(productTypeId);
    if (pt) {
      if (!blueprintId) blueprintId = Number(pt.printifyBlueprintId || 0);
      if (!providerId) providerId = Number(pt.printifyProviderId || 0);
      if (!printifyVariantId) {
        try {
          const map = JSON.parse(pt.variantMap || "{}");
          const resolved = resolveVariantFromMap(map, props._size, props._color || "default");
          if (resolved?.entry?.printifyVariantId != null) {
            printifyVariantId = String(resolved.entry.printifyVariantId);
          }
        } catch {
          /* ignore */
        }
      }
    }
  }

  if ((!blueprintId || !printifyVariantId) && shop) {
    const shadowVid = String(raw?.variant_id || line.variantId || "").replace(/\D/g, "");
    if (shadowVid) {
      const [mapping] = await db
        .select()
        .from(designSkuMappings)
        .where(eq(designSkuMappings.shadowShopifyVariantId, shadowVid))
        .limit(1);
      const sourceVid = mapping?.sourceVariantId || props._base_variant_id;
      if (sourceVid) {
        const [page] = await db
          .select()
          .from(customizerPages)
          .where(eq(customizerPages.baseVariantId, String(sourceVid)))
          .limit(1);
        if (page?.productTypeId && !productTypeId) {
          productTypeId = page.productTypeId;
          const pt = await storage.getProductType(productTypeId);
          if (pt) {
            blueprintId = blueprintId || Number(pt.printifyBlueprintId || 0);
            providerId = providerId || Number(pt.printifyProviderId || 0);
            if (!printifyVariantId) {
              try {
                const map = JSON.parse(pt.variantMap || "{}");
                const resolved = resolveVariantFromMap(map, props._size, props._color || "default");
                if (resolved?.entry?.printifyVariantId != null) {
                  printifyVariantId = String(resolved.entry.printifyVariantId);
                }
              } catch {
                /* ignore */
              }
            }
          }
        }
      }
    }
  }

  if (!blueprintId || !providerId || !printifyVariantId) {
    return { skip: false, reason: "unresolved", quantity: qty };
  }
  return { skip: false, blueprintId, providerId, printifyVariantId, quantity: qty };
}

export async function quoteShopifyCarrierRates(params: {
  shop: string;
  destinationCountry: string;
  currency: string;
  items: any[];
}): Promise<ShopifyCarrierRate[]> {
  const shop = normalizeMyshopifyShopDomain(params.shop);
  const token = await printifyTokenForShop(shop);
  if (!token) {
    console.warn("[carrier-shipping] no Printify token");
    return [];
  }

  const physical: Array<{
    blueprintId: number;
    providerId: number;
    printifyVariantId: string;
    quantity: number;
  }> = [];
  for (const raw of params.items || []) {
    const resolved = await resolveLineIdentity(shop, raw);
    if (!resolved || resolved.skip) continue;
    if (resolved.reason === "unresolved" || !resolved.blueprintId || !resolved.providerId || !resolved.printifyVariantId) {
      console.warn("[carrier-shipping] unresolved line", { shop, sku: raw?.sku });
      return [];
    }
    physical.push({
      blueprintId: resolved.blueprintId,
      providerId: resolved.providerId,
      printifyVariantId: resolved.printifyVariantId,
      quantity: resolved.quantity,
    });
  }
  if (!physical.length) return [];

  const tables = new Map<string, ShippingTable>();
  for (const line of physical) {
    const key = `${line.blueprintId}:${line.providerId}`;
    if (!tables.has(key)) {
      tables.set(key, await fetchPrintifyShippingTable(line.blueprintId, line.providerId, token));
    }
  }

  const tableList = [...tables.values()];
  let tierNames = tableList[0] ? Object.keys(tableList[0].tiers) : [];
  for (const table of tableList.slice(1)) {
    const names = new Set(Object.keys(table.tiers));
    tierNames = tierNames.filter((name) => names.has(name));
  }

  const fx = await usdToShopRate(params.currency);
  const rates: ShopifyCarrierRate[] = [];
  const pushRate = (tier: string, quoteLines: PrintifyShippingLineQuote[]) => {
    const usd = quotePrintifyLinesUsdCents(quoteLines);
    const shopAmt = convertUsdCentsToShop(usd, params.currency, fx);
    const pretty = /econom/i.test(tier) ? "Economy" : /express|priority/i.test(tier) ? "Express" : "Standard";
    rates.push({
      service_name: pretty,
      service_code: `appai_${tier.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}`,
      description: "Print partner shipping",
      currency: shopAmt.currency,
      total_price: String(shopAmt.amountCents),
    });
  };

  for (const tier of tierNames.slice(0, 2)) {
    const quoteLines: PrintifyShippingLineQuote[] = [];
    let ok = true;
    for (const line of physical) {
      const table = tables.get(`${line.blueprintId}:${line.providerId}`);
      if (!table) {
        ok = false;
        break;
      }
      const cell = cellFor(table, tier, line.printifyVariantId, params.destinationCountry);
      if (!cell) {
        ok = false;
        break;
      }
      quoteLines.push({
        groupKey: `${line.blueprintId}:${line.providerId}`,
        variantKey: line.printifyVariantId,
        quantity: line.quantity,
        firstItemCents: cell.firstItemCents,
        additionalItemCents: cell.additionalItemCents,
      });
    }
    if (!ok) continue;
    pushRate(tier, quoteLines);
  }

  if (!rates.length) {
    const quoteLines: PrintifyShippingLineQuote[] = [];
    let ok = true;
    for (const line of physical) {
      const table = tables.get(`${line.blueprintId}:${line.providerId}`);
      if (!table) {
        ok = false;
        break;
      }
      let cell: ShippingCell | null = null;
      for (const tier of Object.keys(table.tiers)) {
        cell = cellFor(table, tier, line.printifyVariantId, params.destinationCountry);
        if (cell) break;
      }
      if (!cell) {
        ok = false;
        break;
      }
      quoteLines.push({
        groupKey: `${line.blueprintId}:${line.providerId}`,
        variantKey: line.printifyVariantId,
        quantity: line.quantity,
        firstItemCents: cell.firstItemCents,
        additionalItemCents: cell.additionalItemCents,
      });
    }
    if (ok && quoteLines.length) pushRate("Standard", quoteLines);
  }
  return rates;
}

type GqlCarrier = { id: string; name?: string | null; callbackUrl?: string | null; active?: boolean | null };

function scopeDenied(text: string): boolean {
  return /access denied|write_shipping|insufficient|forbidden/i.test(text);
}

function planBlocked(text: string): boolean {
  return /not available|plan|upgrade|advanced|annual/i.test(text) && /carrier|shipping/i.test(text);
}

async function shopifyAdminGraphql<T>(
  shop: string,
  accessToken: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<{ ok: true; data: T } | { ok: false; reason: string }> {
  const res = await fetch(`https://${shop}/admin/api/${ADMIN_API}/graphql.json`, {
    method: "POST",
    headers: {
      "X-Shopify-Access-Token": accessToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    data?: T;
    errors?: Array<{ message?: string }>;
  };
  const errText = (json.errors || []).map((e) => e.message || "").filter(Boolean).join("; ");
  if (res.status === 403 || scopeDenied(errText)) {
    return { ok: false, reason: "missing write_shipping scope — reinstall the Creators app" };
  }
  if (!res.ok) return { ok: false, reason: `graphql ${res.status} ${errText.slice(0, 180)}` };
  if (errText) {
    if (planBlocked(errText)) {
      return {
        ok: false,
        reason:
          "Shopify only allows app carriers on Advanced (or higher), annual billing, or a development store. Check Settings → Plan.",
      };
    }
    return { ok: false, reason: errText.slice(0, 240) };
  }
  return { ok: true, data: json.data as T };
}

async function attachCarrierToShippingProfiles(params: {
  shop: string;
  accessToken: string;
  carrierId: string;
}): Promise<string> {
  const listed = await shopifyAdminGraphql<{
    deliveryProfiles: {
      edges: Array<{
        node: {
          id: string;
          profileLocationGroups: Array<{
            locationGroup: { id: string };
            locationGroupZones: {
              edges: Array<{
                node: {
                  zone: { id: string; name?: string | null };
                  methodDefinitions: {
                    edges: Array<{
                      node: {
                        id: string;
                        rateProvider?: { carrierService?: { id?: string } | null } | null;
                      };
                    }>;
                  };
                };
              }>;
            };
          }>;
        };
      }>;
    };
  }>(
    params.shop,
    params.accessToken,
    `query {
      deliveryProfiles(first: 8) {
        edges {
          node {
            id
            profileLocationGroups {
              locationGroup { id }
              locationGroupZones(first: 40) {
                edges {
                  node {
                    zone { id name }
                    methodDefinitions(first: 30) {
                      edges {
                        node {
                          id
                          rateProvider {
                            ... on DeliveryParticipant {
                              carrierService { id }
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
        }
      }
    }`,
  );
  if (!listed.ok) return `profiles ${listed.reason}`;

  let attached = 0;
  for (const profileEdge of listed.data.deliveryProfiles?.edges || []) {
    const profile = profileEdge.node;
    for (const group of profile.profileLocationGroups || []) {
      const zonesToUpdate = [];
      for (const zoneEdge of group.locationGroupZones?.edges || []) {
        const zoneNode = zoneEdge.node;
        const already = (zoneNode.methodDefinitions?.edges || []).some(
          (edge) => edge.node.rateProvider?.carrierService?.id === params.carrierId,
        );
        if (already || !zoneNode.zone?.id) continue;
        zonesToUpdate.push({
          id: zoneNode.zone.id,
          methodDefinitionsToCreate: [
            {
              name: CARRIER_NAME,
              active: true,
              participant: {
                carrierServiceId: params.carrierId,
                adaptToNewServices: true,
              },
            },
          ],
        });
      }
      if (!zonesToUpdate.length) continue;
      const updated = await shopifyAdminGraphql(
        params.shop,
        params.accessToken,
        `mutation AttachCarrier($id: ID!, $profile: DeliveryProfileInput!) {
          deliveryProfileUpdate(id: $id, profile: $profile) {
            userErrors { message }
          }
        }`,
        {
          id: profile.id,
          profile: {
            locationGroupsToUpdate: [{ id: group.locationGroup.id, zonesToUpdate }],
          },
        },
      );
      if (updated.ok) attached += zonesToUpdate.length;
    }
  }
  return attached ? `attached:${attached}` : "profiles unchanged";
}

async function restListCarriers(
  shop: string,
  accessToken: string,
): Promise<
  | { ok: true; carriers: Array<{ id: number; name?: string; callback_url?: string }> }
  | { ok: false; reason: string }
> {
  const res = await fetch(`https://${shop}/admin/api/${ADMIN_API}/carrier_services.json`, {
    headers: {
      "X-Shopify-Access-Token": accessToken,
      "Content-Type": "application/json",
    },
  });
  if (res.status === 403) {
    return { ok: false, reason: "missing write_shipping scope — reinstall the Creators app" };
  }
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    if (planBlocked(errText) || /not available|plan/i.test(errText)) {
      return {
        ok: false,
        reason:
          "Shopify only allows app carriers on Advanced (or higher), annual billing, or a development store. Check Settings → Plan.",
      };
    }
    return { ok: false, reason: `list ${res.status} ${errText.slice(0, 160)}` };
  }
  const listed = (await res.json()) as {
    carrier_services?: Array<{ id: number; name?: string; callback_url?: string }>;
  };
  return { ok: true, carriers: listed.carrier_services || [] };
}

export async function ensureShopifyCarrierService(params: {
  shop: string;
  accessToken: string;
}): Promise<{ ok: boolean; reason?: string }> {
  const shop = normalizeMyshopifyShopDomain(params.shop);
  const origin = String(process.env.APP_URL || process.env.PUBLIC_APP_URL || "")
    .trim()
    .replace(/\/$/, "");
  if (!shop || !params.accessToken) return { ok: false, reason: "missing shop or token" };
  if (!canRegisterCarrierService(origin, shop)) {
    return { ok: false, reason: "origin not allowed for this shop" };
  }
  const callback = carrierServiceCallbackUrl(origin);
  const listed = await restListCarriers(shop, params.accessToken);
  if (!listed.ok) return listed;

  const existing = listed.carriers.find(
    (c) => c.name === CARRIER_NAME || String(c.callback_url || "").includes("/shopify/carrier-service/"),
  );
  const existingGid = existing?.id ? `gid://shopify/DeliveryCarrierService/${existing.id}` : "";

  let carrierId = existingGid;
  let action = "exists";
  if (existing?.id && String(existing.callback_url || "") !== callback) {
    const updated = await shopifyAdminGraphql<{
      carrierServiceUpdate?: { carrierService?: GqlCarrier; userErrors?: Array<{ message?: string }> };
    }>(
      shop,
      params.accessToken,
      `mutation UpdateCarrier($input: DeliveryCarrierServiceUpdateInput!) {
        carrierServiceUpdate(input: $input) {
          carrierService { id name callbackUrl active }
          userErrors { message }
        }
      }`,
      {
        input: {
          id: existingGid,
          name: CARRIER_NAME,
          callbackUrl: callback,
          active: true,
          supportsServiceDiscovery: true,
        },
      },
    );
    const err = updated.ok
      ? (updated.data.carrierServiceUpdate?.userErrors || []).map((e) => e.message).filter(Boolean).join("; ")
      : updated.reason;
    if (err) return { ok: false, reason: err.slice(0, 240) };
    carrierId = updated.ok ? updated.data.carrierServiceUpdate?.carrierService?.id || existingGid : existingGid;
    action = "updated";
  } else if (!existing?.id) {
    const created = await shopifyAdminGraphql<{
      carrierServiceCreate?: { carrierService?: GqlCarrier; userErrors?: Array<{ message?: string }> };
    }>(
      shop,
      params.accessToken,
      `mutation CreateCarrier($input: DeliveryCarrierServiceCreateInput!) {
        carrierServiceCreate(input: $input) {
          carrierService { id name callbackUrl active }
          userErrors { message }
        }
      }`,
      {
        input: {
          name: CARRIER_NAME,
          callbackUrl: callback,
          active: true,
          supportsServiceDiscovery: true,
        },
      },
    );
    const err = created.ok
      ? (created.data.carrierServiceCreate?.userErrors || []).map((e) => e.message).filter(Boolean).join("; ")
      : created.reason;
    carrierId = created.ok ? created.data.carrierServiceCreate?.carrierService?.id || "" : "";
    if (!carrierId) {
      const restCreate = await fetch(`https://${shop}/admin/api/${ADMIN_API}/carrier_services.json`, {
        method: "POST",
        headers: {
          "X-Shopify-Access-Token": params.accessToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          carrier_service: {
            name: CARRIER_NAME,
            callback_url: callback,
            service_discovery: true,
            active: true,
          },
        }),
      });
      const restText = await restCreate.text().catch(() => "");
      if (restCreate.ok) {
        const body = JSON.parse(restText || "{}") as { carrier_service?: { id?: number } };
        carrierId = body.carrier_service?.id
          ? `gid://shopify/DeliveryCarrierService/${body.carrier_service.id}`
          : "";
      }
      if (!carrierId) {
        const combined = `${err || ""} ${restText}`.trim();
        if (planBlocked(combined) || /not available|plan/i.test(combined)) {
          return {
            ok: false,
            reason:
              "Shopify only allows app carriers on Advanced (or higher), annual billing, or a development store. Check Settings → Plan.",
          };
        }
        return { ok: false, reason: (combined || "carrier create returned no id").slice(0, 280) };
      }
    }
    action = "created";
  }

  const profiles = await attachCarrierToShippingProfiles({
    shop,
    accessToken: params.accessToken,
    carrierId,
  }).catch((e: any) => e?.message || "profiles failed");
  return { ok: true, reason: `${action}; ${profiles}` };
}

export async function ensurePlatformCarrierService(): Promise<{ ok: boolean; reason?: string }> {
  if (!isCreatorMarketplaceEnabled()) return { ok: false, reason: "marketplace off" };
  const candidates = getCreatorPlatformShopCandidates()
    .map((s) => normalizeMyshopifyShopDomain(s))
    .filter((s) => s.endsWith(".myshopify.com"));
  if (!candidates.length) {
    const shop = normalizeMyshopifyShopDomain(getCreatorPlatformShopDomain());
    if (!shop) return { ok: false, reason: "no platform shop" };
    candidates.push(shop);
  }
  let installation = null;
  for (const candidate of candidates) {
    const row = await storage.getShopifyInstallationByShop(candidate);
    if (row?.accessToken && row.accessToken !== "NEEDS_RECONNECT") {
      installation = row;
      break;
    }
  }
  if (!installation?.accessToken) return { ok: false, reason: "no install token" };
  const refreshed = await ensureValidOfflineAccessToken(installation);
  const accessToken = refreshed.ok ? refreshed.accessToken : installation.accessToken;
  if (!accessToken) return { ok: false, reason: "no install token" };
  return ensureShopifyCarrierService({ shop: installation.shopDomain, accessToken });
}

export function parseCarrierRateRequest(body: any): {
  destinationCountry: string;
  currency: string;
  items: any[];
} {
  const rate = body?.rate || body || {};
  const dest = rate.destination || {};
  const country = String(dest.country || dest.country_code || "").trim();
  const currency = String(rate.currency || "USD").trim().toUpperCase() || "USD";
  const items = Array.isArray(rate.items) ? rate.items : [];
  return { destinationCountry: country, currency, items };
}
