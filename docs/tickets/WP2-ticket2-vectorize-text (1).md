# WP2 · Ticket 2 — Harden vectorize for text (counters + fine strokes)

**Paste into Cursor ONLY after Ticket 1 is checked off and the bird-head hole is confirmed fixed. Plan-first, read-only until agreed. This is the prerequisite for the text/phrase apparel-style plan AND for clean flat-art vectorize. Own deploy. Do NOT start Ticket 3 until this is checked off.**

---

## Instructions

Plan first, don't write code yet. Read-only until agreed. Flag contradictions and stop. Fixtures FIRST. This changes the vectorize path — snapshot current output before changing.

---

## The problem (confirmed by investigation)

Vectorize is NOT ready for text. Root cause: **"keep enclosed magenta (flowers)" and "punch letter counters" are the same algorithm pointed at opposite goals.**

- After matting, the plate is #FF00FF. `prepareOpaquePlateForVectorize` paints #FF00FF into all transparent pixels — including letter counters (the holes in a/e/o/g) that Pass A already opened.
- `classifyPlateColorsByConnectivity` strips a colour only if ≥50% of its pixels are border-connected. A letter counter is *enclosed* #FF00FF — same colour as the plate but NOT border-connected — so the "keep enclosed magenta" rule (which correctly preserves flower detail like #E614E1) will **fill the counter back in.**
- Neplex runs `Hierarchical.Stacked` (the fill-in mode), `filterSpeckle: 2` (drops thin joins / small counters in a/e/g), `Spline` + `cornerThreshold: 80` (rounds glyph corners). The 1px erode already thinned strokes before tracing.
- QA (`countOpaqueWhereSourceTransparent` / <88% coverage) often **silently falls back to the raster PNG** — so "vectorize on" no-ops and ships the jagged raster, with no signal which you got.

Net: vectorized text would have filled-in holes and eaten thin strokes, or silently stay jagged raster. Building text styles on this is a trap.

Also: `opts.vectorize` / the WP1 `vectorizeEnabled` column **does nothing** — `maybeVectorizeFlatGraphic` returns the PNG unless the ENV var `APPAREL_VECTORIZE === "true"`. The per-style switch isn't wired.

## Answer first (read-only)

1. Quote `classifyPlateColorsByConnectivity`, the "keep enclosed magenta" logic, and the plate-strip decision in full. Confirm an enclosed #FF00FF counter is currently KEPT (filled) rather than punched.
2. Quote the Neplex config (`Stacked`, `filterSpeckle`, `cornerThreshold`, `Spline`) and where each is set. What would each need to be for reliable glyphs?
3. Does the Recraft path (vs Neplex) handle counters differently — compound/even-odd paths that keep holes? Recraft topology wasn't specified in-repo; determine it or flag as unknown-needs-testing.
4. Quote the `opts.vectorize` vs `APPAREL_VECTORIZE` env gate. Confirm the per-style column is ignored.
5. Quote the QA coverage fallback (`countOpaqueWhereSourceTransparent`, the 88% / max(500, 0.5%) thresholds). Confirm text-heavy art often trips it and silently returns raster.

## Added from the penguin/Taken test (curve fidelity)

Real-design testing showed the tracer doesn't only fail on letter counters — it ALSO over-simplifies smooth curves ("too few paths, loses the smooth cutout line") on curved silhouettes like a penguin body or an ice float, AND it must handle clean sticker-border strokes. Same tracer settings (`filterSpeckle`, `Spline`, `cornerThreshold`) are the cause for all three. So the tracer-quality fix must cover:
- Letter counters (holes punched, strokes solid)
- Smooth curved silhouettes (curves stay smooth, not angular from too-few points)
- Clean border/outline strokes (a deliberate sticker border traces as a crisp stroke, not a jagged one)

Fixtures must include a SMOOTH CURVED SILHOUETTE and a BORDERED SHAPE, not just letters.

## The fix — four parts

1. **Counter topology.** The plate colour (#FF00FF) must be PUNCHED wherever it appears — border-connected OR enclosed — because after plating, enclosed plate colour is a letter counter, not design. Distinguish "enclosed *plate colour*" (punch — it's a counter) from "enclosed *non-plate hue*" (keep — it's design like the #E614E1 flower). The flower rule stays for non-plate hues ONLY.
2. **Glyph-appropriate tracer settings.** Reconsider `Stacked` (fill-in mode is wrong for glyphs — use cutout/even-odd), lower/disable `filterSpeckle` for text (it drops counters and thin joins), and loosen `cornerThreshold` so glyph corners aren't rounded off. These may need to be per-style (text vs flat-art) rather than global.
3. **Wire `opts.vectorize` / `vectorizeEnabled`.** Fix `maybeVectorizeFlatGraphic` so the per-style column actually runs vectorize, not just the env var. This is what lets a text style turn vectorize on.
4. **Fine-stroke survival.** The pre-trace 1px erode + `filterSpeckle: 2` eat thin stems. For text styles, reconsider the erode (maybe skip/reduce for text) so 2px strokes survive to the tracer.

## Fixtures (build BEFORE the change)

Under `server/__tests__/fixtures/chroma/text/`:
- Bold uppercase with counters: **O, e, a, g, R, B** on a #FF00FF plate. Assert counters end TRANSPARENT, strokes SOLID.
- A thin-stroke text line (2–4px stems). Assert stems survive, not dropped/broken.
- A word with mixed counters ("Baggage" — multiple a/g/e). Assert every hole punched, every stroke intact.
- The existing flower case (#E614E1 enclosed) — assert it STILL survives (the non-plate-hue keep rule).
- A flat-art design (no text) — assert vectorize output unchanged/improved, not regressed.

Snapshot current (broken — filled counters / raster fallback) output first, commit, so the diff shows the fix.

## Definition of done — TICKET 2

- [ ] Q1–Q5 answered from code
- [ ] Fixtures committed with BEFORE snapshots (filled/failed counters shown)
- [ ] Enclosed PLATE-colour counters are punched transparent; enclosed NON-PLATE hues (flowers) still kept
- [ ] Bold-letter counters (O/e/a/g/R/B) come out transparent, strokes solid — fixtures pass
- [ ] Thin 2–4px strokes survive the pipeline
- [ ] `opts.vectorize` / `vectorizeEnabled` per-style switch actually runs vectorize (not just env var)
- [ ] Flat-art (non-text) vectorize not regressed
- [ ] QA coverage fallback: text art that vectorizes correctly is ACCEPTED, not silently dropped to raster — confirm the fallback isn't firing on now-correct SVGs
- [ ] `npm run build` passes; existing vectorize/matting tests pass

## Verify (manual, after deploy)

- [ ] Vectorize a real text/phrase design → open the SVG, confirm counters are holes and strokes are crisp at high zoom.
- [ ] Confirm it's actually SVG, not a silent raster fallback (check the stored output type).
- [ ] Vectorize a flower/enclosed-hue design → detail still kept.
- [ ] Vectorize a flat-art design → crisp, no regression.

## Report

Answer Q1–Q5, then the plan. Fixtures before implementing. Own watched deploy, not with Ticket 1 or 3. Do NOT proceed to Ticket 3 until this DoD is checked and real text vectorizes reliably. NOTE: until this ships, text styles must use the RASTER cutout (Pass A already opens counters correctly) — do not depend on the SVG path for text holes before this ticket lands.
