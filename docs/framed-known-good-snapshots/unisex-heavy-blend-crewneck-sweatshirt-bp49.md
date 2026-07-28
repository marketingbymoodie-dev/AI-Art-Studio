# Unisex Heavy Blend™ Crewneck Sweatshirt (bp 49) — known-good snapshot

**Status: VERIFIED WORKING (2026-07-28, merchant sign-off).**

Gildan 18000 crewneck on **FlatProductPlacer** (flat on-the-fly). Merchant-verified for **dashed print guide + hard clip + trim warning** with the opaque-touch rule: warn only when non-transparent artwork touches or crosses the blue dashed guide; transparent PNG padding and handle/ring chrome do not count. Comfortable margin inside the guide → “Placement ready”; flush/over → amber trim banner.

Shares the sweatshirt pin with the Heavy Blend Hooded Sweatshirt — see [unisex-heavy-blend-hooded-sweatshirt-bp77.md](./unisex-heavy-blend-hooded-sweatshirt-bp77.md).

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
| `d677610` | **This pin** — opaque-touch trim rule (no handle-pad / safe-inset false positives) |
| `946d88c` | Align warn to dashed guide; remove Link sides; ATC/test-order clip confirm |
| `7d163e6` | Tester product-switch clears sticky saved design; wrong-product test order reject |
| `5581eb7` | Fix flat dashed guide overlay desync from canvas clip |
| `bab4dac` | Version-pin flat calibration assets to manifest generatedAt |
| `5b03bce` | Track opaque artwork pixels for flat placer box + trim warnings |
| `fcc2cbf` | WYSIWYG flat apparel clip: guide = mask bounds |

Fashion tee (bp 26) / baseball tee (bp 79) remain pinned at `7d163e6` as earlier guide/clip baselines. Prefer **surgical** reverts if only this crewneck regresses.

## What was verified working

- **FlatProductPlacer** — Front/Back, artwork scale, fine position, Placement ready
- **Dashed blue print guide** aligned to hard clip
- **Hard clip** at the guide edge in live preview
- **Trim warning** only when opaque motif touches/crosses the dashed guide
- **No false positive** when opaque art sits inside the guide with a clear gap (handle box chrome ignored)
- **Link sides** removed — front/back placements independent
- **ATC / test order** confirm when either enabled face is clipped

## Critical implementation (do not break casually)

| Area | Path / invariant |
|------|------------------|
| Blueprint | Printify **49** (Unisex Heavy Blend™ Crewneck Sweatshirt / Gildan 18000), `onTheFlyTier: flat` + `flatCalibration` |
| Guide = clip | `flatPlacementRectPx` → live mask AABB; `clipFlatArtToPrintArea` mask+rect |
| Overlay host | Canvas `offsetWidth`/`offsetHeight` (not wrapper `inset-0`) |
| Trim warning | `flatApparelGuideTrimmed(guide, opaqueContentBox)` — touch/cross only; transparent pixels ignored |
| Opaque bounds | `flatVisibleArtBoxAxisAligned` / `flatArtContentFractionsCached` (alpha ≥ 1) |
| No Link sides | Front/back never mirrored on scale/position edits |
| Clip confirm | ATC + tester test-order dialog when `flatClipSides` non-empty |

## Product row expectations

- Printify blueprint **49**
- `designerType`: `apparel`, `isAllOverPrint`: false
- `onTheFlyTier`: `flat` + `flatCalibration` (front/back)
- `hasPrintifyMockups`: true

## Verification checklist

- [ ] Generate Illustrated Motif → flat placer; dashed guide visible
- [ ] Opaque art inside guide with gap → no warning, Placement ready
- [ ] Nudge until opaque pixels touch/cross guide → trim banner + status
- [ ] Scale back inside → warning clears
- [ ] Hide overlay (eye) — canvas clip still matches where the guide was
- [ ] Test order / ATC with clipped art → confirmation dialog

## Revert

- Opaque-touch trim rule: `d677610`
- Guide/overlay desync: `5581eb7`
- Prefer surgical over resetting `production` to this pin if that would drop later unrelated work

---

*Snapshot recorded: 2026-07-28.*
