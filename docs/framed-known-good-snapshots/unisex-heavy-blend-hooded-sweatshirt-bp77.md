# Unisex Heavy Blend™ Hooded Sweatshirt (bp 77) — known-good snapshot

**Status: VERIFIED WORKING (2026-07-28, merchant sign-off).**

Gildan 18500 hoodie on **FlatProductPlacer** (flat on-the-fly — not AOP mesh hoodie templates). Merchant-verified alongside the Heavy Blend Crewneck for **dashed print guide + hard clip + trim warning** with the opaque-touch rule: warn only when non-transparent artwork touches or crosses the blue dashed guide; transparent padding and handle/ring chrome do not count.

Same pin commit as the crewneck — see [unisex-heavy-blend-crewneck-sweatshirt-bp49.md](./unisex-heavy-blend-crewneck-sweatshirt-bp49.md).

## Pin commit (production)

| Field | Value |
|-------|--------|
| **Commit** | `d677610` |
| **Branch** | `production` (Railway deploy target) |
| **Date** | 2026-07-28 |
| **Message** | Trim warn only when opaque art touches the dashed guide |

### Stack this snapshot sits on

| Commit | Summary |
|--------|---------|
| `d677610` | **This pin** — shared with Heavy Blend Crewneck (bp 49) |
| `946d88c` | Align warn to dashed guide; remove Link sides; ATC/test-order clip confirm |
| `7d163e6` | Tester product-switch / wrong-product test order guard |
| `5581eb7` | Fix flat dashed guide overlay desync from canvas clip |
| `bab4dac` | Version-pin flat calibration assets to manifest generatedAt |
| `5b03bce` | Track opaque artwork pixels for flat placer box + trim warnings |
| `fcc2cbf` | WYSIWYG flat apparel clip: guide = mask bounds |

Prefer **surgical** reverts if only this hoodie regresses. Do not confuse with AOP pullover/zip hoodie mesh pins under `docs/aop-known-good-snapshots/`.

## What was verified working

- **FlatProductPlacer** — Front/Back (PRINT ON BACK), artwork scale, fine position
- **Dashed blue print guide** + hard clip alignment
- **Trim warning** only on opaque touch/cross of the dashed guide (front and back)
- **No false positive** when opaque art has a clear gap inside the guide
- **Link sides** removed — editing one face does not silently rescale the other
- **ATC / test order** clip confirmation when either enabled face is trimmed

## Critical implementation (do not break casually)

Same flat apparel invariants as bp 49 (guide = mask AABB, overlay = canvas CSS box, opaque-touch trim, no Link sides, clip confirm).

| Area | Path / invariant |
|------|------------------|
| Blueprint | Printify **77** (Unisex Heavy Blend™ Hooded Sweatshirt / Gildan 18500), `onTheFlyTier: flat` + `flatCalibration` |
| Not AOP mesh | Empty / unused `panel_mapping_template` for this DTG flat path — do not route through HoodieAopPlacer |

## Product row expectations

- Printify blueprint **77**
- `designerType`: `apparel`, `isAllOverPrint`: false
- `onTheFlyTier`: `flat` + `flatCalibration` (front/back)
- `hasPrintifyMockups`: true

## Verification checklist

- [ ] Front: opaque inside with gap → no warn; touch/cross guide → warn
- [ ] Back (PRINT ON BACK on): same opaque-touch behaviour
- [ ] Independent front/back scale after Link sides removal
- [ ] Clip confirm on test order when either face is over the guide

## Revert

- Shared pin with bp 49: `d677610`
- Overlay desync: `5581eb7`
- Prefer surgical over a full `production` reset

---

*Snapshot recorded: 2026-07-28.*
