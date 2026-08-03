# Product Intelligence architecture

Single source of truth for catalogue COGS, shipping snapshots, variant availability, and product health — hosted on **`product_types`**, not `platform_catalog_blueprints`.

## Roles

| Layer | Role |
|-------|------|
| **Printify** | Sync source only |
| **Product Sync** (`server/product-intelligence-sync.ts`) | Only writer of Product Intelligence from Printify |
| **Local DB** | Authoritative PI for admin, storefront, future calculators |
| **Resync Prices** | Separate Shopify retail push (reuses markup/.95 from `shared/productIntelligence.ts`) |

## Data model

- `catalog_variant_costs` — current truth per supplier variant × `printAreaKey` (`front`, `both`, …)
- `catalog_variant_cost_history` — COGS/shipping change audit
- `catalog_sync_runs` / `catalog_sync_events` — run + event log
- On `product_types`: `pricingVersion`, `defaultMarkupPercent`, `pricingStrategy`, `minMarginPercent`, `productHealth`, `variantAvailability`, `shippingSnapshot`

## Product Sync triggers

- Manual: `POST /api/admin/product-types/:id/product-sync` (Products + Customizer Pages **Product Sync** buttons)
- Catalogue (platform admin): `POST /api/admin/product-intelligence/sync-all`
- Daily: `POST /api/internal/product-intelligence-sync` (`PRODUCT_SYNC_SECRET` or `OOS_SCAN_SECRET`)

Sync updates availability maps, OOS summary fields, health, and PI cost rows. Phase 1 does **not** auto-push Shopify retail (strategies stay `notify_only` until markup is set — Phase 2).

## Cost reads (DB-first)

`GET /api/admin/printify/costs/:productTypeId` returns PI rows when they cover every active Printify variant. Use `?refresh=1` to force the legacy Printify waterfall. After waterfall writes `printify_costs`, Product Sync / backfill keeps PI in sync.

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

## Pricing strategies (Phase 2)

`maintain_margin` | `maintain_price` | `notify_only`

Safe default: **`notify_only` until `defaultMarkupPercent` is known**. Never write non-positive retail (`$0.00` hard refuse via `applyShopifyVariantPrices`).

## Shared math

All markup, `.95` rounding, profit/margin, and health scoring live in [`shared/productIntelligence.ts`](../shared/productIntelligence.ts). Do not duplicate in UI or sync.

## Related docs

- [Cart / checkout custom mockup](./cart-checkout-custom-mockup-architecture.md) (shadow SKU — orthogonal but ATC-adjacent)
- [Front/back pricing](./front-back-pricing.md)
