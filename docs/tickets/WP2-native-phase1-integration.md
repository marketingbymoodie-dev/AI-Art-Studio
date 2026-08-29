# WP2-NATIVE · Phase 1 — Integrate GPT-Image-2 (transparent) as a per-style model

**Paste into Cursor. Plan-first, read-only investigation until agreed, then build. This ADDS a new generation model as a per-style option — it does NOT rip out the current model or chroma. Prove it end-to-end on ONE style, then migrate. Own deploy.**

---

## Confirmed by manual test

`openai/gpt-image-2` on Replicate produces clean transparent-background PNGs, tested end-to-end:
- Transparent background (verified clean on a red bg — no fringe).
- img2img with multiple `input_images` (reference + face) composited into one design.
- Bold text added and integrated.
- 46.8s generation time.

## COST — critical, bake in from the start

`quality: medium` = ~5¢/image. `quality: auto` or `high` = ~13¢/image. That's 2.6×. At POD volume across multiple stores this is a major unit-cost difference. Medium quality is visually print-ready (confirmed on the CATCH test).

**Default MUST be `quality: medium`.** Do not default to auto/high. Only allow higher quality as an explicit per-style override where a style genuinely needs it, and surface that it costs 2.6× (feed into Profit Insights if that tracks per-generation cost).

## Confirmed working params (from the test)

- model: `openai/gpt-image-2` (Replicate)
- `background: transparent`
- `output_format: png`
- `quality: medium` (DEFAULT — cost)
- `aspect_ratio` per product (e.g. 2:3)
- `input_images`: optional array (enables reference/face compositing)
- `number_of_images: 1`
- `output_compression`, `moderation` as needed

## Phase 1 — investigate (read-only), then build

### Investigate
1. How does the current generation path select/call the Replicate model? Where does the model ID + params get set? Where would a per-style model choice plug in?
2. Confirm the current apparel generate flow (storefront + admin + preview) so the new model can be threaded through all three (same surfaces `resolveApparelVectorize` touched).
3. Does the current path support passing `input_images` to Replicate, or is it text-to-image only? (GPT-Image-2's img2img/face-composite needs the input_images array plumbed.)
4. Cost tracking: does Profit Insights or any cost logic track per-generation model cost? If so, GPT-Image-2 medium (5¢) vs high (13¢) vs current model cost must feed in.

### Build
1. **Per-style `generationModel` field** (schema + generation path). Default = current model. A style can be set to `gpt-image-2`.
2. **When a style uses gpt-image-2 transparent:** call Replicate with the confirmed params (`background: transparent`, `output_format: png`, `quality: medium`). Output is ALREADY transparent → **skip the entire chroma pipeline** (no #FF00FF plate, no passes, no decontaminate). Route the transparent PNG straight to the print file / mockup / (optional) vectorize.
3. **Prompt handling for transparent styles:** do NOT inject the "isolated on #FF00FF background" plate instruction — it's counterproductive when the model outputs real transparency. Per-style prompt path: transparent styles get a "transparent background, for screen printing" style instruction instead of the magenta-plate one.
4. **Thread `input_images`** (optional) so reference/face compositing works — even if not exposed in UI yet, plumb the capability.
5. **Prove on ONE style first:** pick one floating-text apparel style, set it to gpt-image-2, generate end-to-end (generate → transparent PNG → mockup → cart → the print file). Confirm the transparent PNG flows through the whole pipeline correctly with NO chroma step.

## Definition of done — Phase 1

- [ ] Investigation Q1–Q4 answered
- [ ] Per-style `generationModel` field added; generation path reads it; default = current model
- [ ] gpt-image-2 path calls Replicate with `quality: medium` DEFAULT, transparent, png
- [ ] Transparent-model styles SKIP chroma entirely (verify no plate injected, no passes run)
- [ ] Transparent-model prompt does NOT inject the #FF00FF plate instruction
- [ ] `input_images` array plumbed (capability present even if UI comes later)
- [ ] One floating-text style set to gpt-image-2, proven end-to-end: generate → transparent PNG → mockup → cart → print file, no chroma, clean edges
- [ ] Cost: medium is the default; any higher-quality override is explicit and cost-flagged
- [ ] Current-model styles UNCHANGED — chroma path still works for them
- [ ] `npm run build` passes

## Verify (manual, after deploy)

- [ ] Generate on the gpt-image-2 test style → output is transparent PNG, clean edges (put on a contrasting mockup to confirm no fringe).
- [ ] Confirm the Railway log shows NO chroma passes ran for that style (skipped correctly).
- [ ] A current-model style still generates + chroma-extracts as before (no regression).
- [ ] Check the generation cost matches medium (~5¢), not high.

## Out of scope for Phase 1 (later phases)

- Migrating ALL floating styles to gpt-image-2 (do one first, prove it, then migrate).
- The loading-UX copy for the 30–60s wait (real steps only — separate small ticket).
- Vectorize-for-scale reassignment (large-format products) — separate.
- Admin UI to set `generationModel` per style (may need DB-set initially, like vectorizeEnabled).
- Prompt-quality tuning of gpt-image-2 on each style's prompts (spot-check as you migrate).

## Report

Investigate Q1–Q4, then plan the build. Prove on ONE style end-to-end before any migration. Add alongside the current model — do not remove chroma. Medium quality is the default, non-negotiable, for cost.
