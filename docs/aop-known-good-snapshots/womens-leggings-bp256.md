# Women's Casual Leggings AOP (bp 256) — known-good snapshot

**Status: VERIFIED WORKING (2026-07-27, merchant sign-off).**  
Women's Casual Leggings **Place on item** and **Pattern** mode match in-app preview after hard refresh. Use this doc to restore this exact behavior if a later change regresses leggings AOP.

## Pin commit (production)

| Field | Value |
|-------|--------|
| **Commit** | `2fec2163da48f44b59643c0ee53e1965b2032458` (`2fec216`) |
| **Branch** | `production` (Railway deploy target) |
| **Date** | 2026-07-26 |
| **Message** | Return to live editor on Front/Back click (leave Printers Mockup). |

Merchant sign-off (2026-07-27): Place + Pattern, Link sides / Mirror, rotate, Printers Mockup, Front/Back return to live editor — ready to lock.

### Stack this snapshot sits on

These commits are on `production` at this pin and should stay together when reverting:

| Commit | Summary |
|--------|---------|
| `2fec216` | **This pin** — Front/Back leave Printers Mockup → live editor |
| `7372c81` | Place rotate: bake artwork once (linked legs stay height-aligned) |
| `07782aa` | Place-mode rotate handle on bounding box |
| `3032153` | Off-unseen-side warning when art slides past panel edge |
| `2788e92` | Place ↔ Pattern returns to Front View live editor |
| `8e1ad1f` | Place scale to 500%; AOP Printers Mockup (Front Person) |
| `1eff940` | Print panel DPI from mesh `sourceRect` (not placeholder 12k) |
| `8ddd161` | Place gap defaults; Link X gap + hard-sync Y |

Other signed-off products pin separately (zip `aabd9b6`, pullover `e636838`, etc.). Prefer surgical reverts over resetting `production` to an older global pin.

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
| Place scale / offsets | Max **500%** (slider + bbox). Defaults (Link on): right `scale=3 ox=-113.2 oy=25.2`, left `scale=3 ox=7.3 oy=25.2` (X gap ≈ 120.5). Reset restores these. |
| Link sides | **ON** — preserve **X gap** (+same dx); hard-sync **Y** (and scale). Toggle does not rewrite placements. |
| Mirror | **OFF** (can combine with Link; while linked = art flip only) |
| Gen AR | Tall single-leg panel AR (fallback `2:3`) |
| Seam allowance | Mesh groups use `seamAllowance: 0`. Legacy PatternCustomizer used **70px** linear sew gap between L/R flats — not ported to mesh UV. |

## What was verified working (leggings bp 256)

- **Place on item** — per-leg contain-fit; Link sides union box; drag X inverted for on-body direction; rotate handle rotates motif without crotch height split; off-edge warning when art slides past unseen Front/Back.
- **Pattern mode** — Link/Mirror tile symmetry at crotch; Back bridges tiled flats from Front mesh.
- **Printers Mockup** — Front Person shown when ready; Front/Back/Place/Pattern return to live mesh editor (not stuck on person shot).
- **Print DPI** — Place export long edge ~3200 (scale from mesh `sourceRect`, not Printify placeholder ~12k).

Product: Printify blueprint **256**, panels `left_side` / `right_side` (wearer's left/right).

## Customer semantics

| Control | Behavior |
|---------|----------|
| Place | Full motif contain-fit **per leg** (not continuous mural) |
| Link sides | Toggle keeps L/R **offsetX** gap; while on, same **dx** + hard-sync **Y**/scale; union box; both Left/Right on; Artwork enabled / Reset act on both legs |
| Mirror | Left art horizontally flipped; optionally copies right placement when turned on |
| Place → Pattern | Link + Mirror forced **off** for clean tile symmetry; Place session snapshotted |
| Pattern → Place | Restores last Place session Link/Mirror/placements/enabled |
| Viewer | Top-left label: **Front View** / **Back View**; Front/Back leave Printers Mockup |
| Left / Right | Select which leg to edit; click artwork on a leg to switch (Link: either side activates the shared box) |
| Drag X | Inverted vs raw offset so mouse left → art moves left on-body (Printify flat flip) |
| Off-edge warning | Amber hint when art slides past panel edge on unseen Front/Back |
| Rotate | Bottom-right handle (CW); `rotationDeg` baked into artwork once (not per-panel UV) |
| Pattern + Link / Mirror | Extra flip on left_side; Back view bridges tiled flats from Front mesh |
| Pattern tile size | Leg panels anchor tile grid at panel **center** (not crotch seam edge) |

## Critical implementation (do not break casually)

| Area | Path / invariant |
|------|------------------|
| Design groups | `shared/hoodieTemplate.ts` — `defaultLeggingsDesignGroups()` → `right-leg` / `left-leg`; normalize heals unified `legs` |
| Placer UX | `HoodieAopPlacer` — Link / Mirror / Left / Right; `propagateLinkedDeltas`; `onEngageLiveEditor` clears person gallery |
| Sampling / rotate | `aopPreview.ts` — per-leg place sampling; `bakeArtworkPlacementRotation`; `legsMirrored` / `legsLinked` XOR flip on `left_side` |
| Handles | `DesignRectHandlesOverlay` — `invertOffsetX`, `rectOverride` (union when linked), rotate handle |
| DPI | `printPanelOutputScale` uses mesh base long edge → ~3200, **not** placeholder 12k |
| Mapper | `store.applyMirroredMeshToOppositeLeg` + RightSidebar button |
| Embed gallery | `embed-design.tsx` — `engageAopLiveEditor` / stick person slides only while viewing them |

**Invariant:** Do not reintroduce per-panel mesh `sourceRotation` for customer Place `rotationDeg` — that split linked legs at different heights. Bake once via `bakeArtworkPlacementRotation`.

**Invariant:** Do not compute Place print DPI from Printify placeholder dims (~12k) applied to mockup-sized `sourceRect` (~750) — that yields ~7 DPI.

## Related files (touch with care)

| Area | Path |
|------|------|
| Flat panel / place / rotate | `client/src/components/hoodie-template-mapper/lib/aopPreview.ts` |
| Mesh warp | `client/src/components/hoodie-template-mapper/lib/meshWarp.ts` |
| Handles | `client/src/components/hoodie-template-mapper/DesignRectHandlesOverlay.tsx` |
| Customer placer | `client/src/components/designer/HoodieAopPlacer/index.tsx` |
| Panel keys / defaults | `shared/hoodieTemplate.ts` |
| Storefront apply + mockups | `client/src/pages/embed-design.tsx` |
| Unit tests | `client/src/components/hoodie-template-mapper/lib/aopPreviewFlatPanel.test.ts` |

## Revert to this snapshot

### Option A — reset `production` to this commit (full rollback)

```bash
git fetch origin
git checkout production
git reset --hard 2fec216
git push --force-with-lease origin production
```

**Warning:** drops any commits on `production` after `2fec216`.

### Option B — revert specific bad commits (surgical)

```bash
git checkout production
git revert <bad-commit-sha>
git push origin production
```

Prefer when other products' fixes after this pin must be kept.

### Option C — restore leggings-critical files from the pin

```bash
git checkout 2fec216 -- client/src/components/hoodie-template-mapper/lib/aopPreview.ts
git checkout 2fec216 -- client/src/components/designer/HoodieAopPlacer/index.tsx
git checkout 2fec216 -- client/src/components/hoodie-template-mapper/DesignRectHandlesOverlay.tsx
git checkout 2fec216 -- shared/hoodieTemplate.ts
git checkout 2fec216 -- client/src/pages/embed-design.tsx
npm run build
# commit + merge to production as usual
```

### After any revert

1. `npm run build` must pass.
2. Hard refresh embed; re-apply leggings design.
3. Re-check Place + Pattern, Link/Mirror, rotate, Printers Mockup, Front/Back → live editor.

## Verification checklist (leggings 256)

- [x] Place + Link ON: toggle off/on does not jump placements; drag moves both the same way
- [x] Place + Link ON: one union box; both Left/Right toggles on; click either leg activates
- [x] Place + Link OFF: click left art → Left toggle; drag X matches mouse direction
- [x] Place + Mirror ON: left is flipped; can combine with Link
- [x] Pattern + Link: symmetrical tile meeting at crotch
- [x] Mapper mirror-map → symmetrical meshes; publish → storefront
- [x] Print panel DPI: Place export long edge ~3200 (not ~290 / “7 DPI”)
- [x] Place scale slider + bbox both cap at **500%**
- [x] Place rotate: motif rotates; Link sides stay height-aligned
- [x] Printers Mockup → Front Person; Front/Back/Place/Pattern return to live editor
- [x] Off-edge warning when art slides past unseen Front/Back
- [ ] ATC → checkout ok (shadow SKU — orthogonal; re-check if ATC paths change)

---

*Snapshot recorded: 2026-07-27. Owner sign-off: Women's Casual Leggings AOP at production `2fec216`.*
