# Body pillow AOP (bp 2758) — known-good snapshot

**Status: VERIFIED WORKING (2026-08-20, merchant sign-off on staging).**

Body pillow is **HoodieAopPlacer** (`front-back-face`), not the folded-tote flat editor. Size rows are stored as **20×54** (portrait) but the sewn pillow / mockup is **landscape**. Generate and Place must stay in the long orientation. Print files are **split front + back** at **150 DPI** (8100px on the 54" edge). Promote this stack to `production` on go-live.

## Pin commit (staging → production on go-live)

| Field | Value |
|-------|--------|
| **Commit** | `4a2629c` (full SHA filled after production cherry-pick) |
| **Branch** | `staging` until go-live, then `production` |
| **Date** | 2026-08-20 |
| **Message** | Lock adjustable tote known-good and open body-pillow Place on Item at 122%. |

### Stack this snapshot sits on

| Commit | Summary |
|--------|---------|
| `4a2629c` | **This pin** — Place on Item opens at **122%** |
| `808f6a5` | Print panels at **150 DPI** (8100px); tester persist uses print-ready files, not 1800px mockup rasters |
| `5f0b627` | Do not center-crop landscape gens through the stored 20:54 `targetDims`; clear leftover 90° when the file is landscape |
| `a91c7ab` | Sample Place handles in the same space as the painted art |
| `06a4202` | Rotate generation AR to landscape so Place no longer clips in a vertical mask |

Square / faux-suede / lumbar pillows stay on their own pins. Prefer **surgical** reverts if only bp 2758 regresses.

## What was verified working

- **Place on item** — landscape motif fills the long pillow; default scale **122%**; Fine Position; Front/Back faces
- **No 90° clip** — new generate stays landscape (54:20); leftover ±90° from an old portrait file is cleared
- **Printers Mockup / test order** — Printify accepts the file (no “unable to enhance” / 32 DPI). Editor shows ≥150 DPI, not “Resolution will be enhanced (32 DPI ↦ 150 DPI)”
- **Split print files** — separate front + back placeholders (`printFileLayout: split-front-back`)

## Critical implementation (do not break casually)

| Area | Path / invariant |
|------|------------------|
| Blueprint | Printify **2758** (`BODY_PILLOW_WRAP_BLUEPRINT_ID`) |
| Editor | `HoodieAopPlacer`, `placerEditor: front-back-face`, groups `front-face` / `back-face` |
| Print layout | `split-front-back` (not tote folded, not wrap-single) |
| Gen AR | `bodyPillowGenerationAspectRatio("20:54")` → `"54:20"` — admin / Shopify / storefront generate |
| No 20:54 crop | Skip `targetDims` resize for body pillow in `server/routes.ts` so a wide Gemini file is not center-cropped to portrait |
| Rotation | Landscape art → `rotationDeg: 0`. Only auto-90° for leftover **portrait** files (`HoodieAopPlacer`) |
| Opening scale | `BODY_PILLOW_DEFAULT_PLACE_SCALE = 1.22` via `defaultAopPlaceScale()` — other pillows stay 110% |
| Print DPI | `printPanelLongEdgeCaps(2758)` → target/max **8100**. 1800px tester panels were ~32 DPI on 54" |
| Tester persist | `handleHoodieAopApply` saves **uncapped** `renderPrintPanels()`, not `MOCKUP_PANEL_MAX_LONG_EDGE_PX` (1800) |
| Handles | Sample in baked art space (`aopPreview.ts`) — do not remap into a different W×H |
| Tests | `shared/hoodieTemplate.test.ts`, `aopPreviewFlatPanel.test.ts` |

## What not to redo

- Saving / resizing gens through stored **20:54** `targetDims` (crops the painting, then Place looks rotated + clipped).
- Auto-90° on a **landscape** file because an earlier gen on the same job was portrait.
- Persisting 1800px mockup panels as print files (Printify enhance → on hold).
- Using tote `tote_folded_v1` math on this product.

## Product row expectations

- Printify blueprint **2758**, material typically Polyester Fleece
- `isAllOverPrint`: true
- `panelMappingTemplate` set so embed uses `HoodieAopPlacer`
- Size **20" x 54"** (stored portrait; generate/place landscape)
- `hasPrintifyMockups`: true

## Verification checklist

- [ ] Generate new art → file is landscape; Place box is long, not a clipped portrait
- [ ] Place on Item opens at **122%** (Reset also returns to 122%)
- [ ] Nudge / scale → Placement ready
- [ ] **Printers Mockup** — art fills the long pillow, not rotated
- [ ] **Send a Test Order** — Printify processes (no 32 DPI / “unable to enhance”)
- [ ] Re-open a job already saved at another scale → that saved scale is kept

## Revert

- **122% default only:** `defaultAopPlaceScale` / `BODY_PILLOW_DEFAULT_PLACE_SCALE` in `shared/hoodieTemplate.ts` + `HoodieAopPlacer` seed/reset
- **150 DPI only:** `printPanelLongEdgeCaps` + tester persist in `embed-design.tsx`
- **Landscape gen / no crop:** `bodyPillowGenerationAspectRatio` + skip `targetDims` in `server/routes.ts`
- Prefer surgical over resetting `production` to this pin if that would drop later unrelated work

---

*Snapshot recorded: 2026-08-20. Owner sign-off: body pillow Place 122% + 150 DPI test order on staging `4a2629c`.*
