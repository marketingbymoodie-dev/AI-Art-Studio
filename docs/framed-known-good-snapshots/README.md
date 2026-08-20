# Flat / on-the-fly known-good snapshots

Per-product **signed-off** pins for flat-placer products (framed decor, tapestry, calibrated flat AOP like Shoulder Tote). Same idea as `docs/aop-known-good-snapshots/`: record the `production` commit where the product was verified so regressions have a revert target.

**Do not** treat these as “never change this code.” They are regression baselines.

## Index

| Product | Blueprint | Signed off | Pin commit | Doc |
|---------|-----------|------------|------------|-----|
| Vertical Framed Poster (VFP) | (framed-print) | 2026-07-23 (re-lock) | `23bfaab` | [vertical-framed-poster.md](./vertical-framed-poster.md) |
| Horizontal Framed Poster (HFP) | (framed-print) | 2026-07-23 | `23bfaab` | [horizontal-framed-poster.md](./horizontal-framed-poster.md) |
| Woven Wall Tapestry | 1649 | 2026-07-23 | `23bfaab` | [woven-wall-tapestry-bp1649.md](./woven-wall-tapestry-bp1649.md) |
| Shoulder Tote Bag (AOP) | 836 | 2026-07-24 | `c09b062` | [shoulder-tote-bp836.md](./shoulder-tote-bp836.md) |
| Unisex Cotton Crew Tee | 5 | 2026-07-24 | `eafd244` | [unisex-cotton-crew-tee-bp5.md](./unisex-cotton-crew-tee-bp5.md) |
| Men's Lightweight Fashion Tee | 26 | 2026-07-28 | `7d163e6` | [mens-lightweight-fashion-tee-bp26.md](./mens-lightweight-fashion-tee-bp26.md) |
| Unisex 3/4 Sleeve Baseball Tee | 79 | 2026-07-28 | `7d163e6` | [unisex-34-sleeve-baseball-tee-bp79.md](./unisex-34-sleeve-baseball-tee-bp79.md) |
| Unisex Heavy Blend™ Crewneck Sweatshirt | 49 | 2026-07-28 | `d677610` | [unisex-heavy-blend-crewneck-sweatshirt-bp49.md](./unisex-heavy-blend-crewneck-sweatshirt-bp49.md) |
| Unisex Heavy Blend™ Hooded Sweatshirt | 77 | 2026-07-28 | `d677610` | [unisex-heavy-blend-hooded-sweatshirt-bp77.md](./unisex-heavy-blend-hooded-sweatshirt-bp77.md) |
| Slim Phone Cases (edge-wrap) | 421 | 2026-07-29 | `f253677` | [slim-phone-cases-bp421.md](./slim-phone-cases-bp421.md) |
| Adjustable Tote (AOP, folded) | 1300 | 2026-08-20 | `9bdd315` | [adjustable-tote-bp1300.md](./adjustable-tote-bp1300.md) |

VFP / HFP / tapestry share pin `23bfaab`. Shoulder Tote **836** is pinned at `c09b062`. Adjustable Tote **1300** is a different product (folded 2650×5250 fulfillment) pinned at `9bdd315`. Crew tee is pinned at `eafd244` (85% default scale, Print Side sync, dashed-guide AR). Fashion tee (bp 26) + baseball tee (bp 79) share `7d163e6`. Heavy Blend crewneck (bp 49) + hooded sweatshirt (bp 77) share `d677610` — **opaque-touch** trim warning baseline. Slim Phone Cases (bp **421**) pinned at `f253677` — mask-only preview bg, full-canvas bake / Printers Mockup. Prefer **surgical** reverts if only one product regresses.

## Related

- Flat placer / bake: `client/.../FlatProductPlacer/`, `server/flat-calibration.ts`
- Storefront embed: `client/src/pages/embed-design.tsx`
- Fabric blend: `shared/fabricWeave.ts`, `flatRender.ts` `DEFAULT_FABRIC_BLEND_CONFIG`
- Lifestyle cameras: `shared/printifyMockupLabels.ts`, `server/printify-mockups.ts`
- AOP mesh snapshots (orthogonal): `docs/aop-known-good-snapshots/`
