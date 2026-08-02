# Women's Casual Leggings AOP (bp 256) — known-good snapshot

**Status: UPDATED (2026-08-02).**  
Builds on the 2026-07-27 Place/Pattern sign-off. This pin adds Reset-home UX, removes Replace artwork, moves Fine position into controls, and deferred mockup apply (no flash on every nudge).

## Pin commit (production)

| Field | Value |
|-------|--------|
| **Commit** | *(set after deploy — see git log on `production`)* |
| **Branch** | `production` (Railway deploy target) |
| **Date** | 2026-08-02 |
| **Message** | Leggings placer UX: Reset home, nudge in controls, deferred AOP apply |

Prior verified pin (Place/Pattern core): `2fec216` (2026-07-26). Prefer this newer pin for UX/apply behaviour; keep `2fec216` stack if reverting only mesh/placement math.

### Stack this snapshot sits on

| Commit | Summary |
|--------|---------|
| *(this pin)* | Reset beside Mirror (Link ON / Mirror OFF + locked placements); no Replace artwork; Fine position in controls; deferred apply |
| `2fec216` | Front/Back leave Printers Mockup → live editor |
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
4. Hard-refresh. HoodieAopPlacer with Part **Legs (Wearer's leg)**, Left/Right, **Link sides**, Mirror, **Reset** (beside Mirror).

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
| Place scale / offsets | Max **500%** (slider + bbox). Defaults (Link on): right `scale=3 ox=-113.2 oy=25.2`, left `scale=3 ox=7.3 oy=25.2` (X gap ≈ 120.5). |
| Link sides | **ON** — preserve **X gap** (+same dx); hard-sync **Y** (and scale). |
| Mirror | **OFF** (can combine with Link; while linked = art flip only) |
| Reset | Beside Link/Mirror. Restores locked placements **and** Link ON / Mirror OFF / both legs enabled / active right-leg. |
| Replace artwork | **Removed** — use top-level Upload / Generate. |
| Fine position | Horizontal Left / Up / Down / Right in the **controls** column (former Replace slot). Not under the preview for leggings. |
| Mockup sync | **Deferred** — live mesh preview while editing; flush on ATC, Back, page leave, or Printers Mockup. No 1.5s auto-apply flash. |
| Gen AR | Tall single-leg panel AR (fallback `2:3`) |
| Seam allowance | Mesh groups use `seamAllowance: 0`. Legacy PatternCustomizer used **70px** linear sew gap between L/R flats — not ported to mesh UV. |

## What was verified working (leggings bp 256)

- **Place on item** — per-leg contain-fit; Link sides union box; drag X inverted for on-body direction; rotate handle rotates motif without crotch height split; off-edge warning when art slides past unseen Front/Back.
- **Pattern mode** — Link/Mirror tile symmetry at crotch; Back bridges tiled flats from Front mesh.
- **Printers Mockup** — Front Person shown when ready; Front/Back/Place/Pattern return to live mesh editor (not stuck on person shot). Flushes latest placement before generating.
- **Print DPI** — Place export long edge ~3200 (scale from mesh `sourceRect`, not Printify placeholder ~12k).
- **Reset home** — after thrashing Link/Mirror, Reset restores dual-leg flow with Link on.
- **Deferred apply** — nudging/scaling does not flash ATC / mockup refresh; ATC / Printers Mockup still get latest panels.

Product: Printify blueprint **256**, panels `left_side` / `right_side` (wearer's left/right).

## Customer semantics

| Control | Behavior |
|---------|----------|
| Place | Full motif contain-fit **per leg** (not continuous mural) |
| Link sides | Toggle keeps L/R **offsetX** gap; while on, same **dx** + hard-sync **Y**/scale; union box; both Left/Right on; Artwork enabled / Reset act on both legs |
| Mirror | Left art horizontally flipped; optionally copies right placement when turned on |
| Reset | Full home: locked L/R placements + Link ON + Mirror OFF (Place and Pattern Link/Mirror rows) |
| Fine position | Nudge arrows in controls (Left, Up, Down, Right) |
| Place → Pattern | Link + Mirror forced **off** for clean tile symmetry; Place session snapshotted |
| Pattern → Place | Restores last Place session Link/Mirror/placements/enabled |
| Viewer | Top-left label: **Front View** / **Back View**; Front/Back leave Printers Mockup |
| Left / Right | Select which leg to edit; click artwork on a leg to switch (Link: either side activates the shared box) |
| Drag X | Inverted vs raw offset so mouse left → art moves left on-body (Printify flat flip) |
| Off-edge warning | Amber hint when art slides past panel edge on unseen Front/Back |
| Rotate | Bottom-right handle (CW); `rotationDeg` baked into artwork once (not per-panel UV) |
| Pattern + Link / Mirror | Extra flip on left_side; Back view bridges tiled flats from Front mesh |
| Pattern tile size | Leg panels anchor tile grid at panel **center** (not crotch seam edge) |
| Apply / mockups | `HoodieAopPlacerHandle.applyIfNeeded` — parent flushes on ATC / Back / visibility / Printers Mockup |

## Critical implementation (do not break casually)

| Area | Path / invariant |
|------|------------------|
| Design groups | `shared/hoodieTemplate.ts` — `defaultLeggingsDesignGroups()` → `right-leg` / `left-leg`; normalize heals unified `legs` |
| Placer UX | `HoodieAopPlacer` — Link / Mirror / Reset / Fine position; `propagateLinkedDeltas`; `onEngageLiveEditor` clears person gallery |
| Deferred apply | No debounced auto-apply. `applyIfNeeded` / `hasPendingChanges` via ref; `embed-design` `flushHoodieAopPlacer` |
| Sampling / rotate | `aopPreview.ts` — per-leg place sampling; `bakeArtworkPlacementRotation`; `legsMirrored` / `legsLinked` XOR flip on `left_side` |
| Handles | `DesignRectHandlesOverlay` — `invertOffsetX`, `rectOverride` (union when linked), rotate handle |
| DPI | `printPanelOutputScale` uses mesh base long edge → ~3200, **not** placeholder 12k |
| Mapper | `store.applyMirroredMeshToOppositeLeg` + RightSidebar button |
| Embed gallery | `embed-design.tsx` — `engageAopLiveEditor` / stick person slides only while viewing them |

**Invariant:** Do not reintroduce per-panel mesh `sourceRotation` for customer Place `rotationDeg` — that split linked legs at different heights. Bake once via `bakeArtworkPlacementRotation`.

**Invariant:** Do not compute Place print DPI from Printify placeholder dims (~12k) applied to mockup-sized `sourceRect` (~750) — that yields ~7 DPI.

**Invariant:** Do not reintroduce 1.5s debounced auto-apply on every placement change — that flashes ATC / mockup refresh. Flush only on ATC / Back / leave / Printers Mockup.

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
git reset --hard <this-pin-sha>
git push --force-with-lease origin production
```

**Warning:** drops any commits on `production` after the pin.

### Option B — revert specific bad commits (surgical)

```bash
git checkout production
git revert <bad-commit-sha>
git push origin production
```

Prefer when other products' fixes after this pin must be kept.

### Option C — restore leggings-critical files from the pin

```bash
git checkout <this-pin-sha> -- client/src/components/hoodie-template-mapper/lib/aopPreview.ts
git checkout <this-pin-sha> -- client/src/components/designer/HoodieAopPlacer/index.tsx
git checkout <this-pin-sha> -- client/src/components/hoodie-template-mapper/DesignRectHandlesOverlay.tsx
git checkout <this-pin-sha> -- shared/hoodieTemplate.ts
git checkout <this-pin-sha> -- client/src/pages/embed-design.tsx
npm run build
# commit + merge to production as usual
```

### After any revert

1. `npm run build` must pass.
2. Hard refresh embed; re-apply leggings design.
3. Re-check Place + Pattern, Link/Mirror, Reset home, Fine position in controls, deferred apply (no flash on nudge), Printers Mockup, Front/Back → live editor.

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
- [x] Reset restores Link ON + Mirror OFF + locked dual-leg placements
- [x] No Replace artwork; Fine position in controls column
- [x] Nudge/scale does not flash ATC; flush on ATC / Printers Mockup / Back
- [ ] ATC → checkout ok (shadow SKU — orthogonal; re-check if ATC paths change)

---

*Snapshot updated: 2026-08-02. Prior sign-off: Women's Casual Leggings AOP at production `2fec216` (2026-07-27).*
