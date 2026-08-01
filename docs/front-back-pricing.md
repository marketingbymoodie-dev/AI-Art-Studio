# Front / back print pricing

## Problem

Printify charges **blank + per print area**. A Gildan tee/hoodie with front **and** back print can cost ~$6 more than front-only. AppAI previously:

- Cached **front-only** (or single-placeholder) production costs
- Wrote **one** Shopify retail price per size/color
- Let customers enable **Print on Back** without changing the charged price

## Model (2A)

| Layer | Front only | Front + back |
|-------|------------|--------------|
| Printify COGS | `printify_costs.front` | `printify_costs.both` |
| Shopify base variant price | Front retail | (unchanged) |
| AppAI `product_types.variant_prices_both` | — | Both retail map |
| Storefront display | `from $front` when both map exists; back-only stays on front tier | `$both` only when Print Side is **both** |
| ATC / shadow SKU | Base / front shadow price (front **or back-only**) | `resolve-design-variant` with `price` override when Print Side is **both** |

Back-only = blank + one print area (same retail tier as front-only). Front+back surcharge applies only to Print Side = both.

## Merchant UI

Customizer Pages pricing step (when costs API returns `supportsBothSides`):

- Two columns per size/color: **Front only** | **Front + back**
- Suggested prices = respective COGS × (1 + markup%) → `.95`
- “Apply All Suggested” fills both columns
- Only **front** prices are synced to Shopify base variants

## Cost pull (operator)

```bash
npm run pull:printify-costs
```

Uses `PRINTIFY_API_TOKEN` (+ optional `PRINTIFY_SHOP_ID`) and `DATABASE_URL`. Writes gitignored:

- `tmp/printify-cost-matrix.json`
- `tmp/printify-cost-matrix.csv`

Free-plan COGS for the token’s account. Premium is still a UI estimate (`×0.8`) unless probed with a Premium token.

## Refreshing live product costs

`GET /api/admin/printify/costs/:productTypeId` now probes front+back when a `back` placeholder exists and returns `costs` + `costsBoth`. Clear cache / Refresh Costs after deploy to populate both tiers on existing product types.

## Updating existing Customizer Pages / Products

Use **Resync Prices** (Customizer Pages or Products admin):

1. Open Resync Prices on the page/product.
2. Click **Refresh Costs** if Front+back columns don’t appear yet (needs a fresh dual-side COGS probe).
3. Adjust markup → **Apply All Suggested** (or edit Front only / Front + back).
4. **Resync Prices** — writes front prices to Shopify and saves `variant_prices_both` on the product type for storefront “from $X” + Both surcharge.
