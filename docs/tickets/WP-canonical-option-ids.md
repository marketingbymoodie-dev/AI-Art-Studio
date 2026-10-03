# Canonicalise size/colour option IDs at write time

**Status:** scheduled — **must land before production launch.** The migration touches
`generation_jobs.frame_color` and `variant_shipping.size_color_key`, and both grow with
every real design and order.

**Related:** [`wp55-selected-color-ids-hygiene.md`](wp55-selected-color-ids-hygiene.md) (selection vs minted set).

## Problem

Size/colour option IDs are written in two formats depending on which path created the
product type:

| Writer | Example colour id |
|--------|-------------------|
| Catalogue activation / platform reference rows (`buildCatalogVariantAxes`) | `caribbean-blue` |
| Printify import + Create Page wizard selection | `caribbean_blue` |

Sizes drift the same way (`14x14` / `14-x-14` / `14-14`).

Every consumer must remember to compare loosely (`normalizeSelectionId`,
`normalizeVariantKeyLoose`). A call site that forgets **fails silently**.

**Incident (staging, 2026-10-03):** Create Page on pt 30 (hyphen frameColors, underscore
selection) built a Shopify product with 5 of 17 colours (30 of 101 variants). Only
single-word colours matched. `normalizeSelectionId` was widened to treat `_` / `-` / space
as equal (`bd99dfe4`). That fixes the symptom, but the stored data is still mixed.

## Fix

1. **One canonical form.** Add a `canonicalOptionId(raw, axis: "size" | "color")` to
   `shared/variantMapResolve.ts`. Proposed form: lowercase, apparel size aliases
   (`normalizeApparelSizeId`), separators collapsed to `-`, dimension sizes as `14-14`.
2. **Every writer goes through it:**
   - `buildCatalogVariantAxes` (`server/platform-catalogue-pi.ts`) and catalogue activation
   - Printify import (`handlePrintifyImportRequest`): `sizes`, `frameColors`, `variantMap` keys, selections
   - Create Page wizard `remapPickedIds` (client), and **server-side** canonicalisation in
     `PATCH /api/admin/product-types/:id/variants` (don't trust the client)
   - Refresh-variants / Edit Variants paths
   - Storefront embed: the colour id saved on a generation job
3. **Keep loose comparison on read** as a defensive backstop, not the contract.

## Migration (one-time, idempotent)

Rewrite to canonical form:

| Table | Column(s) |
|-------|-----------|
| `product_types` | `sizes[].id`, `frame_colors[].id`, `selected_size_ids`, `selected_color_ids`, `variant_map` keys |
| `generation_jobs` | `frame_color` (used to build design-product variants: `${sizeId}:${frameColor}`) |
| `designs`, `shared_designs` | `frame_color` |
| `variant_shipping` | `size_color_key` |

Audit before migrating (may store ids or labels):

- `orders.frame_color` — historic records. Check whether fulfilment re-reads it before rewriting.
- `product_types.printify_costs` keys and any cost caches keyed by option id.
- Client `sessionStorage` / saved embed state that persists a colour id (self-heals on next load if reads stay loose).

**Not affected:** `shopify_variant_ids` (keyed by display labels, `S:Black`), shadow keys
(`jobId::variantId::cfgHash`, Shopify variant ids), cart/checkout line properties.

## Acceptance

- After migration, no row in the tables above holds an id that differs from `canonicalOptionId(id)`.
- A unit test per writer asserts canonical output for `Caribbean Blue`, `caribbean_blue`, `14 x 14`, `2XL`.
- Create Page on a catalogue-activated type and on a Printify-imported type produce identical id sets for the same blueprint + provider.
- Staging: pt 13 (Cotton Crew Tee), pt 5 (Men's Lightweight) and one AOP type re-run through Create Page → full variant count; storefront ATC + checkout thumbnail unchanged.
