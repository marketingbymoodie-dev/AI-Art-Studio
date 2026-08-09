/**
 * Apply an approved Shopify AppSubscription to an installation.
 * Extracted from the billing callback so QA can drive approve without Shopify's hosted UI.
 */
import type { ShopifyInstallation } from "@shared/schema";
import type { PricingCatalogueSnapshot } from "@shared/customizerPlans";
import {
  classifyPlanChange,
  paidUpgradeMeteringRebase,
  trialToPaidMeteringReset,
  type PlanChangeKind,
} from "./plan-transitions";

export type ApprovedSubscriptionPayload = {
  plan: string;
  chargeId: string;
  /** Shopify AppSubscription status (ACTIVE | PENDING | …). */
  subscriptionStatus: string;
  currentPeriodEnd?: Date | null;
  usageLineItemId?: string | null;
};

export type BillingPlanApplyDeps = {
  updateInstallation: (
    id: number,
    updates: Partial<ShopifyInstallation>,
  ) => Promise<ShopifyInstallation | undefined>;
  getActiveCatalogue: () => Promise<PricingCatalogueSnapshot>;
};

export type ApplyApprovedResult = {
  changeKind: PlanChangeKind;
  /** True when only pendingPlan* was written (downgrade deferred). */
  deferred: boolean;
  updates: Partial<ShopifyInstallation>;
  installation: ShopifyInstallation;
};

/**
 * Apply a simulated (or real) Shopify approval to the installation row.
 * Does not call Shopify. Does not flush overage retries (caller may).
 */
export async function applyApprovedSubscription(
  installation: ShopifyInstallation,
  payload: ApprovedSubscriptionPayload,
  deps: BillingPlanApplyDeps,
): Promise<ApplyApprovedResult | null> {
  const status = payload.subscriptionStatus || "ACTIVE";
  if (status !== "ACTIVE" && status !== "PENDING") {
    return null;
  }

  const plan = payload.plan;
  const currentPlanName = installation.planName ?? "trial";
  const changeKind = classifyPlanChange(currentPlanName, plan);
  const activeCatalogue = await deps.getActiveCatalogue();
  const currentPeriodEnd = payload.currentPeriodEnd ?? null;
  const usageLineItemId = payload.usageLineItemId ?? null;

  const billingFields: Partial<ShopifyInstallation> = {
    billingSubscriptionId: payload.chargeId,
    billingUsageLineItemId: usageLineItemId,
    billingCurrentPeriodEnd: currentPeriodEnd ?? undefined,
    pricingVersion: activeCatalogue.id,
  };

  if (changeKind === "paid_downgrade") {
    const effectiveAt =
      currentPeriodEnd ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const updates: Partial<ShopifyInstallation> = {
      ...billingFields,
      pendingPlanName: plan,
      pendingPlanEffectiveAt: effectiveAt,
    };
    const updated = await deps.updateInstallation(installation.id, updates);
    return {
      changeKind,
      deferred: true,
      updates,
      installation: updated ?? { ...installation, ...updates },
    };
  }

  const updates: Partial<ShopifyInstallation> = {
    ...billingFields,
    planName: plan,
    planStatus: "active",
    pendingPlanName: null,
    pendingPlanEffectiveAt: null,
  };
  if (changeKind === "trial_to_paid") {
    Object.assign(updates, trialToPaidMeteringReset());
  } else if (changeKind === "paid_upgrade") {
    // Carry included usage only — strip PAYG units from the freeQuota watermark.
    Object.assign(
      updates,
      paidUpgradeMeteringRebase(
        installation.monthlyGenerationsUsed ?? 0,
        installation.monthlyOverageUsed ?? 0,
      ),
    );
  }
  // same_tier: both counters carry forward unchanged.

  const updated = await deps.updateInstallation(installation.id, updates);
  return {
    changeKind,
    deferred: false,
    updates,
    installation: updated ?? { ...installation, ...updates },
  };
}
