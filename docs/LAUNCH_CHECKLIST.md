# Launch checklist

Tick an item only when it is done. A production promotion does not start while any box below is still open.

## Petposterous launch

- [x] `shopify.app.petposterous.toml` points `application_url`, the app proxy, and the auth redirect URLs at `https://appai-pod-production.up.railway.app`. The Petposterous store uses that production backend.

## Commercial app launch (merchants)

- [ ] Merchant setup and onboarding modules for the Find my size guarantee line, the merchant's own refund policy link, and size charts per product type. All three stay off or empty by default. A new merchant does not inherit Petposterous guarantee copy, the Petposterous refund URL, or another product type's size chart.
