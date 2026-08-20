# Adjustable Tote (AOP) (bp 1300) — known-good snapshot

**Status: VERIFIED WORKING (2026-08-20, merchant sign-off on staging).**

Adjustable Tote is **flat on-the-fly** in the storefront editor (`FlatProductPlacer` — not `HoodieAopPlacer`) and fulfills as a **single folded Printify canvas** (`tote_folded_v1`): top panel = front, bottom panel = the same art box rotated 180°. Printers Mockup and test orders must bake that folded file first, then submit at scale 1 / center. Do **not** send raw customer art onto the full 1:2 slot.

This pin is the staging commit the merchant signed off. Promote the same SHA (or its merge) to `production` on go-live — do not “improve” print scale with extra Y nudges.

## Pin commit (staging → production on go-live)

| Field | Value |
|-------|--------|
| **Commit** | `808f6a5efae7447522b4500088de68a8b59dedb2` (`808f6a5`) |
| **Branch** | `staging` (Railway staging / demo store). Copy to `production` only after explicit go-live. |
| **Date** | 2026-08-20 |
| **Message** | Fix body-pillow Printify DPI and restore tote front/back replica placement. |

The tote-specific invariants in this pin: `TOTE_FOLDED_CONTAIN_BOOST = 0.864`, **no** print-only `offsetY`. (The same commit also raises body-pillow print DPI — orthogonal.)

### Stack this snapshot sits on

| Commit | Summary |
|--------|---------|
| `808f6a5` | **This pin** — contain boost **0.864**; drop print-only Y lift so front/back stay replicas |
| `3364596` | 0.96 boost + three Fine Position lifts — **rejected** (sides no longer mirrored) |
| `5f0b627` | Compress folded PNG before Supabase upload so test orders are not rejected as too large |
| `90a82a7` | contain × 1.2 (overshot seams) |
| `a91c7ab` | First cover-fit bake (too large / clipped) |
| `2379c63` | Preview Studio stays on the **flat** editor after generate |

Shoulder Tote **836** remains a different product (`c09b062`). Prefer **surgical** reverts if only bp 1300 regresses.

## What was verified working

- **FlatProductPlacer** — Front/Back, Artwork Scale, Fine Position, PRINT ON BACK, Placement ready
- **Editor stays flat** after generate (not mesh / PatternCustomizer)
- **Printers Mockup** — art size and vertical placement match the editor; front and back are the same placement (bottom panel is that box rotated 180°)
- **Print file** — 2650×5250 (two 2650×2625 faces); contain-fit × **0.864** × customer scale; offsets are **only** the editor’s Fine Position (no extra print lift)
- **Test order** — upload succeeds (JPEG/compress via `prepareBakeUploadBuffer`); Printify “High resolution” (~135 DPI on the 18" face)

## Critical implementation (do not break casually)

| Area | Path / invariant |
|------|------------------|
| Blueprint | Printify **1300**, `ADJUSTABLE_TOTE_BLUEPRINT_ID` |
| Layout policy | `resolveFulfillmentLayout` → `tote_folded_v1`; `resolveStorefrontMockupMode` → **flat**; leftover hoodie `panelMappingTemplate` must not steal the editor |
| Editor | `FlatProductPlacer` via `embed-design.tsx` when `effectiveFulfillmentLayout === tote_folded_v1` |
| Folded math | `shared/toteFoldedLayout.ts` — `toteFoldedArtBox` / `composeToteFoldedCanvas` |
| Print scale | `TOTE_FOLDED_CONTAIN_BOOST = 0.864` (contain, not cover). Do **not** add `TOTE_FOLDED_PRINT_OFFSET_Y` — it un-mirrors the 180° bottom panel |
| Offsets | Same units as `flatArtBox` (fraction of the face). Bottom panel uses the **same** box, rotated 180° |
| Canvas | 2650×2625 per face; full file 2650×5250 |
| Bake | `server/toteFoldedPrintFile.ts`; mockup `bake-flat-print-mockup.ts`; orders `flat-order-fulfillment.ts` / `toteFoldedOrderFulfillment.ts` |
| Printers Mockup | Bake the folded file first (`toteFoldedLayout` in `embed-design.tsx`), then Printify at scale=1 / center — never raw art + damp onto the 1:2 slot |
| Upload size | `prepareBakeUploadBuffer` before `uploadToFlatCalibrationBucket` (28MB soft / JPEG fallback) |
| Tests | `shared/toteFoldedLayout.test.ts` |

## What not to redo

- Cover-the-face bake (`a91c7ab`) — clipped head/feet at the seams.
- Print-only Y nudges (`3364596`) — front and back stop being replicas.
- Sending unbaked artwork to Printify’s full folded placeholder (looks ~30% small).
- Switching the storefront tote to `HoodieAopPlacer` / mesh because the catalog title says AOP.

## Product row expectations

- Printify blueprint **1300**
- `isAllOverPrint`: true (title) — still **flat** placer + `tote_folded_v1` fulfillment
- `onTheFlyTier`: `flat` + `flatCalibration` (per-face harvest)
- Sizes include **18" x 18"**
- `hasPrintifyMockups`: true (Printers Mockup / lifestyle cameras after bake)

## Verification checklist

- [ ] Generate → flat placer stays open (Front/Back, scale, Fine Position)
- [ ] Artwork Scale ~90–102% → Placement ready
- [ ] **Printers Mockup** — art inset from top and bottom seams; front and back gaps match (replica + 180°)
- [ ] **Send a Test Order** — upload succeeds; Printify editor shows folded canvas, high-res, balanced panels
- [ ] PRINT ON BACK off → bottom panel blank
- [ ] Hard refresh still lands on the preview box (Ritual header/menu stays visible)

## Revert

- **Print scale / replica alignment only:** `shared/toteFoldedLayout.ts` (`TOTE_FOLDED_CONTAIN_BOOST = 0.864`, no print Y offset)
- **Test-order upload size:** `prepareBakeUploadBuffer` in `server/flat-order-fulfillment.ts` / `toteFoldedPrintFile.ts`
- **Editor after generate:** `2379c63` / `embed-design.tsx` tote → flat placer
- Prefer surgical over resetting `production` to this pin if that would drop later unrelated work

---

*Snapshot recorded: 2026-08-20. Owner sign-off: Adjustable Tote 18×18 Printers Mockup + replica fold on staging `808f6a5`.*
