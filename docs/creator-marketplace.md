# Creator Marketplace (Creator Beta)

Phased feature. See the Cursor plan for full architecture. This doc tracks ops prerequisites, env vars, and shipped phases.

## Environment

| Variable | Purpose |
|----------|---------|
| `CREATOR_MARKETPLACE_ENABLED` | `true` / `1` to enable public apply + admin APIs |
| `CREATOR_PLATFORM_SHOP_DOMAIN` | Platform Shopify shop (`{handle}.myshopify.com`) that backs creator checkouts |
| `CREATOR_STOREFRONT_API_TOKEN` | Preferred Storefront API access token (custom app on the platform shop) |
| `CREATOR_PLATFORM_STOREFRONT_TOKEN` | Legacy alias for the same token (optional) |
| `CREATOR_EMAILS_ENABLED` | `true` to actually send beta/partner emails (default: log only) |
| `CREATOR_PACK_GENS_BURN_ALLOWANCE` | `true` if pack-paid gens should burn creator monthly allowance |
| `CREATOR_PACK_VARIANTS_JSON` | Optional `{"5":"variantId",…}` override for pack SKUs |

Seeded on boot (idempotent): `platform_config.AI_GENERATION_COST_USD = 0.05`.

## Phase 0 checklist (manual — do not automate without approval)

1. **Choose platform store** — preferably a dedicated Shopify store (or staging demo) for all creator subdomain checkouts. Set `CREATOR_PLATFORM_SHOP_DOMAIN`.
2. **Storefront API token** — store admin → Settings → Apps → Develop apps → custom app → Storefront API scopes → Install → copy token → set `CREATOR_STOREFRONT_API_TOKEN` on Railway (staging first).
3. **Shopify Protected Customer Data** — production `orders/paid` / `refunds/create` webhooks stay commented in `shopify.app.production.toml` until PCD approval. File/renew the request so the creator revenue ledger can go live.
4. **Wildcard DNS** (later phase, approval required):
   - Railway custom domain: `*.aiartstudio.app`
   - DNS `CNAME *` → Railway target
   - Staging can use path fallback `/c/:username` until a staging wildcard exists

## Phase 1 shipped surfaces

| Surface | Path |
|---------|------|
| Beta landing | `/beta` |
| Creators landing | `/creators` |
| Shopify merchant landing | `/shopify-beta` |
| Application form | `/creators/apply` → `POST /api/creators/apply` |
| Admin queue | `/admin/platform/creators` (platform admin only) |

Emails are **not** sent automatically yet.

## Phase 2 — storefront shell (no DNS required yet)

| Surface | Path |
|---------|------|
| Path preview (staging) | `/c/{username}` · `/c/{username}/products` · `/about` |
| Subdomain (later) | `{username}.aiartstudio.app` — needs Railway wildcard + DNS |
| Public boot API | `GET /api/creators/storefront/:username` |

Visible statuses: `onboarding`, `active_beta`, `partner`, `paused` (paused shows a paused page).

### Wildcard DNS (production later — do not change until approved)

1. Railway **production** → Custom Domain → add `*.aiartstudio.app`
2. DNS provider → `CNAME *` → Railway target (see Railway “DNS records”)
3. Keep apex `aiartstudio.app` as today

Staging continues to use `/c/{username}` until a staging wildcard exists.

## Phase 3 — customizer + dual quotas + Storefront cart

| Surface | Path / behaviour |
|---------|------------------|
| Product list | `GET /api/creators/storefront/:username/pages` |
| Designer | `/s/designer?shop={platformShop}&page={handle}&creatorUsername=&creatorId=&storefront=true` |
| Dual quota | Creator monthly allowance → per-(creator, customer) free gens → wallet credits |
| ATC | Shadow resolve (Admin) → `POST /api/creators/cart/checkout` → Shopify `checkoutUrl` (skips theme cart on purpose) |
| Styles | Merchant `style_presets` when seeded; otherwise hardcoded `STYLE_PRESETS` so Creator customizer always shows the dropdown |
| Checkout image | Requires shadow variant (HTTPS mockup). Creator ATC blocks checkout if resolve falls back to the base catalog variant |
| Admin | Creator Marketplace → **Configure** on a creator → assign pages + quotas |

**Staging smoke test**

1. Set `CREATOR_STOREFRONT_API_TOKEN` on Railway staging (redeploy).
2. On `ai-art-studio-staging`, create 1–3 **Live** Customizer Pages (Path B).
3. Admin → Creator Marketplace → Configure creator → assign those pages → set status `active_beta` if desired.
4. Open `/c/{username}/products` → customize → generate → Add to cart → should redirect to Shopify checkout.
5. Confirm merchant storefront free-gens path is unchanged (no `creatorUsername` param).

## Phase 4 — attribution + analytics

| Piece | Behaviour |
|-------|-----------|
| Session | `POST /api/creators/analytics/session` — UTM/referrer/device; id in `sessionStorage` (`appai_creator_session`) |
| Events | `POST /api/creators/analytics/event` — `page_view`, `customizer_open`, `generation`, `atc`, `checkout_started` |
| Job stamp | `generation_jobs.creator_id` / `creator_session_id` (Phase 3) + `generation` event on success |
| ATC | `POST /api/creators/cart/checkout` records `atc` + `checkout_started` |
| Rollup | Daily job → `creator_daily_stats`; admin `GET /api/platform/creators/:id/stats?days=14` |

## Phase 7 — Creator Network rankings

| Piece | Behaviour |
|-------|-----------|
| Metric | `net_contribution` (sum of `creator_daily_stats.net_contribution_cents`) |
| Periods | `daily` / `weekly` / `monthly` / `lifetime` → `creator_rank_snapshots` |
| Cron | Nightly (+ boot) after daily rollup |
| Portal | `/api/creator/rank` — own rank, top %, share % only (Rank + Network tabs) |
| Admin | `/api/platform/creators/leaderboard` — full board on Creator Marketplace page |

Other creators’ numbers are never exposed on the portal or public routes.

## Phase 8 — generation credit packs

Customer top-ups on the **platform shop** via Shopify checkout (no Stripe). Wallet reuse: `grantStudioCredits({ source: "pack" })` / spend earned→pack / clawback prefers pack.

| Piece | Behaviour |
|-------|-----------|
| Catalog | `shared/storefront-credits.ts` — 5/$1, 10/$2, 20/$3 |
| Shopify SKUs | Auto-created on platform shop (`appai-pack-{id}`); variant ids cached in `platform_config` or `CREATOR_PACK_VARIANTS_JSON` |
| Checkout | `GET /api/creators/credits/packs` · `POST /api/creators/credits/checkout` → Storefront cart → `checkoutUrl` |
| Grant | Platform-shop `orders/paid` → `creator_pack_purchases` + pack credit grant (idempotent per order line) |
| Refund / cancel | Clawback pack credits; purchase row status `refunded` / `partially_refunded` |
| Allowance | Pack-paid gens **do not** burn creator monthly allowance by default (`CREATOR_PACK_GENS_BURN_ALLOWANCE=true` to opt in) |
| Ledger | Pack lines skipped in `creator_orders` P&L (wallet top-up, not product revenue) |
| UI | Creator embed Studio Credits dialog — buy pack buttons when out of gens |

Line attrs on pack cart: `_credit_pack_id`, `_appai_customer_id`, `_creator_id`, `_creator_username`.

## Phase 9 — Admin + Partner Program

| Piece | Behaviour |
|-------|-----------|
| Admin table | Creators list with 30d visitors/gens/orders/net + share % |
| Detail dialog | Tabs: Overview / Partner·beta / Financials / Payouts / Notes |
| Revenue share | Per-creator `share_basis`, `revenue_share_creator_pct`, `revenue_share_aas_pct` |
| Lifecycle | Actions: reactivate/extend/end beta, promote partner, pause, archive |
| Beta cron | Daily: 7/3/1-day reminders + auto `beta_completed` when `beta_end_at` passes |
| Emails | Templates logged to `creator_email_log`; **sent only if** `CREATOR_EMAILS_ENABLED=true` |
| Payouts | Manual ledger `creator_payouts` + outstanding = earned share − paid − pending |

## Phase 10 — Production hardening (code + checklist)

**Shipped in code**
- Shared `assertPublicCreatorApiContext` — platform shop + active status + id/username match
- Creator generate: platform-shop only; IP + creator rate limits
- Rate limits: apply, analytics, pack/cart checkout, portal OTP request + verify
- Admin APIs strip `otpCode` / `otpExpiresAt`
- Rollup upserts + rank inserts chunked for scale
- Portal APIs own-creator scoped via JWT (`requireCreator`)
- Feature env-gated (`CREATOR_MARKETPLACE_ENABLED`)

**Manual before production go-live**
1. Shopify **Protected Customer Data** approved → uncomment `orders/paid`, `refunds/create`, `orders/cancelled` in `shopify.app.production.toml` → redeploy production app
2. Production env: `CREATOR_MARKETPLACE_ENABLED`, `CREATOR_PLATFORM_SHOP_DOMAIN`, `CREATOR_STOREFRONT_API_TOKEN`
3. Optional: `CREATOR_EMAILS_ENABLED=true` only after reviewing templates
4. Wildcard DNS `*.aiartstudio.app` → Railway production (path `/c/:username` works without it)
5. E2E smoke: apply → onboard → storefront → generate → ATC → checkout → ledger → pack buy → portal rank
6. Explicit **yes, go live** before merging `production`

## Phase 6 — Creator Portal

| Surface | Path |
|---------|------|
| Login | `/portal/login` — email OTP via Resend |
| Dashboard | `/portal` — Today / Rank / Network / Performance / Styles |
| Auth API | `POST /api/creator/auth/request-otp`, `verify-otp`, `logout` · `GET /api/creator/me` |
| Data API | `GET /api/creator/stats`, `/orders`, `/performance`, `/styles` · `PATCH /api/creator/styles/:id` (enabled only) |

Sign-in statuses: `onboarding`, `active_beta`, `partner`, `paused`, `beta_completed`. Token: Bearer + httpOnly cookie `appai_creator_token`.

## Phase 5 — financial ledger

| Piece | Behaviour |
|-------|-----------|
| AI gen cost | On creator gen complete → `creator_generation_costs` (snapshot of `AI_GENERATION_COST_USD`) |
| Paid order | Platform-shop `orders/paid` → `creator_orders` + `creator_order_lines` (gross, discounts, COGS, txn fee, Product Profit, Net Creator Contribution, shares) |
| Refunds / cancel | `refunds/create` / `orders-cancelled` adjust `refund_cents` + recompute P&L |
| Daily rollup | `creator_daily_stats` fills `gen_cost_cents`, `orders`, `gross_cents`, `product_profit_cents`, `net_contribution_cents` |
| Admin | `GET /api/platform/creators/:id/stats` (money fields) · `GET /api/platform/creators/:id/orders` |
| Txn fee config | `CREATOR_TRANSACTION_FEE_PCT` (default 2.9) + `CREATOR_TRANSACTION_FEE_FIXED_CENTS` (default 30) |

**Formula:** Product Profit = gross − discounts − fulfilment/COGS − txn fees − refunds.  
Net Creator Contribution = Product Profit − AI generation costs (period rollup uses day sum of gen costs).

Production `orders/paid` / `refunds/create` still need Shopify PCD + toml subscribe before live merchant ledger data.

## Creator platform styles (assignment + availability)

Two products share the same `style_presets` table and category/base-ruleset (Decor / Apparel / any, apparel background-removal). They do **not** share create/edit permission.

| Product | Who creates styles | Who sees them |
|---------|--------------------|---------------|
| Shopify merchant app | Merchant via `/admin/styles` (`creator_scope = merchant`) | That merchant’s storefront only |
| Creator platform | Operator only. Creators cannot create or edit. | Only styles with an assignment row for that creator |

**Scope** is a property of the style (`global` = eligible to assign to anyone; `custom` = operator-made, still assigned explicitly). **Visibility** is the assignment row.

| Field | Who sets it | Meaning |
|-------|-------------|---------|
| `enabled` | Creator portal toggle | Their on/off. Default `true` on assign. Off hides from customers; still listed in portal. |
| `available` | Operator | Still offered. Unassign/retire sets `false` and **keeps the row**. Portal shows grey **Currently Unavailable** regardless of `enabled`. Re-offer sets `available = true` and preserves `enabled`. |

No assignment row = style does not appear. No global-disable-list. Assigned styles apply on every customizer page that creator can use; page `style_config` still filters by category after entitlement.

Storefront / generate require: assignment + `available` + `enabled` + style `is_active`.

Operator UI: `/admin/platform/creators` → Manage → **Styles**. APIs under `/api/platform/creators/:id/styles` (assign / retire / duplicate-exclusive) and `GET /api/platform/style-catalog`. Do not use `/api/admin/styles` for creator customs (those rows are hidden from the merchant Styles page).
