# Product Intelligence architecture

Single source of truth for catalogue COGS, shipping snapshots, variant availability, and product health — hosted on **`product_types`**, not `platform_catalog_blueprints`.

## Roles

| Layer | Role |
|-------|------|
| **Printify** | Sync source only |
| **Product Sync** (`server/product-intelligence-sync.ts`) | Preferred writer of Product Intelligence from Printify |
| **Local DB** | Authoritative PI for admin, storefront, calculators |
| **Resync Prices** | Separate Shopify retail push (reuses markup/.95 from `shared/productIntelligence.ts`) |
| **Operator Catalog** | Allow-list / tag / block blueprints only — no pricing columns |

## Operator vs Merchant surfaces

| Surface | Audience | What it does |
|---------|----------|--------------|
| **Platform → Product Intelligence** (`/admin/platform/product-intelligence`) | Operator | Sync-all, sync history, change feed, catalogue health |
| **Operator Catalog** | Operator | Tag / publish / block blueprints (allow-list) |
| **Products → Product Sync / Pricing strategy / Resync Prices** | Merchant | Per-product sync, strategy, Shopify retail |
| **Customizer Pages → Pricing** | Merchant | Costs from PI, refresh via Product Sync, strategy on Edit |
| **Profit Insights** (`/admin/insights`) | Merchant | Multi-product profit mix + plan-fit suggestion |
| **Product Intelligence → Plan estimator** | Operator | Plan page/gen sandbox ($0.05/gen, provisional gens/sale) |
| **Credits / Plan** | Merchant | AI generation quota (not COGS) |

## Data model

- `catalog_variant_costs` — current truth per supplier variant × `printAreaKey` (`front`, `both`, …)
- `catalog_variant_cost_history` — COGS/shipping change audit
- `catalog_sync_runs` / `catalog_sync_events` — run + event log
- On `product_types`: `pricingVersion`, `defaultMarkupPercent`, `pricingStrategy`, `minMarginPercent`, `productHealth`, `variantAvailability`, `shippingSnapshot`

## Product Sync triggers

- Manual: `POST /api/admin/product-types/:id/product-sync` (Products + Customizer Pages **Product Sync** / **Refresh costs**)
- Catalogue (platform admin): `POST /api/admin/product-intelligence/sync-all`
- Daily: `POST /api/internal/product-intelligence-sync` (`PRODUCT_SYNC_SECRET` or `OOS_SCAN_SECRET`)
- Operator UI: sync-all + runs/events/health under Product Intelligence

Sync updates availability maps, OOS summary fields, health, and PI cost rows.

## Cost reads (DB-first)

`GET /api/admin/printify/costs/:productTypeId` returns PI rows when they cover every active Printify variant.

- `?refresh=1` runs **Product Sync** first, then returns PI (preferred refresh path).
- `?legacy=1` keeps the Printify temp-product waterfall for operator debugging when catalog COGS are missing.

## Pricing strategies

`maintain_margin` | `maintain_price` | `notify_only`

| Strategy | Behaviour |
|----------|-----------|
| `notify_only` | Default. Sync updates health / events only. |
| `maintain_margin` | After Product Sync, auto-push suggested retail via `applyShopifyVariantPrices` when markup is set. |
| `maintain_price` | Never auto-change Shopify retail; flag health if margins breach `minMarginPercent`. |

Safe default: **`notify_only` until `defaultMarkupPercent` is known**. Never write non-positive retail (`$0.00` hard refuse via `applyShopifyVariantPrices`).

## Storefront availability

`buildDesignerConfig` exposes:

- `variantAvailability` — `sizeId:colorId` → `in_stock` | `out_of_stock` | `removed` | `unknown`
- `unavailableVariantKeys`, `productHealth`
- Colour `inStock` flags

Embed disables OOS sizes/colours, blocks ATC, and `resolve-design-variant` returns `409 variant_out_of_stock` when PI says unavailable. Unknown / pre-sync → allow (fail open).

## Health

| Status | Meaning |
|--------|---------|
| `healthy` | No blocking signals |
| `needs_review` | Price/availability/partial OOS / new-removed variants |
| `attention_required` | Sync failure, fully OOS, margin breach, retail auto-update failure |

## Shared math

All markup, `.95` rounding, profit/margin, subscription break-even, and health scoring live in [`shared/productIntelligence.ts`](../shared/productIntelligence.ts). Do not duplicate in UI or sync.

## Related docs

- [Cart / checkout custom mockup](./cart-checkout-custom-mockup-architecture.md) (shadow SKU — orthogonal but ATC-adjacent)
- [Front/back pricing](./front-back-pricing.md)
- [OOS catalogue report](./oos-catalogue-report.md)
