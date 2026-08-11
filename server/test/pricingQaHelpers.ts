/**
 * Test helpers for pricing QA — seed installation counters via in-memory or DB rows.
 * Never seed by generating artwork.
 */
import type { ShopifyInstallation } from "@shared/schema";
import {
  SEED_PRICING_VERSION,
  buildSeedCatalogueSnapshot,
  type PricingCatalogueSnapshot,
} from "@shared/customizerPlans";
import { generationMonthKey } from "../customizer-plans";

export type MeteringSeed = {
  monthlyGenerationsUsed: number;
  monthlyOverageUsed: number;
  pricingVersion?: number | null;
  planName?: string | null;
  planStatus?: string | null;
  generationMonth?: string | null;
  billingSubscriptionId?: string | null;
  billingUsageLineItemId?: string | null;
};

/** In-memory installation store — asserts are on this row state (stand-in DB). */
export class MemoryInstallationStore {
  private rows = new Map<number, ShopifyInstallation>();
  private seq = 1;

  seed(partial: Partial<ShopifyInstallation> & MeteringSeed): ShopifyInstallation {
    const id = partial.id ?? this.seq++;
    const row = {
      id,
      merchantId: partial.merchantId ?? null,
      shopDomain: partial.shopDomain ?? `qa-${id}.myshopify.com`,
      accessToken: partial.accessToken ?? "tok",
      scope: partial.scope ?? null,
      status: partial.status ?? "active",
      installedAt: partial.installedAt ?? new Date(),
      uninstalledAt: partial.uninstalledAt ?? null,
      customizerHubUrl: partial.customizerHubUrl ?? null,
      planName: partial.planName ?? "starter",
      planStatus: partial.planStatus ?? "active",
      trialStartedAt: partial.trialStartedAt ?? null,
      billingSubscriptionId: partial.billingSubscriptionId ?? "gid://shopify/AppSubscription/old",
      billingUsageLineItemId: partial.billingUsageLineItemId ?? "gid://shopify/AppSubscriptionLineItem/old",
      billingCurrentPeriodEnd: partial.billingCurrentPeriodEnd ?? null,
      generationMonth: partial.generationMonth ?? generationMonthKey(),
      monthlyGenerationsUsed: partial.monthlyGenerationsUsed,
      monthlyOverageUsed: partial.monthlyOverageUsed,
      overageOptInEnabled: partial.overageOptInEnabled ?? true,
      overageBudgetCents: partial.overageBudgetCents ?? 1600,
      overageRecurring: partial.overageRecurring ?? false,
      overageOptInAt: partial.overageOptInAt ?? null,
      overageOptInBucketKey: partial.overageOptInBucketKey ?? generationMonthKey(),
      quotaAlert90BucketKey: partial.quotaAlert90BucketKey ?? null,
      quotaAlert100BucketKey: partial.quotaAlert100BucketKey ?? null,
      pendingPlanName: partial.pendingPlanName ?? null,
      pendingPlanEffectiveAt: partial.pendingPlanEffectiveAt ?? null,
      embedConfirmedAt: partial.embedConfirmedAt ?? null,
      storefrontFreeGensPerVisitor: partial.storefrontFreeGensPerVisitor ?? 2,
      leftoverGensReminderBucketKey: partial.leftoverGensReminderBucketKey ?? null,
      wholesaleCreditCents: partial.wholesaleCreditCents ?? 0,
      pricingVersion: partial.pricingVersion ?? SEED_PRICING_VERSION,
    } as ShopifyInstallation;
    this.rows.set(id, row);
    return { ...row };
  }

  get(id: number): ShopifyInstallation | undefined {
    const r = this.rows.get(id);
    return r ? { ...r } : undefined;
  }

  async update(
    id: number,
    updates: Partial<ShopifyInstallation>,
  ): Promise<ShopifyInstallation | undefined> {
    const cur = this.rows.get(id);
    if (!cur) return undefined;
    const next = { ...cur, ...updates };
    this.rows.set(id, next);
    return { ...next };
  }
}

/** Catalogue marked active with optional id override (for re-subscribe stamp tests). */
export function catalogueAsActive(
  id: number,
  patch?: Partial<PricingCatalogueSnapshot>,
): PricingCatalogueSnapshot {
  const seed = buildSeedCatalogueSnapshot();
  return {
    ...seed,
    ...patch,
    id,
    status: "active",
    label: patch?.label ?? (id === SEED_PRICING_VERSION ? "v0-live" : `qa-v${id}`),
  };
}

/**
 * Flip the active catalogue pointer in-memory — mirrors activatePricingCatalogue
 * (status only). Never touches installation rows.
 */
export function activateCataloguePointer(
  catalogues: Map<number, PricingCatalogueSnapshot>,
  targetId: number,
): PricingCatalogueSnapshot {
  const target = catalogues.get(targetId);
  if (!target) throw new Error(`Catalogue ${targetId} not found`);
  if (target.status === "active") return target;

  for (const [id, cat] of catalogues) {
    if (cat.status === "active") {
      catalogues.set(id, { ...cat, status: "superseded" });
    }
  }
  const activated = { ...target, status: "active" as const };
  catalogues.set(targetId, activated);
  return activated;
}

/** Seed shape: 800 included-path gens used of a 900 total used (+100 overage). */
export function seedShop800Of900(
  store: MemoryInstallationStore,
  patch?: Partial<ShopifyInstallation>,
): ShopifyInstallation {
  return store.seed({
    planName: "pro",
    planStatus: "active",
    pricingVersion: SEED_PRICING_VERSION,
    monthlyGenerationsUsed: 900,
    monthlyOverageUsed: 100,
    ...patch,
  });
}
