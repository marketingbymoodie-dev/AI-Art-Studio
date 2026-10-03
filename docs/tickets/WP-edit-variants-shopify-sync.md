# WP — Edit Variants PATCH must reach Shopify (or say it didn't)

**Status:** open · **Raised:** 2026-10-04 · **Sequence:** after 0b (GraphQL product paths, done); before or with 0c (Print sides doubles the variant set this touches)

## Problem

`PATCH /api/admin/product-types/:id/variants` (`server/routes.ts`, ~16754) validates the variant count against `SHOPIFY_MAX_VARIANTS_PER_PRODUCT`, writes `selectedSizeIds` / `selectedColorIds` to `product_types`, and returns 200 with the updated row. It does **not**:

- create Shopify variants for newly selected size/colour combos, or remove/archive deselected ones;
- update `product_types.shopifyVariantIds`;
- trigger the shipping reconcile (new variants get no delivery profile, so checkout falls back to the US-only General profile on table-mode shops — the non-US "sold out" 422);
- refresh customizer-page variant payloads.

The admin UI reports success, so the merchant believes the storefront changed when only the DB selection did. Observed on Men's Lightweight (pt 15) 2026-10-02 07:57 UTC: saved, no Shopify writes, no reconciler activity.

## Scope

1. **Diff** old vs new selection against `variantMap` (Printify-real combos only, same as `countActiveVariantMapKeys`).
2. **Add:** `productVariantsBulkCreate` on the bound base product (GraphQL — REST caps at 100 variants). Option values must match the product's existing option names. Price from the same pricing source `createShopifyProductForType` uses. Inventory: untracked / CONTINUE, same as create.
3. **Remove:** `productVariantsBulkDelete` for deselected combos. Before deleting, check for active shadows (`published_products.base_variant_id`) and open cart lines referencing them; if any, archive instead of delete or block with a clear message — do not orphan a shadow whose base vanished.
4. **Persist** the new `shopifyVariantIds` map from the mutation response (display-label keys, as today).
5. **Shipping:** call the single-flight `onProductImported`-style reconcile for the shop after Shopify writes land.
6. **Response contract:** `{ productType, shopify: { created, deleted, archived, errors[] } }`. UI shows a partial-failure state instead of "Saved" when `errors` is non-empty. Until this ships, the endpoint should at minimum return `shopifySynced: false` and the UI should say "Selection saved — Shopify product not updated; recreate the page to apply".
7. **0c interaction:** once Print sides exists, each blank (`size:color`) maps to two Shopify variants. Add/remove must operate per blank and touch both tiers together — never leave one tier of a pair behind.

## Out of scope

- Canonical option IDs (separate ticket `WP-canonical-option-ids.md`); use `normalizeSelectionId` for comparisons until it lands.
- Bulk re-pricing (Resync Prices owns that).

## Acceptance (staging demo store)

- Add a colour to a 56-variant product → Shopify product gains exactly the new combos; `shopifyVariantIds` updated; dry-run shows "+N members to add" before Apply and 0 after.
- Remove a colour with no shadows → variants deleted. Remove a colour with an active shadow → archived/blocked with a message; shadow still checks out.
- Selection pushing past 100 variants works (GraphQL path) — regression check for 0b.
- Forced Shopify error → UI shows partial failure, not "Saved".
