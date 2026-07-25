# Women's Casual Leggings AOP (bp 256) — wiring + known-good (pending sign-off)

**Status: CODE READY — awaiting live QA (not yet signed off).**

## Switch to HoodieAopPlacer (ops)

Embed uses mesh placer when `product_types.panel_mapping_template` is set (non-empty). Empty → legacy PatternCustomizer.

1. In **Hoodie Template Mapper**, publish/save the calibrated bp 256 template under a public slug (e.g. `womens-leggings-aop`).
2. **Platform Catalog** → Women's Casual Leggings (blueprint **256**) → set **Panel mapping template** to that exact slug → Publish.
3. Open **Test Generator** once (admin designer now syncs catalog → product type) or the storefront customizer.
4. Hard-refresh. You should see HoodieAopPlacer with Part **Legs**, Front/Back, Pattern/Place, and **Mirror**.

## Defaults on load

| Setting | Default |
|---------|---------|
| Mode / view / part | Place / Front / Legs |
| Design group | One `legs` group (`left_side` + `right_side`), `seamAllowance: 0` |
| Placement | scale 1, offset 0 |
| Mirror | **OFF** (continuous mural across the front seam) |
| Gen AR | Tall single-leg panel AR (fallback `2:3`), not product `1:1` |

No Left/Right leg part selectors — sync is inherent; Mirror handles bilateral flip.

## Customer semantics (vs PatternCustomizer)

| PC control | HoodieAopPlacer |
|------------|-----------------|
| Sync sides | Inherent — one design group `legs` |
| Mirror OFF | Continuous artwork across both legs (seam halves of one design rect) |
| Mirror ON | Left leg is a **flipped full-panel copy** of the right (same scale/placement) |

Printify only has **Left/Right side** panels for bp 256 (waistband ink is top of those files). High-waisted yoga bp **516** is out of scope.

## Critical implementation

- `shared/hoodieTemplate.ts` — `defaultLeggingsDesignGroups()` → `legs`; normalize heals split drafts
- `client/.../aopPreview.ts` — continuous vs `synthesiseLeggingsMirroredSourceRect`; Printify orientation flip; `legsMirrored` XOR on `left_side`
- `client/.../HoodieAopPlacer/index.tsx` — Legs part + Mirror; tall preview chrome; stable controls column
- `shared/apparelAspectRatio.ts` — `resolveLeggingsAopAspectRatio` for generate + designer display

## Verification checklist (before sign-off pin)

- [ ] Place — Mirror OFF: continuous art across front seam; Front/Back mockups
- [ ] Place — Mirror ON: left leg clearly mirrored copy of right, matched size
- [ ] Pattern — synced tiles; Mirror flips left leg
- [ ] New generate: taller canvas; motif fills place handles better than square 1:1
- [ ] Controls column: no horizontal shake when toggling Mirror / status
- [ ] Print export / Printify mockups match preview orientation
- [ ] ATC → checkout still ok (shadow SKU path untouched)

## Pin commit (production)

*Fill after live sign-off.*

---

*Draft recorded for wiring; pin after QA.*
