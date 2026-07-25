# Women's Casual Leggings AOP (bp 256) — wiring + known-good (pending sign-off)

**Status: CODE READY — awaiting live QA (not yet signed off).**

## Switch to HoodieAopPlacer (ops)

Embed uses mesh placer when `product_types.panel_mapping_template` is set (non-empty). Empty → legacy PatternCustomizer.

1. In **Hoodie Template Mapper**, publish/save the calibrated bp 256 template under a public slug (e.g. `womens-leggings-aop`).
2. **Platform Catalog** → Women's Casual Leggings (blueprint **256**) → set **Panel mapping template** → Publish.
3. Open **Test Generator** once (admin designer syncs catalog → product type) or the storefront customizer.
4. Hard-refresh. HoodieAopPlacer with Part **Legs (Wearer's leg)**, Left/Right, **Link sides**, Mirror.

## Mapper: symmetrical mesh

After mapping one leg (`right_side` or `left_side`) with mask + mesh warp:

1. Select that layer → Mesh warp section.
2. Click **Apply Mapped Mirrored to opposite leg**.
3. Opposite panel gets mask + `targetPoints` flipped in mockup X (columns reordered) for a symmetrical map.
4. Re-publish the template to Supabase.

## Defaults on load

| Setting | Default |
|---------|---------|
| Mode / view / part | Place / Front / Right leg |
| Design groups | `right-leg` + `left-leg` (per-panel place) |
| Link sides | **ON** (hood-link style — toggle does not rewrite placements) |
| Mirror | **OFF** (can combine with Link) |
| Gen AR | Tall single-leg panel AR (fallback `2:3`) |
| Seam allowance | Mesh groups use `seamAllowance: 0`. Legacy PatternCustomizer used **70px** linear sew gap between L/R flats — not ported to mesh UV yet; verify Printify vs app after QA. |

## Customer semantics

| Control | Behavior |
|---------|----------|
| Place | Full motif contain-fit **per leg** (not continuous mural) |
| Link sides | Like hood↔front link: toggle on/off **keeps** current L/R placements; while on, edits propagate as **same** dx/dy/scale ratio; union bounding box; both Left/Right toggles look on; Artwork enabled / Reset act on **both** legs |
| Mirror | Left art horizontally flipped; optionally copies right placement when turned on |
| Place → Pattern | Link + Mirror forced **off** for clean tile symmetry; Place session (placements + toggles + enabled) snapshotted |
| Pattern → Place | Restores last Place session Link/Mirror/placements/enabled |
| Viewer | Top-left label: **Front View** / **Back View** |
| Left / Right | Select which leg to edit; click artwork on a leg to switch (Link: either side activates the shared box) |
| Drag X | Inverted vs raw offset so mouse left → art moves left on-body (Printify flat flip) |
| Pattern + Link | Extra flip on left_side tile so patterns meet symmetrically at the crotch |

## Critical implementation

- `shared/hoodieTemplate.ts` — `defaultLeggingsDesignGroups()` → `right-leg` / `left-leg`; normalize heals unified `legs`
- `HoodieAopPlacer` — Link sides / Mirror / Left / Right; `propagateLinkedDeltas` for legs; `syncLegPlacementsForMirror` only for Mirror
- `aopPreview.ts` — per-leg sampling; `legsMirrored` / `legsLinked` XOR flip on `left_side`
- `DesignRectHandlesOverlay` — `invertOffsetX`, `rectOverride` (union when linked)
- Mapper `store.applyMirroredMeshToOppositeLeg` + RightSidebar button

## Verification checklist (before sign-off pin)

- [ ] Place + Link ON: toggle off/on does not jump placements; drag moves both the same way
- [ ] Place + Link ON: one union box; both Left/Right toggles on; click either leg activates
- [ ] Place + Link OFF: click left art → Left toggle; drag X matches mouse direction
- [ ] Place + Mirror ON: left is flipped; can combine with Link
- [ ] Pattern + Link: symmetrical tile meeting at crotch
- [ ] Mapper mirror-map → symmetrical meshes; publish → storefront
- [ ] Print export orientations vs Printify (check seam / bleed visually — no 70px UV yet)
- [ ] ATC → checkout ok

## Pin commit (production)

*Fill after live sign-off.*
