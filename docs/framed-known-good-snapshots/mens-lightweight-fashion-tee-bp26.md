# Men's Lightweight Fashion Tee (bp 26) — known-good snapshot

**Status: VERIFIED WORKING (2026-07-28, merchant sign-off).**

Gildan lightweight fashion tee on **FlatProductPlacer** (flat on-the-fly). Merchant-verified reference for **dashed print guide + hard clip + trim warning** alignment: art that crosses the blue dashed line is clipped on that same edge and the amber trim banner appears (not “Placement ready”).

Use this product as the ground-truth WYSIWYG check when changing flat apparel guide/clip/warning math. Do not “fix” crewneck or other flats by loosening guide logic if it breaks this tee.

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
| `7d163e6` | **This pin** — tester clears sticky saved design on product switch; test order rejects wrong-product job; apparel trim warns on mask-silhouette clip inside guide; overlay host fallback |
| `5581eb7` | Fix flat dashed guide overlay desync from canvas clip |
| `bab4dac` | Version-pin flat calibration assets to manifest generatedAt |
| `5b03bce` | Track opaque artwork pixels for flat placer box + trim warnings |
| `fcc2cbf` | WYSIWYG flat apparel clip: guide = mask bounds |

Unisex 3/4 Sleeve Baseball Tee is pinned with the same commit — see [unisex-34-sleeve-baseball-tee-bp79.md](./unisex-34-sleeve-baseball-tee-bp79.md). Prefer **surgical** reverts if only this tee regresses.

## What was verified working

- **FlatProductPlacer** — Front/Back (PRINT ON BACK), artwork scale, fine position
- **Dashed blue print guide** visible and aligned to the hard clip edge
- **Hard clip** — motif parts outside the guide are trimmed in the live preview
- **Trim warning** — banner when art extends past printable area (not false “Placement ready”)
- **Opaque art box** — black handles frame visible motif pixels

## Critical implementation (do not break casually)

| Area | Path / invariant |
|------|------------------|
| Blueprint | Printify **26** (Men's Lightweight Fashion Tee), `onTheFlyTier: flat` + `flatCalibration` |
| Guide = clip | `flatPlacementRectPx` → live mask AABB; `clipFlatArtToPrintArea` mask+rect |
| Overlay host | Sized to canvas `offsetWidth`/`offsetHeight` (not wrapper `inset-0` under aspect-square) |
| Trim warning | `flatApparelArtworkTrimmed` + `flatMaskRejectsArtBox` on opaque content box |
| Tester switch | Clear `loadDesignId` on product change; refuse cross-product saved design apply |
| Test order | `submitFlatTestOrder` requires `job.productTypeId ===` selected product |

## Product row expectations

- Printify blueprint **26**
- `designerType`: `apparel`, `isAllOverPrint`: false
- `onTheFlyTier`: `flat` + `flatCalibration` (front/back)
- `hasPrintifyMockups`: true

## Verification checklist

- [ ] Generate Illustrated Motif → flat placer opens with dashed guide
- [ ] Scale/nudge art past guide → preview clips on guide edge + trim warning
- [ ] Scale back inside → warning clears, “Placement ready”
- [ ] Switch to another product in Art Generator Tester → artwork clears (no sticky saved design)
- [ ] Test order only for a job generated on **this** product

## Revert

- Guide/overlay: `5581eb7`
- This pin (tester + trim warn): `7d163e6`
- Prefer surgical over resetting `production` to this pin if that would drop later unrelated work

---

*Snapshot recorded: 2026-07-28.*
