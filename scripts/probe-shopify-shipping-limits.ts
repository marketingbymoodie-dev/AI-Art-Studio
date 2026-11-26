/**
 * R2 probe — measure practical Shopify delivery-profile limits on a live shop:
 *
 *   1. Max weight-based method definitions ("rates") per zone. Shopify has no
 *      documented hard cap; Printify/Printful docs mention 12 per profile/region.
 *      This gates DEFAULT_BAND_CONFIG.maxBands (closed bands = cap - 1, last
 *      slot reserved for the open band).
 *   2. Zones per profile (sanity check for the collapsed-zone design).
 *
 * Uses the same rate shape the Phase 3 reconciler writes: every method def is
 * named "Standard Shipping" with contiguous non-overlapping weight brackets.
 *
 * Creates one scratch profile ("AppAI limits probe — safe to delete"), probes
 * incrementally, then deletes it. A profile with no products assigned never
 * affects live checkout.
 *
 * Usage:
 *   npx tsx scripts/probe-shopify-shipping-limits.ts [--shop <domain>] [--max-rates 40] [--max-zones 40]
 *
 * The shop's stored offline token is used directly (read from DB). If it is
 * expired, run any storefront request against the shop's Railway server first
 * so the server refreshes it, or re-run via an environment with app credentials.
 */
import "../server/load-env";
import { storage } from "../server/storage";

const ADMIN_API = "2025-10";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const SHOP = arg("shop", "ai-art-studio-staging.myshopify.com");
const MAX_RATES_TO_TRY = parseInt(arg("max-rates", "40"), 10);
const MAX_ZONES_TO_TRY = parseInt(arg("max-zones", "40"), 10);
const RATE_BATCH = 4;
const ZONE_BATCH = 5;

/** Two-letter codes for zone-count probing (each becomes its own single-country zone). */
const ZONE_COUNTRIES = [
  "GB", "DE", "FR", "IT", "ES", "NL", "BE", "AT", "SE", "DK",
  "FI", "NO", "IE", "PT", "PL", "CZ", "HU", "RO", "GR", "CH",
  "JP", "KR", "SG", "MY", "TH", "PH", "VN", "IN", "AE", "SA",
  "IL", "TR", "ZA", "EG", "BR", "AR", "CL", "CO", "PE", "UY",
];

let accessToken = "";

async function gql<T = any>(query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await fetch(`https://${SHOP}/admin/api/${ADMIN_API}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    body: JSON.stringify({ query, variables }),
  });
  const body: any = await res.json();
  if (!res.ok || body.errors) {
    throw new Error(`GraphQL HTTP ${res.status}: ${JSON.stringify(body.errors ?? body)}`);
  }
  return body.data as T;
}

function methodDef(index: number) {
  // Contiguous 1kg brackets, all named identically like the real reconciler output.
  return {
    name: "Standard Shipping",
    active: true,
    rateDefinition: { price: { amount: (4 + index).toFixed(2), currencyCode: shopCurrency } },
    weightConditionsToCreate: [
      { criteria: { unit: "GRAMS", value: index * 1000 }, operator: "GREATER_THAN_OR_EQUAL_TO" },
      { criteria: { unit: "GRAMS", value: (index + 1) * 1000 - 1 }, operator: "LESS_THAN_OR_EQUAL_TO" },
    ],
  };
}

let shopCurrency = "USD";

async function main() {
  const inst = await storage.getShopifyInstallationByShop(SHOP);
  if (!inst?.accessToken) throw new Error(`No installation/token for ${SHOP}`);
  const expiresAt = inst.accessTokenExpiresAt ? new Date(inst.accessTokenExpiresAt).getTime() : null;
  if (expiresAt !== null && expiresAt < Date.now() + 60_000) {
    throw new Error(
      `Stored token for ${SHOP} is expired (${new Date(expiresAt).toISOString()}). ` +
        `Trigger a server-side refresh first (any storefront API request against the shop's Railway app).`,
    );
  }
  accessToken = inst.accessToken;

  const shopInfo = await gql<{ shop: { currencyCode: string } }>(
    `query { shop { currencyCode } }`,
    {},
  );
  shopCurrency = shopInfo.shop.currencyCode;
  // read_locations is not granted on the staging demo token; an empty location
  // group is sufficient for limit probing (the profile never serves checkout).
  let locationIds: string[] = [];
  try {
    const locs = await gql<{ locations: { nodes: any[] } }>(
      `query { locations(first: 10) { nodes { id name isActive } } }`,
      {},
    );
    locationIds = locs.locations.nodes.filter((l) => l.isActive).map((l) => l.id);
  } catch {
    console.log("locations query not permitted (missing read_locations) — probing with empty location group");
  }
  console.log(`shop=${SHOP} currency=${shopCurrency} locations=${locationIds.length}`);

  // ── Create scratch profile: 1 US zone, 1 rate ────────────────────────────
  const created = await gql<any>(
    `mutation deliveryProfileCreate($profile: DeliveryProfileInput!) {
      deliveryProfileCreate(profile: $profile) {
        profile {
          id
          profileLocationGroups {
            locationGroup { id }
            locationGroupZones(first: 5) {
              edges { node { zone { id name } } }
            }
          }
        }
        userErrors { field message }
      }
    }`,
    {
      profile: {
        name: "AppAI limits probe — safe to delete",
        locationGroupsToCreate: [
          {
            locations: locationIds,
            zonesToCreate: [
              {
                name: "Probe US",
                countries: [{ code: "US", includeAllProvinces: true }],
                methodDefinitionsToCreate: [methodDef(0)],
              },
            ],
          },
        ],
      },
    },
  );
  const createErrors = created.deliveryProfileCreate.userErrors;
  if (createErrors?.length) throw new Error(`profile create failed: ${JSON.stringify(createErrors)}`);
  const profile = created.deliveryProfileCreate.profile;
  const profileId: string = profile.id;
  const locationGroupId: string = profile.profileLocationGroups[0].locationGroup.id;
  const usZoneId: string = profile.profileLocationGroups[0].locationGroupZones.edges[0].node.zone.id;
  console.log(`scratch profile created: ${profileId}`);

  const cleanup = async () => {
    try {
      const removed = await gql<any>(
        `mutation deliveryProfileRemove($id: ID!) {
          deliveryProfileRemove(id: $id) {
            job { id }
            userErrors { field message }
          }
        }`,
        { id: profileId },
      );
      const errs = removed.deliveryProfileRemove.userErrors;
      console.log(errs?.length ? `CLEANUP userErrors: ${JSON.stringify(errs)}` : "scratch profile deleted");
    } catch (e: any) {
      console.error(`CLEANUP FAILED — delete manually in admin: ${profileId}:`, e?.message || e);
    }
  };

  try {
    // ── Probe 1: rates per zone ────────────────────────────────────────────
    let ratesOk = 1;
    let ratesError: string | null = null;
    while (ratesOk < MAX_RATES_TO_TRY) {
      const batchSize = Math.min(RATE_BATCH, MAX_RATES_TO_TRY - ratesOk);
      const defs = Array.from({ length: batchSize }, (_, i) => methodDef(ratesOk + i));
      try {
        const updated = await gql<any>(
          `mutation deliveryProfileUpdate($id: ID!, $profile: DeliveryProfileInput!) {
            deliveryProfileUpdate(id: $id, profile: $profile) {
              profile { id }
              userErrors { field message }
            }
          }`,
          {
            id: profileId,
            profile: {
              locationGroupsToUpdate: [
                {
                  id: locationGroupId,
                  zonesToUpdate: [{ id: usZoneId, methodDefinitionsToCreate: defs }],
                },
              ],
            },
          },
        );
        const errs = updated.deliveryProfileUpdate.userErrors;
        if (errs?.length) {
          ratesError = JSON.stringify(errs);
          break;
        }
        ratesOk += batchSize;
        console.log(`  rates in US zone now: ${ratesOk}`);
      } catch (e: any) {
        ratesError = String(e?.message || e);
        break;
      }
    }

    // Verify actual persisted count (userError-free responses can still clamp).
    const verify = await gql<any>(
      `query($id: ID!) {
        deliveryProfile(id: $id) {
          profileLocationGroups {
            locationGroupZones(first: 50) {
              edges { node { zone { id name } methodDefinitions(first: 100) { edges { node { id } } } } }
            }
          }
        }
      }`,
      { id: profileId },
    );
    const zonesNow = verify.deliveryProfile.profileLocationGroups[0].locationGroupZones.edges;
    const usZone = zonesNow.find((e: any) => e.node.zone.id === usZoneId);
    const persistedRates = usZone?.node.methodDefinitions.edges.length ?? -1;

    console.log("");
    console.log(`RATES PER ZONE: accepted=${ratesOk} persisted=${persistedRates} triedUpTo=${MAX_RATES_TO_TRY}`);
    console.log(ratesError ? `  stopped by error: ${ratesError}` : `  no error up to ${ratesOk}`);

    // ── Probe 2: zones per profile ─────────────────────────────────────────
    let zonesOk = 1; // the US zone
    let zonesError: string | null = null;
    while (zonesOk < MAX_ZONES_TO_TRY) {
      const batch = ZONE_COUNTRIES.slice(zonesOk - 1, zonesOk - 1 + ZONE_BATCH);
      if (batch.length === 0) break;
      const zonesToCreate = batch.map((code) => ({
        name: `Probe ${code}`,
        countries: [{ code, includeAllProvinces: true }],
        methodDefinitionsToCreate: [methodDef(0)],
      }));
      try {
        const updated = await gql<any>(
          `mutation deliveryProfileUpdate($id: ID!, $profile: DeliveryProfileInput!) {
            deliveryProfileUpdate(id: $id, profile: $profile) {
              profile { id }
              userErrors { field message }
            }
          }`,
          {
            id: profileId,
            profile: {
              locationGroupsToUpdate: [{ id: locationGroupId, zonesToCreate }],
            },
          },
        );
        const errs = updated.deliveryProfileUpdate.userErrors;
        if (errs?.length) {
          zonesError = JSON.stringify(errs);
          break;
        }
        zonesOk += batch.length;
        console.log(`  zones in profile now: ${zonesOk}`);
      } catch (e: any) {
        zonesError = String(e?.message || e);
        break;
      }
    }
    console.log("");
    console.log(`ZONES PER PROFILE: accepted=${zonesOk} triedUpTo=${MAX_ZONES_TO_TRY}`);
    console.log(zonesError ? `  stopped by error: ${zonesError}` : `  no error up to ${zonesOk}`);
  } finally {
    await cleanup();
  }

  process.exit(0);
}

main().catch(async (e) => {
  console.error("PROBE FAILED:", e?.message || e);
  process.exit(1);
});
