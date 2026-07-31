# Merchant setup rail (platform catalogue first)

Replaces the old "import from Printify → create product → create page" manual
flow for brand-new merchants with a forced-progression, Shopify-first rail:
install → enable App Embed → instantly activate a platform-catalogue product
→ preview it yourself → connect Printify to go live.

Goal: a brand-new merchant can see a working customizer page **before**
they've touched Printify at all, while making it structurally impossible to
(a) burn AI generations on a page nobody can fulfil, or (b) let real
customers land on an unfulfillable page.

## Flow

1. **Install + permissions** — automatic (standard Shopify OAuth). The OAuth
   callback (`server/shopify.ts`) deep-links straight into the embedded app's
   `/admin/setup` route instead of the generic `/admin/apps` page.
2. **Enable the App Embed** — the one step Shopify requires the merchant to
   approve manually (theme editor → App Embeds → toggle on). This **cannot**
   be automated by the app; the info icon on this step in `/admin/setup`
   explicitly says so. The merchant clicks "Open Theme Editor" (deep link to
   `https://{shop}/admin/themes/current/editor?context=apps`), then "I've
   enabled it" to record `shopify_installations.embed_confirmed_at`. This is
   an honesty-system confirmation, not a hard technical check — there is no
   reliable server-side way to detect App Embed on/off state.
3. **Choose a Customizer Page product** — merchant picks any published entry
   from the platform catalogue (`platform_catalog_blueprints`, same table
   used by the merchant/operator Printify-import flow). Activation uses the
   **platform's own** `PRINTIFY_API_TOKEN` (catalog reads only — blueprint
   print-providers, blueprint options) so it works before the merchant has
   any Printify account. A Shopify product + Shopify page + `customizerPage`
   row are created in one shot; "See your page" opens a signed
   merchant-preview link.
4. **Connect Printify** — required before the page is public. Until this
   happens: the page is invisible to real customers (proxy/embed gate) and
   generation is capped at the trial/tester allowance (quota gate). A daily
   nag modal reminds the merchant; "Not now" only dismisses the modal for the
   rest of the day — it never unlocks the page or the higher quota.

## Locked rules (do not regress)

- **No public page without Printify.** A customizer page is never reachable
  by an anonymous storefront visitor until `isPrintifyConnected(merchant)` is
  true, *unless* the request carries a valid signed `appai_preview` token
  scoped to that exact shop + page handle (the merchant's own "See your page"
  link). See `server/printify-connection.ts` (`isPrintifyConnected`) and
  `server/merchant-setup.ts` (`signPreviewToken` / `verifyPreviewToken` /
  `buildPreviewUrl`).
- **Generation is capped at the trial/tester bucket (20 lifetime) until
  Printify is connected** — regardless of the merchant's paid plan. This
  prevents tyre-kicker abuse of a page nobody can actually fulfil yet. See
  `resolveQuotaContext()` in `server/generation-quota.ts`.
- **"Not now" is a dismissal, not an unlock.** Only closes the nag modal for
  the rest of the calendar day (`localStorage`, `appai_printify_nag_dismissed_date`
  in `PrintifyNagModal.tsx`). It never flips a merchant into a "manual
  fulfillment, still public" mode — orders can't be filled without a
  connected Printify account, so the page stays merchant-only.
- **Enabling the App Embed cannot be automated.** It's a Shopify safety
  requirement enforced by Shopify itself (manual merchant approval in the
  theme editor). Don't try to "detect and auto-enable" this — surface it
  clearly instead (info tooltip on step 2 of `/admin/setup`).

## Server pieces

| Piece | File |
|---|---|
| `isPrintifyConnected` (dependency-free) | `server/printify-connection.ts` |
| Preview JWT sign/verify, `ensureTrialStarted`, `getMerchantSetupStatus` | `server/merchant-setup.ts` |
| `GET /api/appai/setup/status` — silently starts the trial, returns rail readiness flags | `server/routes.ts` |
| `POST /api/appai/setup/confirm-embed` — records `embedConfirmedAt` | `server/routes.ts` |
| `GET /api/appai/setup/catalog` — published platform catalogue for instant activation | `server/routes.ts` |
| `POST /api/appai/setup/activate-product` — platform-token import + auto Shopify product + page | `server/routes.ts` |
| `GET /api/appai/setup/preview-url` — mint a fresh preview link for an existing page | `server/routes.ts` |
| Printify-connected gate on `GET /api/proxy/customizer-page` + `/customizer-pages` | `server/routes.ts` |
| Trial/tester quota force in `resolveQuotaContext()` | `server/generation-quota.ts` |
| OAuth → `/admin/setup` deep link | `server/shopify.ts` |
| `embed_confirmed_at` column | `shared/schema.ts`, `server/migrations/startup.ts` |

## Client pieces

| Piece | File |
|---|---|
| Setup rail page (4 steps) | `client/src/pages/admin/setup.tsx` |
| Shared setup-status query hook | `client/src/hooks/use-setup-status.ts` |
| Daily Printify nag modal (mounted globally in the admin layout) | `client/src/components/admin/PrintifyNagModal.tsx` |
| Pure-CSS confetti burst for "See your page" | `client/src/components/admin/ConfettiBurst.tsx` |
| Sidebar "Setup" nav item | `client/src/components/admin-layout.tsx` |

## Storefront gate propagation

The Printify-connected gate has to be honored by three different storefront
scripts, in order of who might see a not-yet-public page first:

1. `extensions/theme-extension/assets/appai-customizer-embed.js` (redirect-only
   stub) — checks `publiclyMountable` on `/customizer-pages` list entries;
   forwards `appai_preview` from the URL so a merchant's own preview link
   isn't redirected away.
2. `extensions/theme-extension/assets/appai-customizer-tray.js` (floating
   launcher on other storefront pages) — filters out pages where
   `publiclyMountable === false` so it never advertises a page a customer
   can't actually open.
3. `extensions/theme-extension/assets/appai-art-embed.js` (primary embed,
   mounts the actual designer iframe) — forwards `appai_preview` on its
   `/customizer-page` fetch, and as a race-safety-net also reads
   `fallbackUrl` out of the 404 error body (not just `opts.fallbackUrl`) so a
   gated page still redirects even if the stub script above didn't win the
   init race.

## Known gaps / next steps

- The App Embed "enabled" state is **not** verified — it's merchant
  self-report. If this becomes a support burden, consider polling the
  Shopify Theme Asset API for the embed block's `disabled` flag (heavier,
  rate-limited, theme-specific).
- The nag modal's "once per day" dismissal is `localStorage`-scoped to the
  browser/device, not server-tracked — a merchant using multiple devices/
  browsers will see it once per device per day, not globally once per day.
- Catalogue entries are limited to whatever's `published`/importable in
  `platform_catalog_blueprints` — the operator catalogue tooling
  (`/admin/platform/catalog`) is the source of truth for what shows up here.
