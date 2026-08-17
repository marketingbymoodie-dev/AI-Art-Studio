# Shopify App Store review QA

Use this before you click **Submit for review**. Reviewers install on a **clean development store** and follow only the listing. Do not treat `ai-art-studio-staging` or `shop.aiartstudio.app` muscle memory as the review.

**Who checks what**

| Who | What they can prove |
|-----|---------------------|
| **Agent (Cursor)** | Live URLs, `shopify.app.production.toml`, webhook **code**, unit tests, current production build id. Cannot log into Shopify Admin or click a theme. |
| **You** | Fresh-store install, embed, Create Page, generate, ATC → cart/checkout mockup, billing, uninstall, listing copy, Partner webhook delivery logs. |

Checked below on **2026-08-17** against production (`aiartstudio.app` + Railway). Re-run the Agent column after any production deploy.

---

## Scoreboard (this pass)

| | Count |
|--|------:|
| Agent can check | 15 |
| Agent passed this pass | 14 |
| Agent flagged (confirm in Partners) | 1 (`app/uninstalled` not in toml) |
| You must still do | 16 |

Do **not** submit until the “You” section is ticked on a **new** development store with the **production** app.

---

## A. Agent checks (no Shopify login)

Mark: **pass** / **fail** / **you confirm**.

| # | Check | How | 2026-08-17 |
|---|--------|-----|------------|
| A1 | Production app healthy | `GET https://aiartstudio.app/api/health` → `ok` + `dbReady` | **pass** — `version` `4d64d67` (terms-link deploy) |
| A2 | Railway app URL healthy | `GET https://appai-pod-production.up.railway.app/api/health` | **pass** |
| A3 | Privacy policy public HTTPS | `GET https://aiartstudio.app/privacy` | **pass** 200 |
| A4 | Terms public HTTPS | `GET https://aiartstudio.app/terms` | **pass** 200, **revision 4** (copied from staging) |
| A5 | Landing API | `GET https://aiartstudio.app/api/creators/landing` | **pass** 200 |
| A6 | GDPR handlers exist | `server/shopify-gdpr.ts` — `customers-data-request`, `customers-redact`, `shop-redact` | **pass** (HMAC required; cannot fire a real webhook from here) |
| A7 | GDPR subscribed on production app | `shopify.app.production.toml` `compliance_topics` | **pass** in toml. **You** still confirm Partners → app → Webhooks shows them. |
| A8 | Uninstall handler + subscription | `POST /shopify/webhooks/uninstall` + `topics = ["app/uninstalled"]` in app toml | **pass** in code/toml. After `shopify:deploy:production`, version config must list `app/uninstalled` → `/shopify/webhooks/uninstall`. |
| A9 | PCD order/cart webhooks | Production toml still **comments out** `orders/paid`, `refunds/create`, `orders/cancelled`, `carts/*` | **pass** as documented. Do **not** advertise live order-ledger / pack-grant features until PCD is approved and those lines are uncommented + redeployed. |
| A10 | Embedded app | `embedded = true` | **pass** |
| A11 | App proxy | prefix `apps` / subpath `appai` → Railway `/api/proxy` | **pass** in toml |
| A12 | OAuth redirects | Railway production URLs only (not `shop.aiartstudio.app`) | **pass** |
| A13 | Scopes listed | See table below | **pass** (listed). **You** must justify each in the listing. |
| A14 | Customizer terms link uses app origin | `publicTermsHref` — ignores `shop.aiartstudio.app` / `*.myshopify.com` | **pass** (in `4d64d67`; you already verified on store) |
| A15 | Focused unit tests | `vitest` terms + marketplace + landing | **pass** 44 tests |

### Production scopes (justify in the listing)

```
read_products, write_products
read_themes, write_themes
read_content, write_content
write_publications
read_online_store_navigation, write_online_store_navigation
read_customers, write_customers
read_orders
write_resource_feedbacks
```

Why they exist (short): pages + theme embed, shadow SKU products, customer credits/identity, order context, resource feedback. Extra unused scopes get rejected.

### Agent cannot do

Install OAuth, Admin iframe, theme editor, Create Page, generate, ATC, checkout, billing charge, uninstall click, Partner webhook **delivery** logs, listing screenshots, support inbox reply.

---

## B. You — fresh store (production app)

Create a **new** development store. Install **AI Art Studio** (production Partner app), not Staging.

### B1. Install and admin

- [ ] Install → OAuth consent → land **inside** Shopify Admin on **Setup** (not Dashboard, not the public `aiartstudio.app` marketing page). Step 1 should already be done — no extra “Finish connecting this shop” banner.
- [ ] Setup / How-to explains: enable **Theme app embed** → Create Customizer Page → open storefront
- [ ] Theme editor → App embeds → **AI Art Studio** on (reviewers will miss this if the listing is vague)
- [ ] Create Customizer Page (cotton crew tee / blueprint 5 is the known-good wizard). No $0.00 rows, no silent “Next” grey-out over 100 variants
- [ ] Page is Live / publicly mountable
- [ ] Plan picker / billing: start a **test** charge, decline once, complete once. Uninstall must not leave a mystery bill
- [ ] Uninstall → reinstall still opens setup (uninstall webhook race guard)

### B2. Storefront (reviewers notice these immediately)

- [ ] Customizer loads on the Online Store (embed on)
- [ ] **Read the full terms** opens `https://aiartstudio.app/terms#customers` (not a Shopify 404)
- [ ] Generate artwork → mockup looks correct
- [ ] Add to cart → **cart thumbnail is the custom mockup** (shadow SKU), not the blank catalog image
- [ ] Checkout image is still that mockup
- [ ] Cart title/image do **not** navigate to a native/shadow PDP
- [ ] Hard refresh lands on the preview, not the page footer
- [ ] Repeat on **mobile** and, if you can, a second theme (not only Dawn)

See `docs/cart-checkout-custom-mockup-architecture.md` if cart/checkout image is wrong.

### B3. Listing pack (reviewers use this as the script)

- [ ] After-install steps match B1 (embed → create page → storefront)
- [ ] Screenshots: admin setup, storefront generate, cart with custom mockup
- [ ] Privacy URL: `https://aiartstudio.app/privacy`
- [ ] Terms URL: `https://aiartstudio.app/terms`
- [ ] Support email/inbox that you actually watch
- [ ] Scope justifications written (especially `read_customers` / `write_customers` / `read_orders`)
- [ ] Partners → Webhooks: GDPR three + confirm **`app/uninstalled`** is registered
- [ ] If you mention order history, credit packs from paid orders, or creator ledger: PCD must be **approved** and production toml webhooks uncommented first — otherwise drop that copy

---

## C. Commands (optional, after code changes)

```bash
npm run build
npx vitest run shared/termsContent.test.ts shared/creatorMarketplace.test.ts shared/landingContent.test.ts
```

GitHub **Staging Smoke Test** only hits health + Shopify status. It does not replace B2.

---

## D. Do not submit yet if

- Fresh-store cart still shows the generic product image
- App opens as a standalone marketing site instead of embedded Admin
- Listing does not mention enabling the theme embed
- `app/uninstalled` is missing in Partners
- Listing promises order/customer features that need uncommented PCD webhooks
