# Hygiene (not this ship): selectedColorIds vs 100-variant cap

**Status:** logged only — do not implement on the WP-55 storefront colour/ATC ship.

## Problem

`product_types.selectedColorIds` is merchant **intent**. Shopify can mint at most 100 variants (`sizes × colours`).

Observed on Unisex Cotton Crew Tee (id 13): **14 colours selected**, 9 sizes → 126 combinations, so only ~11 colours are minted. Military Green and Gold stay in `selectedColorIds` but never appear on Shopify.

Nothing warns the merchant. Nothing writes the minted set back after publish. The same trap will hit the 5 niche stores at provisioning.

Admin Edit Variants also trims checkboxes in-browser on open (`trimSelectionToShopifyMax`) **without persist**.

## Fix (later, merchant-facing)

One of:

1. Enforce `sizes × colours ≤ 100` at selection/save time with a clear message, **or**
2. After publish, write the actually-minted colour set back to `selectedColorIds`.

Storefront already intersects on minted Shopify (`shopifyVariants` / `shopifyVariantIds`) and must keep doing so even after this hygiene lands.

## Provisioning note

9 sizes ≈ **11 colours max**. A store must publish colours it wants sellable.
