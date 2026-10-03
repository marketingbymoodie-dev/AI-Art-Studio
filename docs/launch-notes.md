# Launch notes

Merchant- and operator-facing behaviour to state at launch, plus blockers that must close first.

## Known behaviour

- **Restocked colours take up to 24 hours to become buyable.** Printify has no stock webhook. The daily Product Intelligence sync (15 min after boot, then every 24 h) flips a blank back to in stock, which unlocks it on the storefront; the same run re-ingests that class's shipping table and reconciles delivery profiles, so the colour is selectable and deliverable together. No operator action. Stock-outs follow the same path: a colour Printify sells out can stay selectable for up to 24 h; resolve's 409 out-of-stock guard and Printify order rejection are the backstops in that window.

## Blockers before production launch

- **Canonical option IDs** — `docs/tickets/WP-canonical-option-ids.md`.
- **Edit Variants PATCH does not touch Shopify** — `docs/tickets/WP-edit-variants-shopify-sync.md`.
- **Base products are buyable as blanks by direct URL** (2026-10-04): base products are `unlisted` (not in catalog, search or collections) but published to the Online Store, so `/products/<handle>` renders a working add-to-cart and `/cart/add.js` accepts base variant ids. Same code on production. Fix pending decision (hide vs keep-published-and-gate; see conversation 2026-10-04).
