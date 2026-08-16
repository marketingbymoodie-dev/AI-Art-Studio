# Create Customizer Page — snapshot reference

Signed off on **staging** with Unisex Cotton Crew Tee (Printify **bp 5**) as the working pricing example. 2026-08-15.

## Pin

| Field | Value |
|-------|--------|
| **Commit** | `db4510b` |
| **Branch** | `staging` |
| **Date** | 2026-08-15 |
| **Message** | Count real Printify size/colour combos on Apply so 91 variants are not rejected as 117 |

Not yet a `production` pin until the merchant says go live.

### Stack on this pin

| Commit | What |
|--------|------|
| `d6e609f` | Condense same-size colours when suggested prices only differ by rounding ($1) |
| `bb37032` | Fresh Shopify session JWT on each `apiFetch` (Create Page after a long wizard) |
| `5940d17` | Sticky variant counter + over-100 popup |
| `98647ea` | Front+back COGS; 4XL/5XL must not inherit XL/S front cost |
| `62db473` | Drop size/colour combos Printify does not sell (no $0.00 extra rows) |
| `fc0f6fd` | Variants/providers load via `apiFetch` (not raw `fetch`) |
| `db4510b` | **This pin** — Apply/PATCH uses real combo count, not sizes × colours |

## Wizard steps (do not reshuffle)

1. **Page info** — product pick, title/handle, **placeholder images here only** (primary required; gallery required only if more than one catalog image). Do not auto-select catalog primary/gallery.
2. **Supplier** — Printify provider (crew tee known-good: **Printify Choice**).
3. **Variants** — sizes/colours; sticky `N / 100`; real combo count; popup if over 100.
4. **Pricing** — default markup **70%**; auto-apply suggested; condensed rows; front + front+back when `supportsBothSides`.
5. **Confirm** → Create Page (needs a live session token).

## Invariants (regressions we already shipped)

### Auth — `401: Unauthorized: invalid token`

App Bridge session JWTs last ~1 minute. A long wizard outlives a token that was only injected by the fetch monkey-patch.

- `apiFetch` in `client/src/lib/queryClient.ts` calls `window.shopify.idToken()` every request and retries once on 401.
- Wizard loads (`loadWizardVariants`, providers, edit variants) **must** use `apiFetch`, not raw `fetch`.
- Create Page `onError`: `REAUTH_REQUIRED` → reconnect banner; session 401 → refresh admin, form stays.

### Variant count — UI 91 vs Apply “Too many variants”

`sizes × colours` overcounts when a colour is not sold in every size (9×13=117, real=91).

- Client: `countExistingVariantCombos` + `wizardCombinations` from `GET /api/admin/printify/blueprints/:id/variants` (`combinations` array).
- Pricing rows: `buildVariantsFromAxes(..., comboSet)` then drop titles that do not match `printifyVariantLabels`.
- PATCH `/api/admin/product-types/:id/variants`: `countActiveVariantMapKeys(variantMap, …)` first, else client `variantCount`, else cartesian last.
- Import already used `countActiveVariantMapKeys` — do not regress PATCH back to cartesian-only.

### Front+back pricing

Symptom: both columns $19.95 / COGS $11.63, or 4XL/5XL front at S-price.

- `{ ...costsData, costs: costsData.costsBoth }` still left `shopifyVariantCosts` and `costsByNormalizedLabel` as **front**.
- Fuzzy `normTitle.includes(label)` matched `4xl / black` to `xl / black`.
- Fix: `resolveVariantCostCents` in `shared/printifyCostLabels.ts` with exact size tokens (`4xl` ≠ `xl`) and reversed `size / colour` labels. Callers pass the matching tier maps only.
- `normalizeVariantLabelForCostMatch` collapses **numeric** `14 x 11` only — not the `x` in `XS`/`XL`.

### Phantom $0.00 rows

Cartesian axes invented XS/4XL/5XL × colours Printify does not sell. Those failed COGS lookup and condensed as a second `$0.00` group.

- Filter with `combinations` / `isAllowedVariantCombo`.
- Hide condensed groups with no front COGS once costs are loaded.

### Condense + markup

- `SAME_SIZE_PRICE_TOLERANCE = 1` (Black $66.95 vs White $67.95 is one row).
- `unifySameSizeSuggestedPrices` runs on front and both maps **separately**.
- Default markup **70%**; changing markup rewrites suggested retail; block Next while applying.

## Cotton crew tee checklist

Re-run on staging after any wizard/pricing/auth change:

- [ ] Page info: pick Unisex Cotton Crew Tee (bp 5); choose primary (and gallery if multiple images)
- [ ] Supplier: Printify Choice
- [ ] Variants load (not “Failed to fetch variants”); counter is `N / 100` and stays visible while scrolling colours
- [ ] Selecting enough colours to exceed 100 → popup + explanation; Next does not stay mysteriously grey
- [ ] A legal pick such as **91 / 100** → Next: Set Pricing succeeds (not “Too many variants”)
- [ ] Markup 70%, “Suggested prices applied”
- [ ] S–XL front ≈ $19.95, front+back ≈ $29.95 (not equal)
- [ ] 2XL+ front higher than S; 4XL/5XL not $19.95
- [ ] No second XS/4XL/5XL row at $0.00
- [ ] Confirm → Create Page works after a slow walk through the wizard (no `401 invalid token`)

## Tests

```bash
npx vitest run shared/printifyCostLabels.test.ts shared/variantCombinations.test.ts shared/condenseVariantPrices.test.ts
```

## Related (not this wizard)

- Storefront cotton crew placer: `docs/framed-known-good-snapshots/unisex-cotton-crew-tee-bp5.md` (pin `eafd244`)
- Shadow SKU / cart mockup: `docs/cart-checkout-custom-mockup-architecture.md`
