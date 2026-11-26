# Credential tenancy — inventory only

Status: **not started.** Do not implement from this list until it is picked up on purpose.

Sweep date: 2026-10-14. Branch base: staging after `5421d8ae`, plus the checkout catalogue-token change in the same commit as this ticket.

The pattern is a credential that is not the one the call is supposed to use: `someToken || process.env.…`, or a merchant/installation row other than the one that owns the request.

Already done, not in the open list:

- Shipping-table sync (`server/shipping-tables.ts`) uses `PRINTIFY_API_TOKEN` only.
- Checkout catalogue quotes (`platformCatalogueShippingToken` in `server/printify-checkout-shipping.ts`) use `PRINTIFY_API_TOKEN` only and throw when it is missing or Printify rejects the catalogue URL.

Classes:

- **CATALOGUE** — `/v1/catalog` or `/v2/catalog`. Platform token only. No merchant token.
- **MERCHANT-SCOPED** — the merchant who owns the request. Their token only. Missing or rejected token is a reconnect error. No env fallback and no other merchant.
- **PLATFORM-OWNED** — a platform operation that legitimately uses the platform token or the platform shop. It still must not borrow some other merchant when that credential is missing.

**Writes** means the call can `POST` to a Printify shop (`/shops/{id}/products`, `/uploads`, `/orders`), so the wrong token puts objects in the wrong account. Catalogue GETs are not writes.

---

## Printify

| # | Where | What it does today | Class it should be | Writes |
|---|---|---|---|---|
| 1 | `resolveCatalogPrintifyToken` in `server/routes.ts` (~16179). Admin blueprint, provider, and variant routes. | Merchant token, then `PRINTIFY_API_TOKEN`. | **CATALOGUE** | No |
| 2 | Same helper, used by the blueprint front+back probe (`probeFrontAndBackCosts`, shop `products.json`). | Same merchant-then-env token. Shop id is the merchant's (env shop id fallback removed). | **MERCHANT-SCOPED** | **Yes.** Temp product on that shop. |
| 3 | Platform-ref cost route, `server/routes.ts` ~20757. `catalogToken \|\| merchant.printifyApiToken` when `isPlatformCatalogRef`. | Env token first. If `PRINTIFY_API_TOKEN` is empty, the requesting merchant's token. The waterfall then creates a temp product. | **CATALOGUE** for the read. The temp-product write is **PLATFORM-OWNED** and must not land in the merchant's shop. | **Yes.** |
| 4 | `handlePrintifyImportRequest` (~17186) via activate-product (~25690), `printifyTokenOverride: PRINTIFY_API_TOKEN`. | Setup import uses the env token. If the override is absent, #1 applies. The Printify calls inside the import handler are catalogue GETs (blueprint, providers, variants). | **MERCHANT-SCOPED.** Setup must use the merchant token saved in Settings. | No Printify shop POST in the import handler. It still never sends the merchant's token. |
| 5 | `resolvePlatformPrintifyCreds` in `server/routes/platform-calibration.ts` (~943). | If `OWNER_SHOP_DOMAIN` has a token and shop id, that owner row replaces the signed-in merchant. Then token and shop id fall back to `PRINTIFY_API_TOKEN` / `PRINTIFY_SHOP_ID`. | **PLATFORM-OWNED.** Fail if the platform token's shops do not contain the pinned shop. Do not substitute the owner merchant. | **Yes.** Harvest uploads and creates products. |
| 6 | `listHarvestCredsForProvider` in the same file (~611). | Env account only when both env token and `PRINTIFY_SHOP_ID` are set. Otherwise the owner merchant. After that account fails: listing merchant, session merchant, platform merchant. | **PLATFORM-OWNED.** Same rule as #5. `PRINTIFY_SHOP_ID` is unset on staging, so this is why blueprint 145 ran on shop 28205177. | **Yes.** |
| 7 | `server/routes/platform-aop-mapper.ts` (~72). | Same owner-merchant replacement, then env token and `PRINTIFY_SHOP_ID`. | **PLATFORM-OWNED.** | **Yes.** Mapper uploads and can create a product. |
| 8 | `server/oos-catalogue-report.ts` (~360) and `server/product-intelligence-sync.ts` (~690). | Platform-ref rows use the env token. Every other product type uses that row's merchant token, then `PRINTIFY_API_TOKEN`. | **CATALOGUE** | No. Variants and catalogue shipping. |
| 9 | `resolvePlatformMerchantId` in `server/platform-catalogue-pi.ts` (~34). | Platform catalogue rows are stored on the `OWNER_SHOP_DOMAIN` merchant, else on whichever merchant already owns a platform ref. | **PLATFORM-OWNED** (which row owns the ref). Not a Printify HTTP fallback, but it is another row. | No Printify write. |
| 10 | `runCreatorCartPrintifyTest` in `server/routes/creators.ts` (~1667). | Gate passes if the signed-in merchant has a token, else the platform shop's merchant. `submitCreatorCartTestOrder` then submits for `CREATOR_PLATFORM_SHOP_DOMAIN`. | **PLATFORM-OWNED** draft order on the creator platform shop. The signed-in merchant is only a presence check. | **Yes.** Draft Printify order. |
| 11 | `scripts/harvest-flat-mockups.ts`, `scripts/harvest-tapestry-size-mask.ts`, `scripts/harvest-decal-size-mask.ts`. | Product-row token and shop id, then `PRINTIFY_API_TOKEN` / `PRINTIFY_SHOP_ID`. Tapestry and decal call `harvestFlatCalibration`. | **MERCHANT-SCOPED** to the product type's merchant, or **PLATFORM-OWNED** if the script is declared operator-only. Not both. | **Yes.** Upload and `POST /shops/{id}/products`. |
| 12 | `scripts/run-aop-calibration.ts` (~569). | `product.printify_api_token \|\| PRINTIFY_API_TOKEN`, and the same for shop id. | Same as #11. | **Yes.** Calibration run creates Printify products. |
| 13 | `scripts/pull-printify-catalog-costs.ts` `resolveShopId` (~67). | Env token only. Shop id is `PRINTIFY_SHOP_ID`, else **the first shop** on `shops.json`. | **PLATFORM-OWNED**, and the shop id has to be the pinned one. First-shop is the silent pick. | **Yes.** Upload and `POST /shops/{id}/products`. |

Order submit (`server/flat-order-fulfillment.ts`) already requires that order's merchant token and shop id. It is not in this list.

Operator scripts that read `PRINTIFY_API_TOKEN` and nothing else (`diag-bp450.ts`, `diag-printify-pocket-areas.ts`, `printify-render-*.ts`) are platform-only already. They are not fallbacks.

---

## Shopify

No `SHOPIFY_ACCESS_TOKEN` env fallback turned up. Offline admin tokens are read from `shopify_installations` for the shop on the request. These are the places that still take a second credential:

| # | Where | What it does today | Class it should be | Writes |
|---|---|---|---|---|
| S1 | `trimEnv` in `server/shopify-app-credentials.ts` (~30) and `getShopifyApiSecret` in `server/replit_integrations/auth/replitAuth.ts` (~63). | `SHOPIFY_API_SECRET`, then `SHOPIFY_API_SECRET_KEY`, then (`replitAuth` only) `SHOPIFY_API_SECRET_SECRET`. | **PLATFORM-OWNED** app secret. Alias chain, not another shop. | No shop admin write. Session JWT verify. |
| S2 | `getCreatorPlatformStorefrontToken` in `server/creator-config.ts` (~100). | `CREATOR_STOREFRONT_API_TOKEN`, then `CREATOR_PLATFORM_STOREFRONT_TOKEN`. | **PLATFORM-OWNED** storefront token for `CREATOR_PLATFORM_SHOP_DOMAIN`. | Storefront cart/checkout on that shop. |
| S3 | `server/shadow-storefront-visible.ts` (~103). | `SHOPIFY_STOREFRONT_PASSWORD`, then `STOREFRONT_PASSWORD`. | **PLATFORM-OWNED** storefront password. | No Admin API. |
| S4 | `getCreatorPlatformShopCandidates` (`server/creator-config.ts` ~78), used by `ensureCreatorCheckoutWebhooksForPlatformShop` and `ensurePlatformCarrierService`. | Env shop, then rename aliases (`whi6jd-nv` / `aiartstudio-creators`) and `CREATOR_PLATFORM_SHOP_ALIASES`. First installation with a live token wins. | **PLATFORM-OWNED**, limited to those aliases. A typo in the alias list would register webhooks or a carrier on the wrong shop. | **Yes.** Webhook registration and carrier service on the chosen shop. |

`body.shop || getCreatorPlatformShopDomain()` in `server/routes/creators.ts` is a shop-domain default for analytics and cart identity. It does not load that shop's Admin token.

---

## Called out

### Platform-ref cost route (#3)

When `PRINTIFY_API_TOKEN` is empty, a platform catalogue product's cost waterfall uses the **requesting merchant's** token and can create a temp product in **that merchant's** shop. Platform work then depends on a merchant credential and leaves a product in their Printify account. With the env token set, the same route still resolves the merchant's shop id against whatever token it picked.

### activate-product → `handlePrintifyImportRequest` (#4)

Setup passes `PRINTIFY_API_TOKEN` as `printifyTokenOverride`. A merchant who saves their own token in Settings and runs the setup import is still served from the platform token. The import handler's Printify calls are catalogue reads, so this does not by itself create a Printify product in the platform shop. It does mean setup never runs on the merchant's token, which is the opposite of "enter a token in Settings and everything works with no env change."
