# Launch notes

Merchant- and operator-facing behaviour to state at launch, plus blockers that must close first.

## Known behaviour

- **Restocked colours take up to 24 hours to become buyable.** Printify has no stock webhook. The daily Product Intelligence sync (15 min after boot, then every 24 h) flips a blank back to in stock, which unlocks it on the storefront; the same run re-ingests that class's shipping table and reconciles delivery profiles, so the colour is selectable and deliverable together. No operator action. Stock-outs follow the same path: a colour Printify sells out can stay selectable for up to 24 h; resolve's 409 out-of-stock guard and Printify order rejection are the backstops in that window.

## Blockers before production launch

- **Canonical option IDs** — `docs/tickets/WP-canonical-option-ids.md`.
- **Edit Variants PATCH does not touch Shopify** — `docs/tickets/WP-edit-variants-shopify-sync.md`.
- **Base products are buyable as blanks by direct URL** (2026-10-04): base products are `unlisted` (not in catalog, search or collections) but published to the Online Store, so `/products/<handle>` renders a working add-to-cart and `/cart/add.js` accepts base variant ids. Same code on production. Decision: keep published (Branch C needs the base addable) and gate checkout with the `appai-base-variant-guard` validation Function (fail-open, `blockOnFailure: false`), plus a UX redirect from the base product page to its customizer page. Built and on staging; not closed until proven on staging and fulfilment is shown to reject a forged design property (a fake `_design_id` passes the Function by design).
- **Fulfilment does not reject forged design properties** (verified 2026-10-04, `server/flat-order-fulfillment.ts` `resolveDesignForOrderLine`). The checkout Function only checks a design property is present, so these reach `orders/paid`:
  - **Fake id** (no such job) → line silently skipped: logged plus a `flat_order_submissions` row with `status: "skipped"`. No Shopify hold, tag or merchant notice; the order sits paid and unfulfilled until someone notices.
  - **Real id from another shop or customer** → **fulfilled with that job's artwork**. `storage.getGenerationJob(id)` is a global primary-key lookup, `generation_jobs.shop` is never compared to the order's shop, and a line `_appai_job_id` overrides the shadow's own `published_products.design_id`. With auto-fulfil on (`FLAT_ORDER_FULFILLMENT_ENABLED=true`, `sendToProduction: true`), Printify produces someone else's design, billed to that product type's merchant.
  - Containment: `FLAT_ORDER_FULFILLMENT_ENABLED` is unset on both Railway environments (checked 2026-10-04), so auto-fulfil cannot fire anywhere. **Do not set it in any environment running a build older than the fix below.**
  - **Fix (2026-10-04, staging):** `checkFulfillmentTenancy` refuses a job whose `shop` is not the order's shop (creator platform rename aliases count as one shop), refuses a shadow row from another shop, and refuses live orders with no shop. A shadow or design-product variant keyed to a *different real job* than the line's `_appai_job_id` holds the line. Creator-cart shadows keyed by cart line id (not a job) can't vouch, so those fall back to the shop check. Every AppAI line not sent to Printify is recorded in `flat_order_submissions.metadata.needsAttention`, listed at `GET /api/platform/fulfillment-attention`, and the Shopify order gets tag `appai-needs-attention` plus an appended note. Tagging needs `write_orders`: staging TOML only; **production TOML needs it at go-live** (re-prompts merchants). Without the scope the flag records `missing-scope` and the admin list still shows the order. Tests: `server/flat-order-fulfillment.tenancy.test.ts` (cross-shop real job id regression).
  - Residual (accepted conditionally, 2026-10-04): a forged `_appai_job_id` naming another real job **on the same shop** still prints that job's artwork when the line bought a plain base variant (no shadow to vouch). It stays within one merchant but can be another customer's design.
    - **Trigger: must close before Branch C Phase 2 (base-first ATC) goes default-on**, not merely before launch. Base-first ATC makes "base variant, no shadow yet" the normal shape of every AppAI line, so the shadow can no longer vouch for most orders.
    - **Job ids are obtainable by strangers — the gap is practical, not theoretical** (traced 2026-10-04). Generation job ids are UUIDs, not enumerable, but leak through:
      - **The storefront page URL.** Opening a saved design (My Designs, creator saved-designs menu, creator deep links, product switch) writes `?loadDesignId=<generation job uuid>` into the parent page's address bar (`embed-design.tsx` `loadSavedDesignInPlace` / `replaceCustomizerPageHistory`; theme `appai-art-embed.js` forwards it). A customer who copies the address bar to show a friend has published the job id.
      - **No ownership check on restore.** `GET /api/storefront/generate/status?jobId=&shop=` returns artwork, mockups and `designState` with only a shop match (`routes.ts` ~10091); `GET /api/storefront/shadow-variant/:jobId` is the same. So the leaked URL works as a share link: a stranger who opens it gets the design loaded and can add it to cart through the normal UI. That route doesn't need a forged property at all, and the shadow it mints vouches for the job, so a fulfilment-side fix alone doesn't close it.
      - Also carry the job id, but only to the buyer or the merchant: `/cart.js` and order JSON (`_appai_job_id`, `_shadow_design_id`, `_aop_pl`), and merchant notification emails that loop all line properties. The customer-visible `Artwork` property is just "Custom AI Design".
      - Do **not** carry it: the deliberate Share button (`?sharedDesignId=`, a separate id space), shadow product title/handle/tags on the current resolve path, and artwork/mockup storage paths. The exceptions are `lifestyle/<jobId>/` (admin) and `aop-line-snapshots/<jobId>/` (cart property).
    - Closing it needs two things. (a) Fulfilment requires a vouching record for base-variant lines, e.g. a server-issued signed line token, or the `shadow_mint_jobs` row from Phase 1, keyed to the line. (b) Product decision: either stop stamping the job uuid into the parent URL (use an opaque per-session token or storage), or add an ownership check (session/customer) to `generate/status` restore, so an accidentally shared address bar stops acting as a share link.
  - Behaviour change vs `b98442bc` ("line job id over a shared shadow"): a shadow keyed to a different real job now holds the line instead of printing the line's job. Staging has no shadow variant shared across real jobs, no shadow whose shop differs from its job's shop, and 4 shadows keyed by a non-job id (2026-10-04, 324 shadows). **Before this ships to production, run the same check on production data**, or legitimate lines could start being held on a store with shared shadows:
    ```sql
    with p as (
      select shopify_variant_id v, split_part(design_id, '::', 1) job, shop
        from published_products where shopify_variant_id is not null)
    select
      (select count(distinct v) from p) as shadow_variants,
      (select count(*) from (
         select p.v from p join generation_jobs j on j.id = p.job
          group by p.v having count(distinct p.job) > 1) x) as variants_shared_across_real_jobs,
      (select count(*) from p join generation_jobs j on j.id = p.job
        where lower(j.shop) <> lower(p.shop)) as shadow_shop_differs_from_job_shop,
      (select count(*) from p left join generation_jobs j on j.id = p.job
        where j.id is null) as shadow_key_not_a_job;
    ```
    Expected: the middle two counts are 0. A non-zero `shadow_shop_differs_from_job_shop` made up only of the creator platform rename pair (`whi6jd-nv` ↔ `aiartstudio-creators`) is fine, because the tenancy check treats those as one shop.
- **DECISION NEEDED — App Store listing vs checkout protection.** Shopify only runs a validation Function from a **public App Store app** on non-Plus plans; custom and unlisted apps need Shopify Plus. If AI Art Studio ships unlisted, every non-Plus merchant has **no** checkout protection against blank base-product orders. The redirect alone closes nothing (a hand-built `/cart/add.js` never loads the page). Options: list on the App Store; restrict to Plus; or accept the exposure and rely on fulfilment rejection only. Production TOML also needs `write_validations` at go-live, which re-prompts every installed merchant to approve scopes.

## App Store review — scope justifications

State these when listing; protected customer-data scopes need a stated reason.

- **`write_orders`** (protected customer data): tagging orders that need operator attention. When an order contains AI Art Studio items the app could not send to the print provider (missing or invalid artwork, a design that fails the shop ownership check, a print-provider error), the app adds the tag `appai-needs-attention` and appends a note listing the affected items, so the merchant sees the order needs manual handling instead of it sitting paid and unfulfilled. The app reads only the order's existing note and tags, to avoid duplicate notes, and writes only that tag and note. It doesn't modify line items, prices, customers, fulfilment or payment state. Code: `server/fulfillment-attention.ts`.
- **`write_validations`**: installs the app's checkout validation Function (`appai-base-variant-guard`). It blocks checkout of blank, undesigned base products that exist only to back the design studio. Fail-open (`blockOnFailure: false`). Code: `server/checkout-guard.ts`.
