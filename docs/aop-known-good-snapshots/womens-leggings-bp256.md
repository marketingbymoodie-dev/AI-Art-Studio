# Women's Casual Leggings AOP (bp 256) — wiring + known-good (pending sign-off)

**Status: CODE READY — awaiting live QA (not yet signed off).**

## Switch to HoodieAopPlacer (ops)

Embed uses mesh placer when `product_types.panel_mapping_template` is set (non-empty). Empty → legacy PatternCustomizer.

1. In **Hoodie Template Mapper**, publish/save the calibrated bp 256 template under a public slug (e.g. `womens-leggings-aop`).
2. **Platform Catalog** → Women's Casual Leggings (blueprint **256**) → set **Panel mapping template** → Publish.
3. Open **Test Generator** once (admin designer syncs catalog → product type) or the storefront customizer.
4. Hard-refresh. HoodieAopPlacer with Part **Legs**, Left/Right, Sync sides, Mirror.

## Mapper: symmetrical mesh

After mapping one leg (`right_side` or `left_side`) with mask + mesh warp:

1. Select that layer → Mesh warp section.
2. Click **Apply Mapped Mirrored to opposite leg**.
3. Opposite panel gets mask + `targetPoints` flipped in mockup X (columns reordered) for a symmetrical map.
4. Re-publish the template to Supabase.

## Defaults on load (PatternCustomizer parity)

| Setting | Default |
|---------|---------|
| Mode / view / part | Place / Front / Right leg |
| Design groups | `right-leg` + `left-leg` (per-panel place) |
| Sync sides | **ON** (right canonical; left = −offsetX) |
| Mirror | **OFF** (exclusive with Sync) |
| Gen AR | Tall single-leg panel AR (fallback `2:3`) |

## Customer semantics (match PatternCustomizer)

| Control | Behavior |
|---------|----------|
| Place | Full motif contain-fit **per leg** (not continuous mural) |
| Sync sides | Right canonical; left same scale/dy, **−dx**; no art flip |
| Mirror | Left = right transform **+** horizontal art flip |
| Left / Right | Select which leg to edit; under Sync/Mirror edits write right |

## Critical implementation

- `shared/hoodieTemplate.ts` — `defaultLeggingsDesignGroups()` → `right-leg` / `left-leg`; normalize heals unified `legs`
- `HoodieAopPlacer` — Sync / Mirror / Left / Right; `syncLegPlacements`
- `aopPreview.ts` — always per-leg full-panel sampling; `legsMirrored` XOR flip on `left_side`
- Mapper `store.applyMirroredMeshToOppositeLeg` + RightSidebar button

## Verification checklist (before sign-off pin)

- [ ] Place + Sync ON: edit right → left matches with opposing horizontal nudge
- [ ] Place + Mirror ON: left is flipped copy of right, matched size
- [ ] Both off: independent Left/Right placement
- [ ] Mapper mirror-map → symmetrical meshes on mockup; publish → storefront
- [ ] Pattern Sync/Mirror
- [ ] Print export orientations
- [ ] ATC → checkout ok

## Pin commit (production)

*Fill after live sign-off.*
