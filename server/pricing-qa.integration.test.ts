/**
 * Pricing QA — state-critical cases (service layer + row assertions).
 *
 * Not browser scraping. Counters seeded via helper, never by generating.
 * Shopify approve is simulated through applyApprovedSubscription (callback core).
 *
 * Optional real-DB soak: RUN_PRICING_QA_DB=1 (see docs/pricing-modeller.md).
 */
import { describe, expect, it, vi } from "vitest";
import { applyApprovedSubscription } from "./billing-plan-apply";
import {
  MemoryInstallationStore,
  activateCataloguePointer,
  catalogueAsActive,
  seedShop800Of900,
} from "./test/pricingQaHelpers";
import {
  SEED_PRICING_VERSION,
  buildSeedCatalogueSnapshot,
  resolveOveragePriceUsd,
} from "@shared/customizerPlans";
import { generationMonthKey, resolveGenerationQuota } from "./customizer-plans";

describe("pricing QA (4) activate-alone leaves stamp + counters untouched", () => {
  it("seeds 800/900 used; catalogue activate does not mutate the shop row", async () => {
    const store = new MemoryInstallationStore();
    const bucket = generationMonthKey();
    const shop = seedShop800Of900(store, { generationMonth: bucket });

    expect(shop.monthlyGenerationsUsed).toBe(900);
    expect(shop.monthlyOverageUsed).toBe(100);
    expect(shop.monthlyGenerationsUsed - shop.monthlyOverageUsed).toBe(800);
    expect(shop.pricingVersion).toBe(SEED_PRICING_VERSION);

    const catalogues = new Map<number, ReturnType<typeof catalogueAsActive>>([
      [0, catalogueAsActive(0)],
      [
        2,
        {
          ...catalogueAsActive(2, {
            label: "2026-08-qa",
            plans: buildSeedCatalogueSnapshot().plans.map((p) =>
              p.planKey === "starter" ? { ...p, priceUsd: 39, generationQuota: 150 } : p,
            ),
          }),
          status: "committed",
        },
      ],
    ]);

    const updateSpy = vi.spyOn(store, "update");
    activateCataloguePointer(catalogues, 2);

    expect(updateSpy).not.toHaveBeenCalled();
    expect(catalogues.get(2)!.status).toBe("active");
    expect(catalogues.get(0)!.status).toBe("superseded");

    const after = store.get(shop.id)!;
    expect(after.pricingVersion).toBe(SEED_PRICING_VERSION);
    expect(after.monthlyGenerationsUsed).toBe(900);
    expect(after.monthlyOverageUsed).toBe(100);
    expect(after.generationMonth).toBe(bucket);
    expect(after.planName).toBe("pro");

    // Enforcement still uses the stamped seed catalogue (not the new active offer).
    const stamped = catalogueAsActive(SEED_PRICING_VERSION);
    const q = resolveGenerationQuota("pro", true, new Date(), stamped);
    expect(q.pricingVersion).toBe(SEED_PRICING_VERSION);
    expect(q.overagePriceUsd).toBe(0.08);
  });
});

describe("pricing QA (5) upgrade approve carries included; rebases PAYG out of watermark", () => {
  it("starter → dabbler keeps included used (not reset, not doubled)", async () => {
    const store = new MemoryInstallationStore();
    const bucket = generationMonthKey();
    const shop = store.seed({
      planName: "starter",
      planStatus: "active",
      pricingVersion: SEED_PRICING_VERSION,
      generationMonth: bucket,
      monthlyGenerationsUsed: 200,
      monthlyOverageUsed: 0,
      billingSubscriptionId: "gid://shopify/AppSubscription/old-starter",
    });

    const activeAfterFlip = catalogueAsActive(2, {
      label: "2026-08-qa",
      plans: buildSeedCatalogueSnapshot().plans.map((p) =>
        p.planKey === "dabbler" ? { ...p, generationQuota: 600, priceUsd: 59 } : p,
      ),
    });

    const result = await applyApprovedSubscription(
      shop,
      {
        plan: "dabbler",
        chargeId: "gid://shopify/AppSubscription/new-dabbler",
        subscriptionStatus: "ACTIVE",
        currentPeriodEnd: new Date("2026-09-01T00:00:00Z"),
        usageLineItemId: "gid://shopify/AppSubscriptionLineItem/usage-1",
      },
      {
        updateInstallation: (id, u) => store.update(id, u),
        getActiveCatalogue: async () => activeAfterFlip,
      },
    );

    expect(result).not.toBeNull();
    expect(result!.changeKind).toBe("paid_upgrade");
    expect(result!.deferred).toBe(false);

    const row = store.get(shop.id)!;
    expect(row.monthlyGenerationsUsed).toBe(200);
    expect(row.monthlyOverageUsed).toBe(0);
    expect(row.monthlyGenerationsUsed).not.toBe(0);
    expect(row.monthlyGenerationsUsed).not.toBe(400);
    expect(row.generationMonth).toBe(bucket);
    expect(row.planName).toBe("dabbler");
    expect(row.pricingVersion).toBe(2);
    expect(row.billingSubscriptionId).toBe("gid://shopify/AppSubscription/new-dabbler");

    const metering = resolveGenerationQuota(row.planName, true, new Date(), activeAfterFlip);
    expect(metering.freeQuota).toBe(600);
    expect(metering.pricingVersion).toBe(2);
    expect(metering.freeQuota - row.monthlyGenerationsUsed).toBe(400);
  });

  it("non-zero PAYG on upgrade: rebases used to included only (full new allowance)", async () => {
    const store = new MemoryInstallationStore();
    const bucket = generationMonthKey();
    const shop = store.seed({
      planName: "starter",
      planStatus: "active",
      pricingVersion: SEED_PRICING_VERSION,
      generationMonth: bucket,
      monthlyGenerationsUsed: 350,
      monthlyOverageUsed: 100,
      billingSubscriptionId: "gid://shopify/AppSubscription/old-starter",
    });

    const activeAfterFlip = catalogueAsActive(2, {
      label: "2026-08-qa",
      plans: buildSeedCatalogueSnapshot().plans.map((p) =>
        p.planKey === "pro" ? { ...p, generationQuota: 1500, priceUsd: 99 } : p,
      ),
    });

    const result = await applyApprovedSubscription(
      shop,
      {
        plan: "pro",
        chargeId: "gid://shopify/AppSubscription/new-pro",
        subscriptionStatus: "ACTIVE",
        usageLineItemId: "gid://shopify/AppSubscriptionLineItem/usage-1",
      },
      {
        updateInstallation: (id, u) => store.update(id, u),
        getActiveCatalogue: async () => activeAfterFlip,
      },
    );

    expect(result!.changeKind).toBe("paid_upgrade");
    const row = store.get(shop.id)!;
    // Live counters: PAYG stripped from watermark (charges already billed on Shopify).
    expect(row.monthlyGenerationsUsed).toBe(250);
    expect(row.monthlyOverageUsed).toBe(0);
    expect(row.planName).toBe("pro");

    const metering = resolveGenerationQuota(row.planName, true, new Date(), activeAfterFlip);
    expect(metering.freeQuota).toBe(1500);
    expect(metering.freeQuota - row.monthlyGenerationsUsed).toBe(1250);
  });
});

describe("pricing QA (6) re-subscribe moves stamp; metering matches model", () => {
  it("same-tier re-approve stamps active catalogue and carries metering", async () => {
    const store = new MemoryInstallationStore();
    const bucket = generationMonthKey();
    const shop = store.seed({
      planName: "starter",
      planStatus: "active",
      pricingVersion: SEED_PRICING_VERSION,
      generationMonth: bucket,
      monthlyGenerationsUsed: 180,
      monthlyOverageUsed: 20,
      billingSubscriptionId: "gid://shopify/AppSubscription/legacy",
      billingUsageLineItemId: null,
    });

    const newActive = catalogueAsActive(3, {
      label: "2026-08-resub",
      overageSchedule: [{ upToInclusive: null, priceUsd: 0.1 }],
      plans: buildSeedCatalogueSnapshot().plans.map((p) =>
        p.planKey === "starter" ? { ...p, generationQuota: 300, priceUsd: 35 } : p,
      ),
    });

    const result = await applyApprovedSubscription(
      shop,
      {
        plan: "starter",
        chargeId: "gid://shopify/AppSubscription/resub",
        subscriptionStatus: "ACTIVE",
        currentPeriodEnd: new Date("2026-09-15T00:00:00Z"),
        usageLineItemId: "gid://shopify/AppSubscriptionLineItem/new-usage",
      },
      {
        updateInstallation: (id, u) => store.update(id, u),
        getActiveCatalogue: async () => newActive,
      },
    );

    expect(result!.changeKind).toBe("same_tier");
    const row = store.get(shop.id)!;
    expect(row.pricingVersion).toBe(3);
    expect(row.planName).toBe("starter");
    expect(row.monthlyGenerationsUsed).toBe(180);
    expect(row.monthlyOverageUsed).toBe(20);
    expect(row.billingSubscriptionId).toBe("gid://shopify/AppSubscription/resub");
    expect(row.billingUsageLineItemId).toBe("gid://shopify/AppSubscriptionLineItem/new-usage");

    const metering = resolveGenerationQuota(row.planName, true, new Date(), newActive);
    expect(metering.pricingVersion).toBe(3);
    expect(metering.freeQuota).toBe(300);
    expect(metering.overagePriceUsd).toBe(0.1);
    expect(resolveOveragePriceUsd(undefined, newActive.overageSchedule)).toBe(0.1);
    // Documented model: carry forward (not reset); remaining = newQuota − used.
    expect(metering.freeQuota - (row.monthlyGenerationsUsed - row.monthlyOverageUsed)).toBe(140);
  });

  it("trial → paid resets metering (documented exception)", async () => {
    const store = new MemoryInstallationStore();
    const shop = store.seed({
      planName: "trial",
      planStatus: "trialing",
      pricingVersion: SEED_PRICING_VERSION,
      generationMonth: "trial",
      monthlyGenerationsUsed: 20,
      monthlyOverageUsed: 0,
    });

    await applyApprovedSubscription(
      shop,
      {
        plan: "starter",
        chargeId: "gid://shopify/AppSubscription/trial-paid",
        subscriptionStatus: "ACTIVE",
        usageLineItemId: "gid://shopify/AppSubscriptionLineItem/u",
      },
      {
        updateInstallation: (id, u) => store.update(id, u),
        getActiveCatalogue: async () => catalogueAsActive(SEED_PRICING_VERSION),
      },
    );

    const row = store.get(shop.id)!;
    expect(row.monthlyGenerationsUsed).toBe(0);
    expect(row.monthlyOverageUsed).toBe(0);
    expect(row.generationMonth).toBe(generationMonthKey());
    expect(row.planName).toBe("starter");
  });
});

describe("pricing QA commit ≠ activate (catalogue pointer)", () => {
  it("committed snapshot is never status=active until activate", () => {
    const committed = {
      ...buildSeedCatalogueSnapshot(),
      id: 9,
      status: "committed" as const,
      label: "draft-commit",
    };
    expect(committed.status).toBe("committed");
    expect(committed.status).not.toBe("active");

    const catalogues = new Map([
      [0, catalogueAsActive(0)],
      [9, { ...committed, status: "committed" as const }],
    ]);
    expect(catalogues.get(0)!.status).toBe("active");
    activateCataloguePointer(catalogues, 9);
    expect(catalogues.get(9)!.status).toBe("active");
    expect(catalogues.get(0)!.status).toBe("superseded");
  });
});

const runDbSoak = process.env.RUN_PRICING_QA_DB === "1";

describe.skipIf(!runDbSoak)("pricing QA DB soak (RUN_PRICING_QA_DB=1)", () => {
  it("activatePricingCatalogue leaves every shopify_installations metering row unchanged", async () => {
    const { db } = await import("./db");
    const { shopifyInstallations, pricingCatalogues } = await import("@shared/schema");
    const { activatePricingCatalogue, commitPricingCatalogue } = await import("./pricing-catalogue");
    const { eq, sql } = await import("drizzle-orm");

    const beforeRows = await db
      .select({
        id: shopifyInstallations.id,
        pricingVersion: shopifyInstallations.pricingVersion,
        monthlyGenerationsUsed: shopifyInstallations.monthlyGenerationsUsed,
        monthlyOverageUsed: shopifyInstallations.monthlyOverageUsed,
        generationMonth: shopifyInstallations.generationMonth,
        planName: shopifyInstallations.planName,
      })
      .from(shopifyInstallations)
      .orderBy(shopifyInstallations.id);

    const seed = buildSeedCatalogueSnapshot();
    const committed = await commitPricingCatalogue({
      label: `qa-db-${Date.now()}`,
      overageSchedule: seed.overageSchedule,
      aiCostPerGenUsd: seed.aiCostPerGenUsd,
      plans: seed.plans,
      createdBy: "pricing-qa",
    });

    await activatePricingCatalogue(committed.id);

    const afterRows = await db
      .select({
        id: shopifyInstallations.id,
        pricingVersion: shopifyInstallations.pricingVersion,
        monthlyGenerationsUsed: shopifyInstallations.monthlyGenerationsUsed,
        monthlyOverageUsed: shopifyInstallations.monthlyOverageUsed,
        generationMonth: shopifyInstallations.generationMonth,
        planName: shopifyInstallations.planName,
      })
      .from(shopifyInstallations)
      .orderBy(shopifyInstallations.id);

    expect(afterRows).toEqual(beforeRows);

    // Restore seed as active so staging offer stays v0-live after soak.
    await db
      .update(pricingCatalogues)
      .set({ status: "superseded" })
      .where(eq(pricingCatalogues.id, committed.id));
    await db
      .update(pricingCatalogues)
      .set({ status: "active", activatedAt: new Date() })
      .where(eq(pricingCatalogues.id, SEED_PRICING_VERSION));
    await db.execute(sql`SELECT 1`);
  });
});
