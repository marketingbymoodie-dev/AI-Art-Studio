/**
 * Shared PreShadow mint + per-key in-flight join.
 * Key is shop::job::catalogVariant::cfgHash (the persist designId).
 * A 16x16 in-flight mint never satisfies a 20x20 ATC.
 */
import { buildShadowProductTitle } from "@shared/planEstimator";
import {
  hasPrintConfigSuffix,
  shadowLookupKeys,
  shadowMatchesBaseVariant,
} from "@shared/shadowDesignId";
import { storage } from "./storage";
import { ensureShadowVariantPurchasable } from "./shadow-variant-purchasable";
import { ShadowStorefrontNotReadyError, assertAjaxVariantVisible } from "./shadow-storefront-visible";
import { syncShadowVariantPrice } from "./shadow-variant-price";
import type { PrintConfigFingerprintInput } from "@shared/printConfigFingerprint";
import { PRE_SHADOW_AWAIT_MS } from "@shared/atcStorefrontRetry";

export { PRE_SHADOW_AWAIT_MS };

type FlightValue = { shopifyProductId: string; shopifyVariantId: string } | void;
const preShadowInFlight = new Map<string, Promise<FlightValue>>();

export function preShadowFlightKey(shop: string, designId: string): string {
  return `${shop}::${designId}`;
}

export function getPreShadowInFlight(key: string): Promise<FlightValue> | undefined {
  return preShadowInFlight.get(key);
}

/** Register ATC resolve's create so a trailing debounce cannot mint a second product. */
export function registerPreShadowInFlight(
  key: string,
  run: Promise<FlightValue>,
): boolean {
  if (preShadowInFlight.has(key)) return false;
  preShadowInFlight.set(key, run);
  void run.finally(() => {
    if (preShadowInFlight.get(key) === run) preShadowInFlight.delete(key);
  });
  return true;
}

export async function awaitExistingFlight(
  key: string,
  timeoutMs = PRE_SHADOW_AWAIT_MS,
): Promise<"none" | "joined" | "timeout"> {
  const existing = preShadowInFlight.get(key);
  if (!existing) return "none";
  console.log(`[PreShadow] ATC joining in-flight ${key}`);
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      existing.then(() => "joined" as const),
      new Promise<"timeout">((resolve) => {
        timeoutId = setTimeout(() => resolve("timeout"), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export async function awaitInFlightOrGenerate(
  key: string,
  generate: () => Promise<FlightValue>,
  timeoutMs = PRE_SHADOW_AWAIT_MS,
): Promise<{ status: "ok"; value: FlightValue } | { status: "timeout" }> {
  const existing = preShadowInFlight.get(key);
  const run = existing ?? generate();
  if (!existing) {
    preShadowInFlight.set(key, run);
    void run.finally(() => {
      if (preShadowInFlight.get(key) === run) preShadowInFlight.delete(key);
    });
  } else {
    console.log(`[PreShadow] already in flight — joining ${key}`);
  }
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      run.then((value) => ({ status: "ok" as const, value })),
      new Promise<{ status: "timeout" }>((resolve) => {
        timeoutId = setTimeout(() => resolve({ status: "timeout" }), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export async function runPreShadowMint(args: {
  shop: string;
  token: string;
  jobId: string;
  baseProductId: string;
  baseVariantId: string;
  primaryMockupUrl: string;
  designId: string;
  cfgSnapshot: PrintConfigFingerprintInput;
  priceOverride: string | null;
}): Promise<FlightValue> {
  const {
    shop,
    token,
    jobId,
    baseProductId,
    baseVariantId,
    primaryMockupUrl,
    designId,
    cfgSnapshot,
    priceOverride,
  } = args;
  const apiBase = `https://${shop}/admin/api/2025-10`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Shopify-Access-Token": token,
  };
  const catalogVid = String(baseVariantId ?? "").replace(/\D/g, "");

  const writeJobShadow = async (patch: {
    shadowProductId: string | null;
    shadowVariantId: string | null;
    shadowExpiresAt: Date | null;
  }) => {
    if (!cfgSnapshot || !designId || !catalogVid) return;
    const fresh = await storage.getGenerationJob(jobId);
    const prevDs =
      fresh?.designState && typeof fresh.designState === "object" && !Array.isArray(fresh.designState)
        ? (fresh.designState as Record<string, unknown>)
        : {};
    const prevMap =
      prevDs.preShadowByVariant &&
      typeof prevDs.preShadowByVariant === "object" &&
      !Array.isArray(prevDs.preShadowByVariant)
        ? { ...(prevDs.preShadowByVariant as Record<string, unknown>) }
        : {};
    prevMap[catalogVid] = {
      designId,
      snapshot: cfgSnapshot,
      shadowProductId: patch.shadowProductId,
      shadowVariantId: patch.shadowVariantId,
      shadowExpiresAt: patch.shadowExpiresAt,
    };
    await storage.updateGenerationJob(jobId, {
      ...patch,
      designState: {
        ...prevDs,
        preShadowByVariant: prevMap,
        preShadowDesignId: designId,
        printConfigSnapshot: cfgSnapshot,
      },
    } as any);
  };

  const refreshShadowImage = async (productId: string, variantId: string) => {
    try {
      const imgRes = await fetch(`${apiBase}/products/${productId}/images.json`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          image: { src: primaryMockupUrl, variant_ids: [Number(variantId)] },
        }),
      });
      if (!imgRes.ok) {
        const t = await imgRes.text();
        console.warn(`[PreShadow] Failed to refresh shadow image:`, imgRes.status, t.substring(0, 200));
      }
    } catch (imgErr: any) {
      console.warn(`[PreShadow] Failed to refresh shadow image:`, imgErr?.message || imgErr);
    }
  };

  // Exact-key reuse first. Never mint a second product for the same persist id
  // (tap-during-debounce: ATC may have just created this row).
  let existing = await storage.getPublishedProduct(shop, designId);
  if ((!existing || existing.status !== "active") && !hasPrintConfigSuffix(designId)) {
    for (const key of shadowLookupKeys(jobId, primaryMockupUrl, baseVariantId)) {
      const row = await storage.getPublishedProduct(shop, key);
      if (row?.status !== "active") continue;
      if (!shadowMatchesBaseVariant(row.baseVariantId, baseVariantId)) continue;
      existing = row;
      break;
    }
  }
  if (
    existing &&
    existing.status === "active" &&
    shadowMatchesBaseVariant(existing.baseVariantId, baseVariantId)
  ) {
    console.log(
      `[PreShadow] jobId=${jobId} reusing existing shadow product ${existing.shopifyProductId} (key=${designId})`,
    );
    await ensureShadowVariantPurchasable({
      shop,
      token,
      variantId: existing.shopifyVariantId,
    });
    try {
      await assertAjaxVariantVisible({ shop, variantId: existing.shopifyVariantId, adminLive: true });
    } catch (e: any) {
      if (!(e instanceof ShadowStorefrontNotReadyError)) throw e;
      console.warn(
        `[PreShadow] jobId=${jobId} reused Admin live but Ajax not visible yet variant=${existing.shopifyVariantId} probe=${e.probe}`,
      );
    }
    await writeJobShadow({
      shadowProductId: existing.shopifyProductId,
      shadowVariantId: existing.shopifyVariantId,
      shadowExpiresAt: existing.expiresAt,
    });
    if (existing.shopifyProductId && existing.shopifyVariantId) {
      await refreshShadowImage(existing.shopifyProductId, existing.shopifyVariantId);
      await syncShadowVariantPrice({
        shop,
        token,
        shadowVariantId: existing.shopifyVariantId,
        baseVariantId,
        priceOverride,
      });
    }
    return {
      shopifyProductId: String(existing.shopifyProductId),
      shopifyVariantId: String(existing.shopifyVariantId),
    };
  }

  const productRes = await fetch(`${apiBase}/products/${baseProductId}.json`, { headers });
  if (!productRes.ok) {
    console.warn(`[PreShadow] Failed to fetch base product ${baseProductId}: ${productRes.status}`);
    return;
  }
  const { product: baseProduct } = await productRes.json();
  const baseVariant = baseProduct.variants.find((v: any) => String(v.id) === String(baseVariantId));
  if (!baseVariant) {
    console.warn(`[PreShadow] Base variant ${baseVariantId} not found on product ${baseProductId}`);
    return;
  }

  const variantOptionParts = [baseVariant.option1, baseVariant.option2, baseVariant.option3]
    .filter((o: any) => o && o !== "Default Title" && o !== "base")
    .join(" / ");
  const shadowTitle = buildShadowProductTitle(baseProduct.title, variantOptionParts);
  const oneHourFromNow = new Date(Date.now() + 1 * 60 * 60 * 1000);
  const createRes = await fetch(`${apiBase}/products.json`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      product: {
        title: shadowTitle,
        status: "unlisted",
        tags: "appai-shadow",
        variants: [
          {
            price: priceOverride || baseVariant.price,
            compare_at_price: baseVariant.compare_at_price || null,
            taxable: baseVariant.taxable,
            requires_shipping: baseVariant.requires_shipping,
            weight: baseVariant.weight,
            weight_unit: baseVariant.weight_unit,
            inventory_management: null,
            inventory_policy: "continue",
            fulfillment_service: "manual",
          },
        ],
        images: [{ src: primaryMockupUrl }],
      },
    }),
  });
  if (!createRes.ok) {
    const errText = await createRes.text();
    console.error(`[PreShadow] Failed to create shadow product: ${createRes.status}`, errText.substring(0, 200));
    return;
  }
  const { product: shadowProduct } = await createRes.json();
  const shadowVariant = shadowProduct.variants[0];
  console.log(
    `[PreShadow] Created shadow product ${shadowProduct.id} variant ${shadowVariant.id} for jobId=${jobId} derived=${designId} status=${shadowProduct.status} published_at=${shadowProduct.published_at ?? null}`,
  );
  await ensureShadowVariantPurchasable({
    shop,
    token,
    variantId: shadowVariant.id,
  });

  if (shadowProduct.images?.length > 0) {
    const imgId = shadowProduct.images[0].id;
    await fetch(`${apiBase}/products/${shadowProduct.id}/images/${imgId}.json`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ image: { id: imgId, variant_ids: [shadowVariant.id] } }),
    }).catch(() => {});
  }

  await storage.createPublishedProduct({
    shop,
    designId,
    customerKey: null,
    shopifyProductId: String(shadowProduct.id),
    shopifyVariantId: String(shadowVariant.id),
    shopifyProductHandle: shadowProduct.handle || null,
    baseVariantId: String(baseVariantId),
    status: "active",
    expiresAt: oneHourFromNow,
    cartAddedAt: null,
  } as any);

  await writeJobShadow({
    shadowProductId: String(shadowProduct.id),
    shadowVariantId: String(shadowVariant.id),
    shadowExpiresAt: oneHourFromNow,
  });

  import("./shipping-reconciler")
    .then((m) =>
      m.attachVariantToShipping({
        shop,
        shopifyVariantId: String(shadowVariant.id),
        sourceVariantId: String(baseVariantId),
        source: "shadow",
      }),
    )
    .catch((e: any) =>
      console.warn(`[PreShadow] shipping attach failed for ${shadowVariant.id}:`, e?.message),
    );

  try {
    await assertAjaxVariantVisible({ shop, variantId: shadowVariant.id, adminLive: true });
  } catch (e: any) {
    if (e instanceof ShadowStorefrontNotReadyError) {
      console.warn(
        `[PreShadow] jobId=${jobId} Admin live but Ajax not visible yet variant=${shadowVariant.id} probe=${e.probe}`,
      );
    } else {
      throw e;
    }
  }

  console.log(`[PreShadow] jobId=${jobId} shadow product ready — variantId=${shadowVariant.id}`);
  return {
    shopifyProductId: String(shadowProduct.id),
    shopifyVariantId: String(shadowVariant.id),
  };
}
