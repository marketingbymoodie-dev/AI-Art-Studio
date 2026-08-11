# Profit Insights model

Merchant-facing calculator for monthly profit, plan fit, and subscription ROI across modelled customizer pages. Companion to Workstream A (UI) and the shared plan table in `shared/customizerPlans.ts`.

## Confirmations (locked for v1)

### Modelled pages vs live customizer pages

**v1 counts configured calculator pages** (rows the merchant adds in Profit Insights), **not** the live `/api/appai/customizer-pages` list.

This is a conscious choice for a what-if tool: merchants can model “what if I add a third page” before publishing. Plan page allowance is still checked against that modelled count.

**Known future item:** cross-check / seed page count (and optionally product picks) from the merchant’s live active customizer pages. Do not treat modelled == live until that lands.

### Take / redeem rates

Take rates (email/share) and purchase redeem stay **internal hardcoded defaults** in the calculator math.

- **Not merchant-editable** in Insights.
- **Not merchant-visible** (two-audience rule — no “redeem %”, “granted vs spent”, or “breakage” copy on merchant surfaces).
- **“Derived from store settings”** applies to **grant amounts** (free gens / rung credits from Settings / Reward Ladder), **not** take/redeem rates, until a Settings schema persists those rates.

Operator Product Intelligence may continue to expose advanced rate editors.

### Traffic seed telemetry

Handoff said “illustrative defaults now, trailing telemetry later.”

**Status today:** there is **no** wired storefront visitor / conversion / trailing-actuals pipeline for Insights to bind to. Generation metering and Reward Ladder grants exist; shop-level funnel telemetry (unique customizer visitors, engagement, conversion) does **not**.

**“Later” is its own data-plumbing task** — not a small calculator tweak. Until then, seed round illustrative numbers with an “example — edit to match your store” affordance.

### Scale tier (near-list)

Shipping without a top tier means a high-volume merchant tops out at **Pro Plus + overage** — the ceiling trap Scale exists to fix. Fine at launch (no live App Store users), but **size Scale soon** (fees / gens / pages / overage cap / whether self-serve vs contact-us). Do not let it drift to a someday-list.

### Pricing flip (separate go-live)

Plan table for Insights = **active** pricing catalogue offer (see `docs/pricing-modeller.md`). Number-flip is done via modeller commit + activate, not hand-edited constants. Staging re-subscribe / cap-change QA (including mid-cycle quota-counter integrity) before any production activate.

---

## Funnel math (store-wide)

One visitor pool + two-stage global funnel:

```
engaged = visitors × engagement%
totalOrders = engaged × conversion%   // = visitors × engagement% × conversion%
```

**Two-way binding (last-touched-wins):**

| Edit | Effect |
|------|--------|
| Visitors / engagement / conversion | Recompute `totalOrders`, **rescale each page’s orders** proportionally (preserve shares). |
| A page’s orders | Set absolute, then **re-derive visitors** = `totalOrders ÷ engagement% ÷ conversion%`. |

## Per-page → pooled generations (consumed-based)

For each modelled page, using store grant amounts + **internal** take/redeem defaults:

| Component | Formula |
|-----------|---------|
| Free / design | `engagedShare × freeGensPer` |
| Email | `engagedShare × emailTake% × emailGensPer` |
| Share | `engagedShare × shareTake% × shareGensPer` |
| Purchase | `orders × purchaseRedeem% × purchaseGensPer` |

`engagedShare` = store engaged × (page orders / total orders).  
**Store gens** = sum across pages. Plan fit uses this consumed total — never “credits granted” framing in merchant UI.

## AOV / profit

- Base monthly profit = `Σ (orders × unitMargin)` (1 unit, no cross-sell).
- Simulated = `Σ (orders × unitMargin × units/order)` + blended cross/up-sell profit.
- Cross/up-sell % is blended evenly across all orders at store-wide margin; requires ≥2 pages for a meaningful destination (soft hint when only one page).
- Retail from **target margin** + COGS (catalogue / Product Sync).
- Net = simulated (or base if unchanged) − plan cost (fee + preview overage).

## Plan fit & overage preview

- Plans read from `shared/customizerPlans` (`PAID_PLAN_DEFINITIONS`, overage via `resolveOveragePriceUsd` / caps).
- Auto-follow cheapest plan that fits; manual select detaches; flipping preview overage re-arms.
- Overage toggle is **preview only** — defaults from saved opt-in; enable for real in Settings.
- Fit statuses: `ok` / `short` / `cap` / `pages`.

## STAND-INs → real sources

| Stand-in | v1 source | Future |
|----------|-----------|--------|
| Product dropdown | Live `product_types` / Product Sync costs | — |
| Grant amounts | Store Settings / Reward Ladder | — |
| Take / redeem | Internal defaults | Settings schema + optional trailing actuals |
| Visitors / conversion | Illustrative defaults | **Data-plumbing task** (telemetry) |
| Page count | Modelled calculator rows | Live customizer-pages cross-check |
| Plan table | `shared/customizerPlans` | B number-flip go-live |

## Two-audience rule

Redeem rate, grants-vs-burned, breakage, and platform AI $/gen belong in **operator** analytics only (`audience="operator"` on `PlanGenerationEstimator`, Product Intelligence). Merchant Insights must never surface them.
