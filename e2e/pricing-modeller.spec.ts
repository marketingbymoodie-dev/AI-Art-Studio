/**
 * Pricing QA UI flows (Playwright).
 *
 * Verifies: modeller loads v0-live; commit leaves picker/Insights on old fees + $0.08;
 * activate confirm modal works. APIs are mocked — no Shopify hosted UI, no generation.
 */
import { test, expect, type Page } from "@playwright/test";
import { buildSeedCatalogueSnapshot, SEED_PRICING_VERSION } from "../shared/customizerPlans";

const seed = buildSeedCatalogueSnapshot();

const v0Catalog = {
  catalogue: {
    ...seed,
    id: SEED_PRICING_VERSION,
    label: "v0-live",
    status: "active",
  },
};

const planCatalogV0 = {
  catalogueId: SEED_PRICING_VERSION,
  overagePriceUsd: 0.08,
  trial: { pageLimit: 1, generationQuota: 25 },
  plans: seed.plans
    .filter((p) => p.selfServe && p.planKey !== "trial")
    .map((p) => ({
      planName: p.planKey,
      displayName: p.displayName,
      priceUsd: p.priceUsd,
      pageLimit: p.pageLimit,
      generationQuota: p.generationQuota,
      overageCap: p.overageCapUnits,
    })),
};

type CatalogueListItem = {
  id: number;
  label: string;
  status: string;
  committedAt: string;
  activatedAt: string | null;
  planCount: number;
};

async function mockPricingApis(page: Page) {
  let catalogues: CatalogueListItem[] = [
    {
      id: SEED_PRICING_VERSION,
      label: "v0-live",
      status: "active",
      committedAt: "2026-01-01T00:00:00.000Z",
      activatedAt: "2026-01-01T00:00:00.000Z",
      planCount: seed.plans.length,
    },
  ];
  let active = v0Catalog;
  let offerCatalog = planCatalogV0;
  let nextId = 2;

  await page.route("**/api/platform/admin/status", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ isPlatformAdmin: true }),
    });
  });

  await page.route("**/api/platform/pricing/active", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(active),
    });
  });

  // Register specific paths before the list GET.
  await page.route("**/api/platform/pricing/catalogues/commit", async (route) => {
    const id = nextId++;
    const body = route.request().postDataJSON() as { label?: string };
    const committed: CatalogueListItem = {
      id,
      label: body.label || `committed-${id}`,
      status: "committed",
      committedAt: new Date().toISOString(),
      activatedAt: null,
      planCount: seed.plans.length,
    };
    catalogues = [...catalogues, committed];
    // Commit ≠ activate: active offer + plan-catalog stay on v0 ($0.08).
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        catalogue: {
          ...seed,
          id,
          label: committed.label,
          status: "committed",
        },
      }),
    });
  });

  await page.route("**/api/platform/pricing/catalogues/*/activate", async (route) => {
    const url = route.request().url();
    const match = url.match(/catalogues\/(\d+)\/activate/);
    const id = match ? Number(match[1]) : NaN;
    catalogues = catalogues.map((c) => {
      if (c.id === id) {
        return { ...c, status: "active", activatedAt: new Date().toISOString() };
      }
      if (c.status === "active") return { ...c, status: "superseded" };
      return c;
    });
    const activated = catalogues.find((c) => c.id === id);
    active = {
      catalogue: {
        ...seed,
        id,
        label: activated?.label ?? `v${id}`,
        status: "active",
        overageSchedule: [{ upToInclusive: null, priceUsd: 0.1 }],
      },
    };
    offerCatalog = {
      ...planCatalogV0,
      catalogueId: id,
      overagePriceUsd: 0.1,
    };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(active),
    });
  });

  await page.route("**/api/platform/pricing/catalogues", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ catalogues }),
    });
  });

  await page.route("**/api/appai/billing/plan-catalog", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(offerCatalog),
    });
  });

  await page.route("**/api/appai/plan", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        planName: "starter",
        planStatus: "active",
        generationQuota: {
          freeQuota: 250,
          used: 0,
          remaining: 250,
          overageCap: 200,
          overagePriceUsd: 0.08,
        },
      }),
    });
  });
}

test.describe("pricing modeller UI QA", () => {
  test.beforeEach(async ({ page }) => {
    await mockPricingApis(page);
    await page.goto("/");
  });

  test("modeller loads on v0-live", async ({ page }) => {
    await expect(page.getByTestId("pricing-modeller-root")).toBeVisible();
    await expect(page.getByTestId("pricing-modeller-active-label")).toHaveText("v0-live");
    await expect(page.getByTestId("pricing-modeller-active-id")).toHaveText(String(SEED_PRICING_VERSION));
  });

  test("commit leaves picker/Insights on old fees + $0.08", async ({ page }) => {
    await expect(page.getByTestId("plan-picker-overage-rate")).toContainText("$0.08");
    await expect(page.getByTestId("insights-overage-rate")).toHaveText("$0.08");
    await expect(page.getByTestId("plan-picker-price-starter")).toContainText("$29");

    await page.getByTestId("pricing-modeller-commit").click();

    // Active offer banner unchanged after commit.
    await expect(page.getByTestId("pricing-modeller-active-label")).toHaveText("v0-live");
    await expect(page.getByTestId("pricing-catalogue-row-2")).toBeVisible();
    await expect(page.getByTestId("pricing-catalogue-row-2")).toHaveAttribute("data-status", "committed");

    // Offer surfaces still on v0 numbers — commit did not flip plan-catalog.
    await expect(page.getByTestId("plan-picker-overage-rate")).toContainText("$0.08");
    await expect(page.getByTestId("insights-overage-rate")).toHaveText("$0.08");
    await expect(page.getByTestId("plan-picker-price-starter")).toContainText("$29");
  });

  test("activate confirm modal opens, cancel dismisses, confirm activates", async ({ page }) => {
    await page.getByTestId("pricing-modeller-commit").click();
    await expect(page.getByTestId("pricing-modeller-activate-2")).toBeVisible();

    await page.getByTestId("pricing-modeller-activate-2").click();
    await expect(page.getByTestId("pricing-modeller-activate-dialog")).toBeVisible();
    await expect(page.getByTestId("pricing-modeller-activate-dialog")).toContainText(
      "does not reset generation counters",
    );

    await page.getByTestId("pricing-modeller-activate-cancel").click();
    await expect(page.getByTestId("pricing-modeller-activate-dialog")).toBeHidden();

    await page.getByTestId("pricing-modeller-activate-2").click();
    await page.getByTestId("pricing-modeller-activate-confirm").click();
    await expect(page.getByTestId("pricing-modeller-activate-dialog")).toBeHidden();
    await expect(page.getByTestId("pricing-modeller-active-label")).not.toHaveText("v0-live");
  });
});
