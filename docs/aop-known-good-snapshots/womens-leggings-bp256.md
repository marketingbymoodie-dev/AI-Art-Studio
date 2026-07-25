# Women's Casual Leggings AOP (bp 256) — wiring + known-good (pending sign-off)

**Status: CODE READY — awaiting merchant/ops wire + live QA (not yet signed off).**

## Switch to HoodieAopPlacer (ops)

Embed uses mesh placer when `product_types.panel_mapping_template` is set (non-empty). Empty → legacy PatternCustomizer.

1. In **Hoodie Template Mapper**, publish/save the calibrated bp 256 template under a public slug (e.g. `Womens-Leggings` → slug `Womens-Leggings` / normalize to safe name).
2. **Platform Catalog** → Women's Casual Leggings (blueprint **256**) → set **Panel mapping template** to that exact slug.
3. Sync / publish so storefront `productTypeConfig.panelMappingTemplate` picks it up.
4. Hard-refresh the storefront customizer (and admin tester). You should see HoodieAopPlacer with Part **Legs**, Front/Back, Pattern/Place, and **Mirror**.

## Customer semantics (vs PatternCustomizer)

| PC control | HoodieAopPlacer |
|------------|-----------------|
| Sync sides | Inherent — one design group `legs` owns `left_side` + `right_side` |
| Mirror | `legsMirrored` — flips left leg art relative to right |
| Continuous front | Same group + `SEAM_PAIR_PANELS` + `seamAllowance: 0` (no zip UV trim) |

Printify only has **Left/Right side** panels for bp 256 (waistband ink is top of those files). High-waisted yoga bp **516** is out of scope.

## Critical implementation

- `shared/hoodieTemplate.ts` — `defaultLeggingsDesignGroups()` → `legs`; normalize heals split drafts
- `client/.../aopPreview.ts` — Printify orientation flip on both sides; `legsMirrored` XOR on `left_side`; flat-panel bridge for legs
- `client/.../HoodieAopPlacer/index.tsx` — Legs part + Mirror; defaults `activeGroupId: "legs"`

## Verification checklist (before sign-off pin)

- [ ] Place on item — continuous art across front seam; Front/Back mockups
- [ ] Pattern — synced tiles; Mirror flips left leg
- [ ] Print export / Printify mockups match preview orientation
- [ ] ATC → checkout still ok (shadow SKU path untouched)

## Pin commit (production)

*Fill after live sign-off.*

---

*Draft recorded for wiring; pin after QA.*
