# Creator Marketplace (Creator Beta)

Phased feature. See the Cursor plan for full architecture. This doc tracks **Phase 0–1** ops prerequisites and env vars.

## Environment

| Variable | Purpose |
|----------|---------|
| `CREATOR_MARKETPLACE_ENABLED` | `true` / `1` to enable public apply + admin APIs |
| `CREATOR_PLATFORM_SHOP_DOMAIN` | Platform Shopify shop (`{handle}.myshopify.com`) that will back creator storefront checkouts (Phase 2+) |

Seeded on boot (idempotent): `platform_config.AI_GENERATION_COST_USD = 0.05`.

## Phase 0 checklist (manual — do not automate without approval)

1. **Choose platform store** — preferably a dedicated Shopify store (or staging demo) for all creator subdomain checkouts. Set `CREATOR_PLATFORM_SHOP_DOMAIN`.
2. **Storefront API token** — create a Storefront API access token on that shop (needed Phase 3+ for cart/checkout).
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
