# Launch checklist

Tick an item only when it is done. A production promotion does not start while any box below is still open.

## Petposterous launch

- [ ] After the Petposterous promotion is on the production Railway backend, switch the Petposterous custom app off the staging backend. `shopify.app.petposterous.toml` still points `application_url`, the app proxy, and the auth redirect URLs at `https://ai-art-studio-staging.up.railway.app`. Move those to the production app URL (`https://appai-pod-production.up.railway.app` in `shopify.app.production.toml`), deploy that config, and confirm the Petposterous store is talking to production. Do this after the promotion, so the store is not pointed at production before that backend is ready.

## Commercial app launch (merchants)

- [ ] Merchant setup and onboarding modules for the Find my size guarantee line, the merchant's own refund policy link, and size charts per product type. All three stay off or empty by default. A new merchant does not inherit Petposterous guarantee copy, the Petposterous refund URL, or another product type's size chart.
