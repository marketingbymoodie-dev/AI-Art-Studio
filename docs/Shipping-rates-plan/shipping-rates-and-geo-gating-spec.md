# AI Art Studio — Shipping Rate Automation & Geo-Gated Storefronts

**Spec for implementation planning.** Two features, one shared data foundation:

1. **Table Mode shipping** — automatically generate Shopify delivery profiles with weight-banded rates from Printify's published shipping tables, for every product in the catalogue now and every product imported in the future. Works on Basic-plan stores (no Carrier-Calculated Shipping / CarrierService API required).
2. **Geo-gating** — prevent an end user from seeing (and especially from *generating art for*) any product that can't ship to their country. Applies to both creator subdomain storefronts (`*.aiartstudio.app`) and merchant stores running the Shopify app.

The core insight both features share: **the Printify shipping table is the single source of truth.** Shipping rates, shippability-per-country, and weight bands are all derived views of the same data. Build the ingestion once; both features consume it.

---

## Part 0 — Shared foundation: Shipping Coverage Service

### 0.1 Ingest Printify shipping tables

- For every (blueprint_id, print_provider_id) pair in use, fetch the shipping table from the Printify API: `GET /v1/catalog/blueprints/{blueprint_id}/print_providers/{print_provider_id}/shipping.json`. Response contains per-country (and rest-of-world) `first_item` and `additional_items` costs per variant group, plus handling time.
- For **Printify Choice** products, the published Choice table is the *ceiling* price (actual cost may be lower if Choice routes to a cheaper local provider). Ingest the ceiling and use it everywhere. Any routing savings accrue to the merchant — never quote below ceiling.
- Persist raw tables and a normalised form (schema below). Record a content hash per table.
- **Nightly sync job**: re-fetch all tables, diff by hash, and trigger downstream rebuilds (profiles, coverage matrix, Markets publication) only for changed tables. Log every change (old rate → new rate) for audit.

### 0.2 Normalised schema (Postgres/Prisma — matches existing stack)

```prisma
model ShippingClass {
  id            String   @id @default(cuid())
  blueprintId   Int
  providerId    Int      // print provider; for Choice use the Choice pseudo-provider id
  name          String   // e.g. "Framed Prints — Provider X"
  tableHash     String
  updatedAt     DateTime @updatedAt
  rates         ShippingRate[]
  variants      VariantShipping[]
  @@unique([blueprintId, providerId])
}

model ShippingRate {
  id              String  @id @default(cuid())
  shippingClassId String
  countryCode     String  // ISO 3166-1 alpha-2, or "ROW" for rest-of-world
  variantGroup    String? // Printify groups rates by variant/size cluster; null = all
  firstItemCents  Int
  additionalCents Int
  currency        String  @default("USD")
  shippable       Boolean @default(true) // false when we exclude a zone (see 0.4)
  @@unique([shippingClassId, countryCode, variantGroup])
}

model VariantShipping {
  id              String @id @default(cuid())
  shippingClassId String
  productId       String // our catalogue product id
  shopifyVariantId String?
  variantGroup    String?
  pseudoWeightGrams Int  // see Part 1
}
```

### 0.3 Coverage matrix (the geo-gating source of truth)

Materialise a fast-lookup view/table:

```
coverage(product_id, country_code) -> { shippable: bool, first_item_cents, additional_cents }
```

- A (product, country) is **shippable** iff its ShippingClass has a rate row for that country (or ROW) with `shippable = true`.
- Expose as an internal API used by: profile generator, creator storefront catalog queries, customizer gate, merchant-app Markets sync, and theme extension endpoint.
- Cache aggressively (per-country product-id sets in Redis or in-memory with TTL keyed on tableHash) — this is called on every storefront page load.

### 0.4 Zone exclusion rules (operator-configurable)

Not every technically-available rate should be offered (e.g. framed print → Australia at $197.59 first item). Add per-class rules:

- **Tiered zone rules** (evaluated per class/group × zone, operator-editable): compute `ratio = firstItemCents / typicalRetailCents`, where `typicalRetailCents` = median suggested retail of the group's products (fall back to catalog cost × default markup if retail unset).
  - `ratio ≤ offerThreshold` (default 0.40) → **normal**: zone offered, no special treatment.
  - `offerThreshold < ratio ≤ excludeThreshold` (default 0.80) → **offered-with-warning**: zone gets full profile rates, but storefronts must (a) badge the product for buyers in that country ("International shipping from $45.89") and (b) show the buyer's shipping estimate in the customizer **before** art generation is allowed. Prevents wasted generations via informed consent without abandoning the sale. (Real example: Canada framed prints at $45.89 first item ≈ 65% of retail → this tier.)
  - `ratio > excludeThreshold` **or** `firstItemCents > absoluteCapCents` (per-class, default 15000) → **excluded**: `shippable = false`, zone omitted from profiles, hidden per Part 2. (Real example: Australia framed prints at $197.59 → excluded automatically.)
- Manual per-class country blocklist/allowlist overrides the tiers in both directions.
- Coverage matrix (0.3) stores `tier` (normal | warned | excluded) alongside `shippable`, so storefront and customizer consumers can render badges and pre-generation estimates. "US Only" and warning badges are emergent properties of the data, never hand-maintained catalogue labels.
- Optional UI badge derived automatically: if a product ships to exactly {US} → "Ships to US only"; to {US, CA} → "Ships to US & Canada", etc.

---

## Part 1 — Weight-band algorithm (automatic, per shipping class)

### 1.1 Why pseudo-weights

Shopify static rates can't express "first item $X, each additional $Y". We encode the *additional-item cost* into variant weight so that weight-conditional rates approximate the Printify curve. Shopify sums the applicable rate from each delivery profile in the cart, so cross-category stacking (framed print + pillow + tee = three profiles, three rates summed) already mirrors how Printify actually bills. The bands only need to solve the *within-class* additional-item discount.

### 1.2 Weight assignment (per variant)

```
pseudoWeightGrams = additionalCents for that variant's group in the class's
                    REFERENCE ZONE (use "US" if present, else cheapest zone)
```

i.e. **1 gram = 1 cent of additional-item cost**. A $5.89-additional tee weighs 589 g; a $9.99-additional large framed print weighs 999 g. Cart weight within a profile = total additional-cost of the cart in cents.

Write this weight to the Shopify variant (`weight`, unit GRAMS) at import/sync time.

> **Caveat (must appear in plan):** variant weight is also used by customs forms, label purchase, and any other installed app that reads weight. Because fulfilment is via Printify (they generate labels/customs from their own data), risk is low — but (a) document it for merchants in the app's onboarding copy, (b) gate the weight-write behind a per-store setting `manageVariantWeights` defaulting to ON, and (c) never overwrite weights on products the app didn't create/import.

### 1.3 Rate-band generation (per class, per shippable zone)

Definitions for zone Z, class C:

```
delta(Z)  = max over variant groups of (firstItemCents - additionalCents)   // merchant-favourable
step      = min additionalCents across variant groups in C (reference zone) // band width
scale(Z)  = additionalCents(Z) / additionalCents(referenceZone)             // per-group; use max across groups
maxBands  = 12 (config)                                                     // covers 12+ items
```

**Group-splitting rule (important):** compute `delta_g = firstItemCents − additionalCents` for each variant group g in the class. If `max(delta_g) − min(delta_g) > groupDeltaSplitThresholdCents` (config, default 200), generate **one delivery profile per variant group** instead of one per class, with each group's own exact delta and step. Rationale: a shared profile must price singles at the class-max delta, badly overcharging the cheapest group's single-item carts (real example: framed prints have group deltas of $5.90/$10.50/$10.80 — a shared profile charges a single 11×14 ≈ $16.79 vs true $11.89, while per-group profiles are penny-perfect for all same-group carts and only overcharge cross-group mixes by the smaller delta). Per-group profiles multiply profile count, so: verify Shopify's per-store delivery profile limit during implementation, track count per store, and if approaching the limit merge the groups with the smallest delta spread first.

**Grouping key (cross-zone):** variant groups must be derived from the **full per-zone rate vector**, not any single zone: two variants share a group iff their (firstItem, additional) pair is identical in *every* zone of the table. Real example: framed prints group 11×14 with 12×16/16×16 in the US table, but Canada prices 11×14 ($45.89) differently from 12×16/16×16 ($46.79) — so cross-zone grouping yields four groups: {11×14}, {12×16, 16×16}, {16×20, 16×24}, {12×36, 20×30}. Recompute grouping on every table change; a grouping change triggers a profile rebuild for the class.

**Cosmetic rounding (config):** after computing each band price, apply `priceRounding`:
- `up95` (default): smallest X.95 ≥ true band price (11.89 → 11.95, 22.28 → 22.95). Never undercharges; adds ≤ 94c.
- `nearest95`: nearest X.95, may undercharge by ≤ 49c — merchant/operator knowingly absorbs the difference. Per-surface setting (e.g. creator storefronts may enable, merchant app defaults to `up95`).
- `none`: exact band prices.
Rounding is applied per band after generation; the simulator (1.5) must assert its invariants against the *rounded* prices, and the `charged ≥ true` property is only required when rounding mode never rounds down.

Generate weight-conditional rates (per profile — class-level or group-level per the rule above; when group-level, `delta` and `step` use that group's own values, making same-group carts exact):

```
for k in 1..maxBands:
    lower = (k-1) * step + 1   (grams; band 1 starts at 0)
    upper = k * step
    priceCents(Z, k) = delta(Z) + ceil(upper * scale(Z))
final open band: lower = maxBands*step + 1, upper = none (unbounded)
    priceCents = delta(Z) + ceil(2 * maxBands * step * scale(Z))   // generous cap; log if ever hit
```

Properties (state these as acceptance criteria):
- Single item of any size: charged ≥ its true first-item rate (delta uses class max; small items slightly overcharged — cents, in merchant's favour).
- N identical items: within one band-step of true cost, always ≥ true cost.
- Mixed sizes in one class: approximation error bounded by (step + inter-group delta spread); must be validated by the test harness (1.5).
- **Never undercharges** relative to the Printify ceiling table.

### 1.4 Delivery profile sync (Shopify GraphQL Admin API)

- One app-owned delivery profile per ShippingClass per store: `deliveryProfileCreate` / `deliveryProfileUpdate` (requires `write_shipping` scope — add to both the merchant app and the custom checkout-store app).
- Profile membership: attach the product variants belonging to the class (`variantsToAssociate`).
- Zones: one location-group zone per shippable country/region; ROW modelled as an explicit rest-of-world zone **only if** ROW is shippable after exclusion rules. Omitted zone ⇒ Shopify shows "no shipping available" for that destination ⇒ hard enforcement at checkout.
- Rates: `deliveryMethodDefinitions` with weight-based conditions per band from 1.3. Name rates clearly, e.g. `Standard Shipping`, with `description` noting delivery window from the Printify table ("10–30 business days").
- **Idempotent reconciler**: desired-state generator (from DB) + differ + applier. Never blind-recreate profiles; patch in place. Store Shopify profile/zone/rate ids against ShippingClass per store. Handle Shopify's limits (profiles per store, rates per zone) with a pre-flight validation that fails loudly.
- Triggers: (a) product import/creation, (b) nightly table diff, (c) manual "resync shipping" button in operator UI and merchant-app settings, (d) `app/uninstalled` cleanup.

### 1.5 Test harness (build before wiring to live stores)

- Simulator: given a cart (list of variants + destination), compute (i) true Printify cost from raw tables, (ii) what the generated bands would charge. Property test over randomised carts (1–15 items, mixed classes/sizes, all zones): assert `charged >= true` and `charged - true <= tolerance` (config, e.g. ≤ $3.00 or ≤ 15%, whichever larger — tune after first run and record chosen tolerance).
- Golden tests for the known catalogue: framed prints, pillows, tees, mixed cart from the conversation example.
- Run the simulator report as part of the nightly sync; alert if a table change pushes any cart shape past tolerance.

### 1.6 New-product hook (future imports)

On every product import/creation path in the app (merchant app import flow AND creator-platform catalogue additions):

1. Resolve (blueprint, provider) → ShippingClass (create + ingest table if unseen).
2. Compute and write pseudo-weight to variants.
3. Add variants to the class's delivery profile (create profile if first product of class on that store).
4. Upsert coverage matrix rows; invalidate caches.
5. Update Markets publication (Part 2.3) for merchant stores.

This must be one shared pipeline function (`onProductImported(productId, storeContext)`) called from both surfaces — no duplicated logic between the merchant app and creator platform repos.

**Supplier selection & switching (customizer page wizard):**
- When the wizard's Supplier step lists providers, ingest each candidate provider's shipping table **on demand, synchronously if uncached** — never leave a selectable provider in a "pending sync" state for shipping data.
- The Supplier step must display, per provider: ships-from country, post-exclusion ship-to coverage (with tier badges), and the first-item rate for the store's primary market — so e.g. an Australian merchant can see that an AU-based provider means cheap domestic shipping while a US provider means $45+ to reach their own customers.
- Changing the supplier on an existing customizer page re-runs the full pipeline (steps 1–5 above) as a new trigger: variants re-home to the new provider's ShippingClass/profiles, pseudo-weights recompute, coverage and Markets publication update. Old-class profile membership must be removed in the same reconcile.

---

## Part 2 — Geo-gating (no wasted art generations)

### 2.1 Principle

The expensive, irreversible step is **art generation**, not checkout. Enforcement layers, outermost first; every layer reads the same coverage matrix:

1. **Catalog visibility** — user never sees an unshippable product.
2. **Customizer gate** — generation is blocked (server-side) for unshippable (product, country), even via a direct/shared link.
3. **Add-to-cart / checkout** — Shopify's missing zone rates are the final backstop (already guaranteed by Part 1; treat reaching this layer as a bug + log it).

### 2.2 Creator subdomain storefronts (`*.aiartstudio.app` — Next.js on Railway)

**Country detection**
- Recommended: put Cloudflare (free tier) in front of the wildcard domain — it terminates `*.aiartstudio.app` and injects `CF-IPCountry` on every request; read it in Next.js middleware. (Wildcard DNS is already in place; this is a proxy toggle + origin rule to Railway.)
- Fallback if Cloudflare is not adopted: server-side IP geo lookup (MaxMind GeoLite2 or ipinfo) in middleware, cached per-IP.
- Always overridable: "Shipping to: 🇦🇺 Australia ▾" selector in the storefront header; persist choice in a cookie (`ship_country`); cookie beats IP. Default to detected country; unknown → default `US` with the selector prominent.

**Enforcement**
- Middleware resolves `country` and passes it via request context/headers to server components and API routes.
- All catalogue/product list queries filter server-side through the coverage matrix: `WHERE product_id IN coverage.shippableSet(country)`. No client-side-only filtering.
- Product detail page for an unshippable product (direct link): render a "Not available in {country}" state with the country selector and the product's actual ship-to list — do not 404 (creators will share links across borders).
- **Customizer/generation API**: server-side check `coverage(productId, country).shippable` before enqueueing any generation job; return a structured 409 with `shipsTo: [...]` for the UI. This is the non-negotiable gate.
- If a cart exists and the user switches country, re-validate cart lines; flag/remove newly-unshippable lines with a clear message before checkout handoff.
- Optional (config per storefront): "badge instead of hide" mode — show unshippable products greyed with "Ships to US only" badge. Default: hide in listings, informative state on direct link.

### 2.3 Merchant stores (Shopify app)

Merchant storefronts are Shopify themes we don't control, so use platform-native visibility plus an app-embed gate:

- **Shopify Markets publication sync**: for each store, the app maintains market/catalog publication so a product is only published to markets whose countries it ships to (from the coverage matrix). This natively hides products from foreign visitors on Markets-enabled storefronts and is the merchant-side analogue of 2.2's catalog filtering. Runs in the same `onProductImported` pipeline + nightly sync. (Verify current Markets/catalog GraphQL mutations and per-plan market limits during implementation — this API area has been changing; if a store's plan caps markets below what coverage requires, fall back to badge/gate layers and surface a notice in the app admin.)
- **Customizer gate**: the app's customizer surface (theme app extension / hosted customizer page) calls an app-proxy endpoint `GET /apps/aas/coverage?product={id}` which resolves buyer country (from request geo headers/localization context) and returns shippability + shipsTo list. Block generation server-side exactly as in 2.2 — the client check is UX, the server check is enforcement.
- **Merchant settings**: per-store toggle for hide vs badge behaviour, and visibility into the auto-managed ship-to list per product ("Framed Print 12×18 — ships to: US, CA").

### 2.4 Shared coverage API

One internal service, two consumers:

```
GET /internal/coverage?country=AU&productIds=...       -> bulk shippability (storefront queries)
GET /internal/coverage/sets?country=AU                 -> cached product-id set (listing filters)
GET /apps/aas/coverage?product=...                     -> app-proxy variant for merchant storefronts
```

All derive from the matrix in 0.3; cache-busted by tableHash.

---

## Part 3 — Store-specific notes

- **Creator checkout store (dedicated store, custom app)**: runs Table Mode via this system from day one. Separately, upgrade this store to **Grow (annual)** and implement **Exact Mode** (CarrierService live rates quoting Printify's shipping API per cart) *as a later phase* — the creator store is the production testbed for CarrierService before it's offered to merchants as a premium feature. Exact Mode is out of scope for this spec's build but the profile reconciler must cleanly disable Table Mode profiles when a store switches to Exact Mode (feature flag per store).
- **Merchant app**: Table Mode is the default and must fully work on Basic-plan stores. No CCS/CarrierService calls anywhere in the default path (attempting `carrierServiceCreate` on a Basic store fails — don't even probe unless the merchant opts into Exact Mode).

---

## Part 4 — Implementation phases (suggested)

1. **Foundation**: Printify table ingestion, schema, nightly diff sync, coverage matrix + exclusion rules, operator UI for thresholds/blocklists.
2. **Band engine + simulator**: weight algorithm, band generator, test harness with tolerance report. Gate phase 3 on green property tests.
3. **Profile reconciler**: Shopify delivery profile create/update/diff, variant weight writes, wired to the custom checkout store first (safe sandbox), then behind the merchant app import pipeline.
4. **Geo-gating, creator platform**: Cloudflare/geo middleware, country selector + cookie, filtered queries, customizer server gate, direct-link states.
5. **Geo-gating, merchant app**: Markets publication sync, app-proxy coverage endpoint, customizer gate, merchant settings + ship-to visibility.
6. **Hardening**: nightly simulator alerts, resync buttons, uninstall cleanup, docs/onboarding copy for merchants (weight management + how rates are calculated).

## Acceptance criteria (condensed)

- Importing any new Printify product results — with zero manual steps — in: correct pseudo-weights, membership in the right delivery profile, correct per-zone banded rates, coverage matrix rows, and (merchant stores) correct Markets publication.
- Nightly Printify rate change propagates to profiles and coverage within one sync cycle, with an audit log entry.
- Randomised cart simulation: charged ≥ true Printify ceiling cost, within configured tolerance, across all zones and classes.
- A visitor from an excluded country cannot: see the product in listings (default mode), generate art for it (server-enforced, both surfaces), or check out with it.
- A visitor with a direct link to an unshippable product sees an informative state with the ship-to list, not an error.
- Removing a zone via exclusion rules removes it everywhere (profiles, coverage, Markets) in one sync.
