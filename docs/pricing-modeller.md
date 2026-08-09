# Pricing modeller

Operator tool to design SaaS plan pricing from AI cost + margin, then **commit** a version and separately **activate** it for new subscriptions.

## Margin over AI cost

- Control label: **Margin over AI cost** (never bare “Margin”).
- Does **not** include Railway / Supabase / Stripe / support / infra.
- At full allowance: `AI cost = includedGens × $0.045` (configurable per catalogue).
- Computed price: `price = AI cost / (1 − marginOverAiCost%)`.
- Price is always set against **100% utilisation** (worst-case safe ceiling).
- Realistic-utilisation margin (e.g. 40%) is **reference only** — never drives price.

Per-plan margins are intentional (e.g. lower on Starter for acquisition).

## Commit vs activate

| Action | Effect |
|--------|--------|
| **Commit** | Writes a new `pricing_catalogues` row with `status=committed`. Live billing **unchanged**. |
| **Activate** | Previous `active` → `superseded`; target → `active`. New `appSubscriptionCreate` uses these numbers + cappedAmount. **Does not** re-stamp existing installations. |

Exactly one catalogue is `active` (enforced in the activate transaction).

## Offer vs enforcement

| Surface | Catalogue |
|---------|-----------|
| Plan picker, Insights plan table, new subscribe | **Active** offer |
| Quota / emit / overage opt-in for a shop | **`installation.pricingVersion`** stamp |

Installations are **required** to have `pricing_version` (backfilled to `0`). Null must not reach enforcement.

## Existing Shopify subscriptions

- Shopify recurring fee + usage `cappedAmount` stay until the merchant **re-approves** a new subscription.
- App-side gens/pages/overage rate follow the shop’s stamp until re-subscribe stamps the new active id.
- Activate alone does not reset mid-cycle generation counters.

## Staging QA (before any production activate)

Manual checklist (demo shop) still applies before any production **catalogue activate**:

1. Commit a draft version — confirm picker/offer still shows previous active numbers.
2. Activate on staging — confirm new subscribe / upgrade uses new fee + cappedAmount.
3. **Re-subscribe / cap-change** on the operator demo shop.
4. **Mid-cycle quota-counter integrity:** with partial `monthly_generations_used` / `monthly_overage_used` already on the shop, after activate (without re-sub) counters must be unchanged and enforcement still uses the old stamp; after re-subscribe approval, stamp updates to the new catalogue id and counters must not spuriously reset unless the plan-change path intentionally resets metering (trial→paid / downgrade rules).
5. Emit path: overage charge price matches the shop’s catalogue schedule (two-tier fixture covered in unit tests).

### Automated QA (split by what it verifies)

| Layer | Covers | Command |
|-------|--------|---------|
| **Playwright UI** | Modeller loads **v0-live**; **commit** leaves plan picker + Insights offer on old fees + **$0.08**; activate confirm modal open/cancel/confirm | `npm run test:pricing-qa:ui` |
| **Service / row assertions** | (4) activate-alone leaves seeded **800/900** counters + stamp untouched; (5) upgrade approve **carries** counters (not reset/doubled); (6) re-subscribe moves stamp + metering matches model. Shopify approve via `applyApprovedSubscription` simulated payloads — no hosted Shopify UI. Counters seeded in-code, never by generating. | `npm run test:pricing-qa:service` |

Optional real-DB soak (activate must not mutate any `shopify_installations` metering columns): `RUN_PRICING_QA_DB=1 npm run test:pricing-qa:service` against a non-production DB.

Both: `npm run test:pricing-qa`.

## Phase 2 (not built)

Allocate a share of fixed monthly infra (~$65/mo) across projected subscribers for true contribution margin. Document only for now.

## Files

- SSOT seed + helpers: `shared/customizerPlans.ts`
- DB catalogues: `pricing_catalogues`, `pricing_catalogue_plans`
- Server: `server/pricing-catalogue.ts`, `server/routes/pricing-modeller.ts`, `server/billing-plan-apply.ts`
- UI: `/admin/platform/pricing-modeller`
- Automated QA: `server/pricing-qa.integration.test.ts`, `e2e/pricing-modeller.spec.ts`
