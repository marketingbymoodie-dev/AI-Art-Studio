/**
 * Apply merchant/customer billing after a successful generation.
 *
 * Billing model (Studio Credits — one charge per generation):
 *  - merchant       : merchant plan quota (no customer wallet)
 *  - customer_paid  : Studio Credit spend
 *      * source = "earned" → also burns merchant quota
 *      * source = "pack"   → does NOT burn merchant quota (already billed wholesale at grant)
 *  - customer_free  : storefront free-gen (wallet-tracked); burns merchant quota
 *  - session        : anonymous visitor free-gen; burns merchant quota
 */
import { storage } from "./storage";
import {
  consumeMerchantGenerationQuota,
  peekMerchantGenerationQuota,
  type MerchantQuotaDecision,
} from "./generation-quota";
import { syncMerchantQuotaAlerts } from "./merchant-quota-alerts";
import { logMerchantGeneration, type MerchantGenerationLogInput } from "./merchant-generation-log";
import { spendStudioCredit, type CreditSource } from "./studio-credits";
import type { ShopifyInstallation } from "@shared/schema";

export type GenerationBillingMode = "merchant" | "customer_paid" | "customer_free" | "session";

export function resolveStorefrontBillingMode(params: {
  usedCustomerPaidCredit: boolean;
  hasLoggedInCustomer: boolean;
  hasSessionOnly: boolean;
}): GenerationBillingMode {
  if (params.usedCustomerPaidCredit) return "customer_paid";
  if (params.hasLoggedInCustomer) return "customer_free";
  if (params.hasSessionOnly) return "session";
  return "merchant";
}

export async function applyCustomerBillingOnSuccess(params: {
  customerId: string;
  mode: "customer_paid" | "customer_free";
  idempotencyKey: string;
  externalRef: string;
  freeGenerationLimit?: number;
  shop?: string | null;
}): Promise<{ consumed: boolean; source: CreditSource | null }> {
  const { customerId, mode, idempotencyKey, externalRef, freeGenerationLimit, shop } = params;
  if (mode === "customer_paid") {
    const r = await spendStudioCredit({
      customerId,
      idempotencyKey,
      externalRef,
      shop: shop ?? null,
      quotaBucketKey: null,
    });
    return { consumed: r.spent, source: r.source };
  }
  const r = await storage.consumeFreeGeneration(
    customerId,
    idempotencyKey,
    externalRef,
    freeGenerationLimit ?? 5,
  );
  return { consumed: r.consumed, source: null };
}

export async function applyMerchantBillingOnSuccess(
  installation: ShopifyInstallation,
): Promise<MerchantQuotaDecision> {
  const decision = await consumeMerchantGenerationQuota(installation);
  void syncMerchantQuotaAlerts(installation, decision).catch((err) => {
    console.warn("[generation-billing] quota alert sync failed:", err?.message ?? err);
  });
  return decision;
}

/** Peek merchant quota and fire alert side-effects (POST generate paths). */
export async function peekMerchantQuotaWithAlerts(
  installation: ShopifyInstallation,
): Promise<MerchantQuotaDecision> {
  const decision = await peekMerchantGenerationQuota(installation);
  void syncMerchantQuotaAlerts(installation, decision).catch(() => {});
  return decision;
}

export async function finalizeGenerationBilling(params: {
  installation: ShopifyInstallation;
  billingMode: GenerationBillingMode;
  customerId?: string | null;
  idempotencyKey: string;
  freeGenerationLimit?: number;
}): Promise<MerchantQuotaDecision | null> {
  const { installation, billingMode, customerId, idempotencyKey, freeGenerationLimit } = params;
  const shop = installation.shopDomain ?? null;

  if (billingMode === "merchant") {
    return applyMerchantBillingOnSuccess(installation);
  }

  if (billingMode === "customer_paid" && customerId) {
    const result = await applyCustomerBillingOnSuccess({
      customerId,
      mode: "customer_paid",
      idempotencyKey,
      externalRef: idempotencyKey,
      shop,
    });
    // "earned" credits still burn merchant quota (reward-ladder credits back-fill from plan);
    // "pack" credits were billed wholesale at grant time and do not touch merchant quota.
    if (result.source === "earned") {
      return applyMerchantBillingOnSuccess(installation);
    }
    return null;
  }

  if (billingMode === "customer_free" && customerId) {
    await applyCustomerBillingOnSuccess({
      customerId,
      mode: "customer_free",
      idempotencyKey: `storefront-free-generation:${idempotencyKey}`,
      externalRef: idempotencyKey,
      freeGenerationLimit,
      shop,
    });
    // Free visitor gens also count against the merchant monthly allotment.
    return applyMerchantBillingOnSuccess(installation);
  }

  // Anonymous session gens still come off the merchant monthly allotment.
  if (billingMode === "session") {
    return applyMerchantBillingOnSuccess(installation);
  }

  return null;
}

export async function recordSuccessfulGeneration(
  log: MerchantGenerationLogInput,
): Promise<void> {
  await logMerchantGeneration({ ...log, success: true });
}

export async function recordFailedGeneration(
  log: MerchantGenerationLogInput,
): Promise<void> {
  await logMerchantGeneration({ ...log, success: false });
}
