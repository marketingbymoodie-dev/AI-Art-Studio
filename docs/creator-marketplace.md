# Creator Marketplace (Creator Beta)

Phased feature. See the Cursor plan for full architecture. This doc tracks ops prerequisites, env vars, and shipped phases.

## Environment

| Variable | Purpose |
|----------|---------|
| `CREATOR_MARKETPLACE_ENABLED` | `true` / `1` to enable public apply + admin APIs |
| `CREATOR_PLATFORM_SHOP_DOMAIN` | Platform Shopify shop (`{handle}.myshopify.com`) that backs creator checkouts |
| `CREATOR_STOREFRONT_API_TOKEN` | Preferred Storefront API access token (custom app on the platform shop) |
| `CREATOR_PLATFORM_STOREFRONT_TOKEN` | Legacy alias for the same token (optional) |

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

## Phase 6 — Creator Portal

| Surface | Path |
|---------|------|
| Login | `/portal/login` — email OTP via Resend |
| Dashboard | `/portal` — Today / Rank (placeholder) / Network (placeholder + traffic) / Performance |
| Auth API | `POST /api/creator/auth/request-otp`, `verify-otp`, `logout` · `GET /api/creator/me` |
| Data API | `GET /api/creator/stats`, `/orders`, `/performance` (own creator only via JWT) |

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
