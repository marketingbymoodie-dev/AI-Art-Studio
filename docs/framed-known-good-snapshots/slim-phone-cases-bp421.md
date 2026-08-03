# Slim Phone Cases (bp 421) — known-good snapshot

**Status: VERIFIED WORKING (2026-07-29, merchant sign-off).**

Slim Phone Cases are **flat on-the-fly edge-wrap** (`flatCalibration.edgeWrap`). Print-canvas-centric layout (blue dashed = full Printify print file; amber = safe visible back face). Optional customer **background colour** fills the print file out to the blue dashed bounds for bake / Printers Mockup / orders, but the **editor preview** only shows that colour on the **masked case** (grey print-chrome stays grey). Use this doc if a later change regresses phone preview, background, or Printers Mockup.

## Pin commit (production)

| Field | Value |
|-------|--------|
| **Commit** | `f253677b13be04aef4f95148013bda76f06d239a` (`f253677`) |
| **Branch** | `production` (Railway deploy target) |
| **Date** | 2026-07-29 |
| **Message** | Keep phone background colour on the masked case; leave grey print chrome grey. |

### Stack this snapshot sits on

| Commit | Summary |
|--------|---------|
| `f253677` | **This pin** — preview: mask-only customer bg; grey guide chrome |
| `70ccbe2` | Bake full print file for Printers Mockup (bg + placement @ scale 1 center) |
| `bae0c09` | Clip customer bg to mask in preview (not art-sized rectangle) |
| `2aa2f1c` | `backgroundColor` state + bake fill; save placement only on ATC / leave / Printers |
| `18a404e` / `0d226ec` / `2b9f1f0` / `c0dcb04` | Viewer height matches prompt column; zoom at card bottom |
| `8faf0a3` / `dae0b02` / `ac2ff8a` | Contain / fit print canvas; stop clipping |
| `9a9bc54` | Fit print canvas; **Printers Mockup** replaces Print-on-Front toggle |

Prefer **surgical** reverts if only phones regress (shared flat placer also serves framed / tote / apparel).

## What was verified working

- **FlatProductPlacer (edge-wrap)** — model size (iPhone / Galaxy…), Artwork Scale, Fine Position, blue/amber guides
- **Background colour** — None / hex / swatches; preview shows colour on masked case + wrap under cutout art; grey box inside blue dashed stays grey
- **Bake / test order** — full print canvas opaque fill under art out to blue dashed (Printify admin matches); transparent when None
- **Printers Mockup** — bakes same print file as orders, submits at 100% / center; merges Printify product cameras; editing returns to Front
- **Viewer chrome** — contain fit; zoom bar at bottom of viewing card; height tracks prompt column (tester not a giant empty card)
- **Persistence** — placement / bg saved on ATC, test order, leave editor, Printers Mockup — not on every nudge (no “Saving design…” flash)

## Background colour contract (do not confuse)

| Surface | Behaviour |
|---------|-----------|
| **Editor preview** | Customer bg **mask-clipped** onto phone silhouette. Grey print-canvas chrome (inside blue dashed) stays `#d4d4d4`. |
| **Print file bake** | Customer bg fills **entire** `printFileDims` under artwork (bleed to blue dashed). Orders + Printers Mockup + design-product publish. |
| **None** | Preview = grey chrome only; bake = transparent under cutout art. |

## Critical implementation (do not break casually)

| Area | Path / invariant |
|------|------------------|
| Blueprint | Printify **421** (`shared/canonicalProducts.ts` `slimPhoneCaseBlueprintId()`, env `CANONICAL_SLIM_PHONE_BLUEPRINT_ID`) |
| Edge-wrap gate | `flatCalibration.edgeWrap` → `flatEdgeWrapMode` in `embed-design.tsx` |
| Layout | `flatPrintCanvasLayout` / `renderFlatView` edge-wrap branch — print-canvas-centric; mask alpha centered in `printFileDims` |
| Guides | Blue dashed = full print canvas; amber = safe visible back (`phoneBack` / safe zone) |
| Preview bg | `flatRender.ts` Step 1 = `PRINT_CANVAS_GREY`; Step 2b = customer bg + `clipMaskToDest` |
| Bake | `server/flat-print-file.ts` `bakeFlatPrintFile({ backgroundColor })`; fulfillment `flat-order-fulfillment.ts`; publish `design-product-publish.ts` |
| Printers Mockup | `embed-design.tsx` `requestLifestyleShot` → `POST …/bake-flat-print` then `fetchPrintifyMockups` @ 100/50/50 + `mergeProductMockups` |
| Bake routes | `server/bake-flat-print-mockup.ts`, `server/routes/bake-flat-print.ts` |
| Placement save | No 700ms auto-Apply on nudge; flush on ATC / test order / leave / Printers |
| Variant resolve | Phone / edge-wrap: size-only fallback (`resolveVariantForSizeOnly`) — colour may be junk Model fragment |
| Harvest | `server/flat-calibration.ts` — per-model `geometryByBlank`, side-profile crop for 14/15+ style mockups |
| Cache bump | Storefront mockup key `::pc3` when preview assets must regenerate |

## Product row expectations

- Printify blueprint **421** (Slim Phone Cases)
- `onTheFlyTier`: `flat` + `flatCalibration` with **`edgeWrap: true`**
- Sizes = device models (not apparel sizes); colour often irrelevant / `default`
- `hasPrintifyMockups`: true (on-demand **Printers Mockup**, not Lifestyle Context)
- No Print-on-Front toggle in the placer chrome for edge-wrap

## Verification checklist

- [ ] Generate → edge-wrap placer; blue dashed + amber guides; contain fit; zoom at bottom
- [ ] Background colour → masked case fills; grey chrome stays grey
- [ ] None → floating cutout, no fill
- [ ] Scale / nudge → no constant “Saving design…”; Apply/flush on Printers or ATC
- [ ] **Printers Mockup** → colour + art scale match editor intent on case; hard-refresh if stale bundle
- [ ] Test order → Printify admin print area has bg out to full canvas
- [ ] iPhone 13 (back-only) and 14/15 Pro (side strip cropped) guides still align after model change

## Revert

- **Preview bg flood / mask:** `f253677` / `bae0c09` in `flatRender.ts`
- **Printers Mockup bake:** `70ccbe2` (`bake-flat-print*` + `requestLifestyleShot`)
- **Bg state + save cadence:** `2aa2f1c`
- **Viewer layout:** `9a9bc54` … `18a404e` stack
- Prefer surgical over resetting `production` to this pin if that would drop later unrelated flat/AOP work

## Related (CLAUDE / architecture)

- Project guide phone section: `CLAUDE.md` — Phone cases (flat calibration)
- Flat bake / placement math: `server/flat-print-file.ts` (keep in sync with client `flatArtBox`)

---

*Snapshot recorded: 2026-07-29.*
