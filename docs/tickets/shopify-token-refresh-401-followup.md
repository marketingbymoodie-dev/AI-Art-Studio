# Shopify offline-token refresh 401 (staging) — root-cause follow-up

**Status:** non-blocking; investigate later.
**Filed:** 2026-09-03 during ATC 401 triage.
**Symptom seen in Railway staging logs:**

```
[shopify-token] Refreshing offline token for ai-art-studio-staging.myshopify.com
[shopify-token] Refresh failed for ai-art-studio-staging.myshopify.com: 401 …
```

…followed sometimes by `shopifyApiCall` logging `Access token is invalid - shop needs to reinstall the app` (the shopify.ts:216 generic 401 message).

## What is NOT the problem

Diagnosis on 2026-09-03 (`scripts/diagnose-shopify-token.ts ai-art-studio-staging`) showed:

- `shopify_installations.id = 1`, `status = active`
- Stored `access_token` (`shpa…8269`, expiring format) works: Admin GraphQL `POST /admin/api/2025-10/graphql.json { shop { name } }` returns **HTTP 200 JSON** with the shop name.
- `refresh_token` is `shpr…283d`, `refresh_token_expires_at = 2026-12-01` (still ~90d valid).
- `access_token_expires_at = 2026-09-02T21:58Z` — that's ~9h *before* now, which is what triggers `ensureValidOfflineAccessToken` to attempt refresh on every hit.

So the access token itself is **not revoked**. The DB column expiry has slipped past Shopify's actual server-side grace, and Shopify's still honouring the token when we present it directly. Nothing needs a reinstall to keep the merchant working today.

## What IS failing

The `POST https://{shop}/admin/oauth/access_token` refresh call — inside `refreshOfflineToken()` in `server/shopify-offline-token.ts:130` — is returning **401** every time. Since we hit `needsAccessRefresh` on every request now (the column expiry is in the past), we're hammering that endpoint on every Admin op and logging a 401 each time.

## Likely causes (in order of probability)

1. **Rotated / consumed `refresh_token`.** Shopify rotates the refresh_token on every successful use. If two callers hit `ensureValidOfflineAccessToken` concurrently near expiry, one wins and persists the new pair; the other tries the *old* refresh_token and 401s. If the "loser's" persist ever raced ahead of the "winner's" persist, the DB could hold a stale refresh_token that Shopify has already invalidated. Look for concurrent-refresh races around the `access_token_expires_at = 2026-09-02T21:58Z` transition.
2. **Credentials mismatch.** `postWithEachApp` tries every configured client (primary + creators). If staging Railway has `CREATOR_SHOPIFY_API_KEY` / `CREATOR_SHOPIFY_API_SECRET` set alongside `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET` and the refresh_token was minted against one but neither succeeds now (rotated Partner secret, wrong toml deployed, etc.), all attempts 401.
3. **Partner secret rotated without redeploy.** Someone regenerated the API secret in the Partner dashboard but Railway env vars still hold the old one; token-exchange endpoints then 401 on `invalid_client`.

## How to reproduce / dig

- Run `npx tsx scripts/diagnose-shopify-token.ts ai-art-studio-staging` — proves access token still valid via GraphQL.
- Add an ad-hoc probe of `refreshOfflineToken(shop, current.refreshToken!)` from the same script (with a warning: this rotates on success and would invalidate whatever's stored). Compare the 401 body — Shopify usually returns `invalid_grant` (dead refresh_token) or `invalid_client` (creds mismatch); the two distinguish (1)/(2) from (3).
- Check Railway staging env for `SHOPIFY_API_KEY` + `SHOPIFY_API_SECRET` vs the value in the current staging Partner app; also check whether `CREATOR_SHOPIFY_API_KEY/SECRET` are set on staging (they may not need to be).

## What was shipped alongside this ticket

`docs/tickets/shopify-token-refresh-401-followup.md` (this file), plus the fixes in the related ATC token-hardening change:

- `GET /api/shopify/product-variants` — JSON-shape guard replaces the old fallback-then-crash flow with a clean `502 shopify_auth_or_upstream`.
- Product-push sites (`~4995`, `~5174`, `~5428`, `~20863`, `~21092`, `~21906` in `server/routes.ts`) route through `ensureValidOfflineAccessToken` with a fallback to `installation.accessToken`. All are inside `try/catch { warn }` — a helper 401 does not break the outer flow.

Neither depends on the refresh path being healthy; both stay green as long as the stored access token itself is still honoured. When Shopify eventually stops honouring the stale access token, refresh **must** be working — hence this ticket.
