# Unisex 3/4 Sleeve Baseball Tee (bp 79) — known-good snapshot

**Status: VERIFIED WORKING (2026-07-28, merchant sign-off).**

Bella+Canvas 3200 baseball tee on **FlatProductPlacer** (flat on-the-fly). Merchant-verified alongside the Men's Lightweight Fashion Tee for **dashed print guide + hard clip + trim warning** WYSIWYG. Same pin commit — treat both as regression baselines for apparel flat-placer math.

## Pin commit (production)

| Field | Value |
|-------|--------|
| **Commit** | `7d163e6` |
| **Branch** | `production` (Railway deploy target) |
| **Date** | 2026-07-28 |
| **Message** | Flat tester product-switch + apparel trim warning; lock fashion/baseball tees |

### Stack this snapshot sits on

| Commit | Summary |
|--------|---------|
| `7d163e6` | **This pin** — shared with Men's Lightweight Fashion Tee (bp 26) |
| `5581eb7` | Fix flat dashed guide overlay desync from canvas clip |
| `bab4dac` | Version-pin flat calibration assets to manifest generatedAt |
| `5b03bce` | Track opaque artwork pixels for flat placer box + trim warnings |
| `fcc2cbf` | WYSIWYG flat apparel clip: guide = mask bounds |

See [mens-lightweight-fashion-tee-bp26.md](./mens-lightweight-fashion-tee-bp26.md) for the detailed critical-path table (shared flat apparel invariants). Prefer **surgical** reverts if only this tee regresses.

## What was verified working

- **FlatProductPlacer** — Front/Back, artwork scale, fine position
- **Dashed blue print guide** aligned to hard clip
- **Hard clip** + **trim warning** when art crosses the guide
- No false “Placement ready” while edges are trimmed

## Critical implementation (do not break casually)

Same flat apparel invariants as bp 26 (guide = mask AABB, overlay host = canvas CSS box, trim via AABB + mask sample, tester product-switch / test-order product guard).

| Area | Path / invariant |
|------|------------------|
| Blueprint | Printify **79** (Unisex 3/4 Sleeve Baseball Tee), `onTheFlyTier: flat` + `flatCalibration` |

## Product row expectations

- Printify blueprint **79**
- `designerType`: `apparel`, `isAllOverPrint`: false
- `onTheFlyTier`: `flat` + `flatCalibration` (front/back)
- `hasPrintifyMockups`: true

## Blank colours (storefront)

Pre-design blank swaps use **harvested** `flatCalibration.blanks` keys (e.g.
`white_red`, `white_black`), not Printify’s designer catalog alone. UK/EU
providers often expose more colorways than the original JAMS harvest.

Platform **Retry harvest** walks every Printify provider available to the
operator shop: the first that can create products supplies masks/geometry;
later providers only **add missing blank colour keys** (e.g. JAMS `black_red`
after T Shirt and Sons harvested `white_*`). Merchant listings stay
provider-scoped — blanks are a shared pool, not a merged variant catalog.

After harvest, **publish canonical** and on each merchant product type click
**Pull canonical calibration**, then hard-refresh the customizer. Without a
blank key for a color, the garment image stays on the catalog primary.

## Verification checklist

- [ ] Generate → dashed guide + clip + trim warning when oversized
- [ ] Switch away in Art Generator Tester → no sticky artwork from this design
- [ ] Test order only with a job for **this** product type

## Revert

- Shared pin with bp 26: `7d163e6`
- Overlay desync: `5581eb7`
- Prefer surgical over a full `production` reset

---

*Snapshot recorded: 2026-07-28.*
