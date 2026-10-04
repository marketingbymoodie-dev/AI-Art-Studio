# AUDIT — tenancy isolation across every merchant-scoped endpoint

**Why:** one tenancy pass (2026-10) found two independent isolation gaps: fulfilment (`ef877191`) and product-type PATCH (`BLOCKER-product-type-patch-tenancy.md`). Both had a correctly guarded sibling route right next to them. Finding these one at a time while doing other work doesn't scale, so this ticket is a deliberate sweep.
**Goal:** every route that reads or writes merchant-owned data proves the caller owns it, and that rule is enforced by a test, not by convention.

## Surface (measured, not estimated)

There are about 350 `app.<verb>("/api/…")` routes in `server/routes.ts` and 23 files under `server/routes/`. Express `router.*` mounts are extra and need a separate grep. By prefix:

| Prefix | Routes | Expected guard |
|---|---|---|
| `/api/admin/*` | 76 | merchant session + row `merchantId` match (or platform-admin bypass) |
| `/api/platform/*` | 60 | platform admin only |
| `/api/storefront/*` | 53 | shop from App Proxy HMAC / normalized `.myshopify.com`; job access via `resolveStorefrontJobAccess` |
| `/api/appai/*`, `/api/proxy/*` | 41 | App Proxy signature → shop |
| `/api/creators/*`, `/api/creator/*` | 33 | creator session + creator owns row |
| `/api/dev/*`, `/api/debug/*`, `/api/staging/*`, `/api/internal/*` | 28 | must be unreachable in production (env gate) or operator-only |
| `/api/shopify/*`, `/api/orders/*`, `/api/shipping/*`, `/api/merchant/*`, `/api/designs/*`, `/api/product-types/*`, `/api/conversations/*`, other | ~60 | case by case |

## Method

1. **Inventory.** Write a script, `scripts/audit-route-inventory.ts`, that lists every route as method, path, file:line, middleware chain, and whether the handler references one of the known guards: `adminProductTypeAccessError`, `getAuthorizedInstallation`, `resolveStorefrontJobAccess`, `isPlatformAdminRequest`, an `eq(…merchantId…)` filter, or creator ownership helpers. Output a CSV. That list is the audit checklist and gets committed.
2. **Classify each route:** public by design / shop-scoped / merchant-scoped / creator-scoped / customer-or-session-scoped / operator-only / dev-only.
3. **Review each non-public route against four questions:**
   - Where does the tenant id come from? It must come from the session or the signature, never from the body or query alone.
   - Is the row loaded and its owner compared *before* any write or side-effect (Printify, Shopify Admin or Stripe calls)?
   - For writes, is there an allow-list of fields, or is `req.body` spread into storage?
   - For list endpoints, does the query filter by tenant, not just the response?
4. **Fix in batches by prefix**, one PR each. Don't mix audit fixes with features.
5. **Regression net.** Add a two-tenant integration test helper (merchant A and B, creator A and B, shop A and B) and one cross-tenant negative test per mutating route class. Optionally add a CI check that fails when a new `/api/admin/*` route doesn't reference a known guard.

## Known items to fold in

- `PATCH /api/admin/product-types/:id` (blocker ticket above).
- Storefront job-id routes that check shop only: `GET /api/storefront/generate/status` (also returns the owner's wallet credits), `GET /api/storefront/shadow-variant/:jobId`, and `resolve-design-variant` / pre-shadow mint. These are tracked under the loadDesignId ownership-check decision. They're customer/session-scoped, not merchant-scoped, but they're the same review question.
- Mass-assignment pattern: grep `storage.update*(…, req.body)` and `{ ...req.body }` across all routes.
- Dev, debug and staging routes: confirm a production env gate on each one.

## Out of scope

Shopify OAuth / webhook HMAC correctness. Those were already covered in the Shadow-SKU invariants and the uninstall race fix.

## Estimate

Inventory script plus classification: about 1 day. Review: about 2–3 days for 350 routes, mostly mechanical. Fixes depend on findings. Two-tenant test helper: about 0.5 day.
