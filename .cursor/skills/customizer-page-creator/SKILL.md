---
name: customizer-page-creator
description: >-
  Known-good Create Customizer Page wizard (admin). Use when Create Page,
  customizer-pages, variant pricing, front+back COGS, Shopify 100-variant
  limit, session 401 invalid token, or cotton crew tee setup breaks or is
  being changed.
---

# Create Customizer Page — known-good

Read [reference.md](reference.md) before changing wizard pricing, variants, or auth.

**Working example:** Unisex Cotton Crew Tee (Printify blueprint **5**), Printify Choice, signed off on staging **2026-08-15**.

**Pin:** `db4510b` on `staging` (stack through `bb37032`…`db4510b`). Do not treat as a permanent lockdown — surgical fix first; revert toward this pin if the wizard regresses.

## Do not break

1. **Session JWT** — every admin `/api/*` call goes through `apiFetch` (`shopify.idToken()` + one 401 retry). Raw `fetch` on a long wizard → `401 invalid token`.
2. **Variant count** — count **Printify-real** size×colour combos, never `sizes × colours`. Apply/PATCH must use the same number (91 can be valid even when 9×13=117).
3. **Front vs front+back** — resolve both-side COGS from `costsBoth` / `shopifyVariantCostsBoth` / `costsBothByNormalizedLabel` only. Never spread front maps into a both-side lookup.
4. **Size match** — never substring-match `XL` inside `4XL` / `5XL` / `2XL`. Use `variantCostLabelsMatch` / `resolveVariantCostCents`.
5. **No phantom rows** — do not price colours Printify does not sell in that size (those were the $0.00 XS/4XL/5XL extra lines).
6. **Condense** — same-size colours within **$1** retail share a row (`SAME_SIZE_PRICE_TOLERANCE`). Front and front+back stay separate columns.
7. **Over 100** — pin the `N / 100` counter; popup to deselect; do not silently grey Next with no explanation.

## Files

| Area | Path |
|------|------|
| Wizard | `client/src/pages/admin/customizer-pages.tsx` |
| Auth | `client/src/lib/queryClient.ts` (`apiFetch`) |
| Condense / $1 unify | `shared/condenseVariantPrices.ts` |
| COGS match | `shared/printifyCostLabels.ts` |
| Real combos | `shared/variantCombinations.ts` |
| Combo list + PATCH count | `server/routes.ts` (`GET .../blueprints/:id/variants`, `PATCH .../product-types/:id/variants`) |
| Resync prices | `client/src/components/admin/ResyncPricesDialog.tsx` |

## Cotton crew tee (bp 5) — expected pricing

At **70%** markup, Printify Choice, dual-sided DTG:

- S–XL **front** ≈ $19.95 (COGS ≈ $11.63); **front+back** ≈ $29.95 (COGS ≈ $17.62)
- 2XL / 3XL / 4XL / 5XL front **higher** than S (not $19.95)
- Front+back **never equals** front-only on this product
- No extra $0.00 row for the same size (e.g. XS / 5 colours **and** XS / 6 colours with blanks)
- 91 / 100 real combos → **Next: Set Pricing** succeeds

Storefront placer for this tee is a **different** pin (`docs/framed-known-good-snapshots/unisex-cotton-crew-tee-bp5.md`). This skill is the **admin Create Page** wizard only.

## If it breaks

1. Re-run Create Page on cotton crew tee (bp 5) against the checklist in [reference.md](reference.md).
2. Diff the files above vs `db4510b`.
3. Fix surgically. Do not reintroduce cartesian counts, `label.includes` size matching, or raw `fetch` for wizard APIs.
