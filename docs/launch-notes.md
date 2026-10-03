# Launch notes

Merchant- and operator-facing behaviour to state at launch, plus blockers that must close first.

## Known behaviour

- **Restocked colours take up to 24 hours to become buyable.** Printify has no stock webhook. The daily Product Intelligence sync (15 min after boot, then every 24 h) flips a blank back to in stock, which unlocks it on the storefront; the same run re-ingests that class's shipping table and reconciles delivery profiles, so the colour is selectable and deliverable together. No operator action. Stock-outs follow the same path: a colour Printify sells out can stay selectable for up to 24 h; resolve's 409 out-of-stock guard and Printify order rejection are the backstops in that window.

## Blockers before production launch

- **Canonical option IDs** — `docs/tickets/WP-canonical-option-ids.md`.
- **Edit Variants PATCH does not touch Shopify** — `docs/tickets/WP-edit-variants-shopify-sync.md`.
- **Base products are buyable as blanks by direct URL** (2026-10-04): base products are `unlisted` (not in catalog, search or collections) but published to the Online Store, so `/products/<handle>` renders a working add-to-cart and `/cart/add.js` accepts base variant ids. Same code on production. Decision: keep published (Branch C needs the base addable) and gate checkout with the `appai-base-variant-guard` validation Function (fail-open, `blockOnFailure: false`), plus a UX redirect from the base product page to its customizer page. Built and on staging; not closed until proven on staging and fulfilment is shown to reject a forged design property (a fake `_design_id` passes the Function by design).
- **DECISION NEEDED — App Store listing vs checkout protection.** Shopify only runs a validation Function from a **public App Store app** on non-Plus plans; custom and unlisted apps need Shopify Plus. If AI Art Studio ships unlisted, every non-Plus merchant has **no** checkout protection against blank base-product orders. The redirect alone closes nothing (a hand-built `/cart/add.js` never loads the page). Options: list on the App Store; restrict to Plus; or accept the exposure and rely on fulfilment rejection only. Production TOML also needs `write_validations` at go-live, which re-prompts every installed merchant to approve scopes.
