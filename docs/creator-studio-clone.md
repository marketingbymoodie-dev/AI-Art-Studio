# Creator checkout shop — Studio clone (checklist)

Custom-distribution **embedded** app on `aiartstudio-creators.myshopify.com`. Same production Railway code as the public AI Art Studio app. Shoppers still use `jane.aiartstudio.app`; this shop is checkout only.

**Back to [creator] store** is the homepage button on `aiartstudio.app` (`LastCreatorReturnButton`). Do **not** deploy checkout UI to this clone unless you later change that.

---

## Already done

- [x] Store `aiartstudio-creators.myshopify.com`
- [x] Primary domain `checkout.aiartstudio.app` (CNAME `checkout` → `shops.myshopify.com`)
- [x] Credentials-only **AI Art Studio Creators** installed (no admin home — expected)
- [x] Backend accepts a second client ID (`CREATOR_SHOPIFY_API_*`)

---

## You do (Dev Dashboard + Railway)

Prefer **converting** the existing Creators app (already locked to this shop) instead of creating a third app.

### 1. Turn Creators into an embedded Studio clone

Dev Dashboard → **AI Art Studio Creators** → Create version:

| Field | Value |
|---|---|
| App name | AI Art Studio Creators |
| **Embed app in Shopify admin** | **On** |
| App URL | `https://appai-pod-production.up.railway.app` |
| Preferences URL | empty |
| Webhooks API | `2026-07` |
| Scopes | copy from `shopify.app.creators.toml` (`access_scopes`) |
| Allowed redirection URL(s) | the three `redirect_urls` in that toml |
| App proxy | prefix `apps`, subpath `appai`, URL `https://appai-pod-production.up.railway.app/api/proxy` |

Also subscribe webhooks (same paths as the toml): `app/uninstalled`, `orders/paid`, `orders/cancelled`, `refunds/create`, plus GDPR compliance topics.

**Release** that version.

### 2. Copy credentials into Railway **production**

Settings of the Creators app:

- `CREATOR_SHOPIFY_API_KEY` = Client ID  
- `CREATOR_SHOPIFY_API_SECRET` = Client secret  

Also set:

```
CREATOR_MARKETPLACE_ENABLED=true
CREATOR_PLATFORM_SHOP_DOMAIN=aiartstudio-creators.myshopify.com
CREATOR_STOREFRONT_API_TOKEN=<Storefront API token from this app or shop>
```

Do **not** overwrite `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET` (those stay the public merchant app).

Redeploy production after saving env.

### 3. Reinstall so OAuth hits production

After Railway is live with the new env:

`https://appai-pod-production.up.railway.app/shopify/install?shop=aiartstudio-creators.myshopify.com&app=creators`

Or reopen the custom-distribution install link. You should land on **Setup** inside this shop’s admin (not `shopify.dev`).

### 4. Storefront API token

On the Creators app (or shop Develop apps): enable Storefront cart + product listing scopes, copy token into `CREATOR_STOREFRONT_API_TOKEN`.

### 5. Catalog on **this** shop

In the embedded app: create **Live** customizer pages (Path B), real prices, published to Online Store + Storefront/app channel. Staging pages will not sell here.

Creator Marketplace → assign those pages to a creator.

### 6. Shopify Payments

Turn on live payments on `aiartstudio-creators` when you are ready for real cards.

---

## We already wired in code (no extra Shopify deploy)

- Dual HMAC / OAuth / session JWT / token refresh  
- Install hint: `?app=creators`  
- `shopify.app.creators.toml` (paste `client_id` when you have it)  
- Scripts: `shopify:config:use:creators`, `shopify:deploy:creators` (**do not run** unless you want checkout UI on this shop)

`shopify app deploy` for this clone is **not** on the automatic staging/production extension path. Homepage Back-to-shop does not need it.

---

## After App Store approval (optional)

You can install public **AI Art Studio** on this shop if you want one app everywhere. Not required if the clone stays the platform-shop install.
