# Both-sides designs pre-mint a Front shadow they never add to cart

**Status:** open. Harmless today. Will look like a leak once Front + Back is on for real traffic.
**Not a launch blocker.**

## What happens

On a both-sides design, add-to-cart selects the Front + Back catalog variant (`printSidesTwinVariant` in `embed-design.tsx`) and mints the shadow for that variant.

Before that tap, the Apply-time pre-mint (`preShadowKeyFields` / the size-change effect around the `[PreShadow] size-change pre-mint` log) still keys the shadow off `findVariantId()`, which is the Front variant. The fallback that would actually use that pre-mint is skipped when `atcBothTierVariant` is set (`!atcBothTierVariant &&` on the pre-shadow fallback).

So every both-sides design creates a Front shadow product in Shopify, then a second shadow for the Front + Back variant at add-to-cart. The Front one is never the line the customer buys. It expires and the hourly cleanup archives it, but it is a Shopify product create on every such design.

## Fix

Pre-mint the variant ATC will buy. When placement is both and the catalog has a Front + Back twin, pass that twin id into `preShadowKeyFields` instead of the Front id. Leave the Front pre-mint for front-only placement.
