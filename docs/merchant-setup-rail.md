# Merchant setup rail (platform catalogue first)

Replaces the old "import from Printify → create product → create page" manual
flow for brand-new merchants with a forced-progression, Shopify-first rail:
install → enable App Embed → **Preview** a platform-catalogue product →
connect Printify → set pages **Live** on Customizer Pages.

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
3. **Preview a Customizer Product** — merchant picks any published entry
   from the platform catalogue (`platform_catalog_blueprints`). Preview uses
   the **platform's own** `PRINTIFY_API_TOKEN` (catalog reads only) so it
   works before the merchant has any Printify account. A Shopify product +
   Shopify page + `customizer_pages` row with `status: "preview"` are created;
   **Preview Your Page** opens a signed merchant-preview link. Merchants may
   Preview many products (preview pages do not consume Live plan slots).
4. **Connect Printify → go Live** — required before customers see the page.
   Connect Printify from Customizer Pages (or Settings). Then **Create Page** /
   **Add to store** / toggle **Set Live** on Customizer Pages. Live requires
   Printify + an available plan slot (`status: "active"` only).

## Page statuses

| Status | Who sees it | Plan slot | Fresh design |
|---|---|---|---|
| `preview` | Merchant via signed preview token only | No | Yes (on preview link) |
| `active` (Live) | Customers (Printify must be connected) | Yes | Yes |
| `disabled` | Saved-design reopen only (`savedDesignId`) | No | No — ATC only |

## Locked rules (do not regress)

- **No public Live page without Printify.** An `active` customizer page is
  never reachable by an anonymous storefront visitor until
  `isPrintifyConnected(merchant)` is true, *unless* the request carries a
  valid signed `appai_preview` token. Preview pages are never public.
- **Plan limits count Live (`active`) pages only** — not preview or disabled.
- **Generation is capped at the trial/tester bucket (20 lifetime) until
  Printify is connected** — regardless of the merchant's paid plan. See
  `resolveQuotaContext()` in `server/generation-quota.ts`.
- **"Not now" is a dismissal, not an unlock.** Only closes the nag modal for
  the rest of the calendar day (`localStorage`, `appai_printify_nag_dismissed_date`
  in `PrintifyNagModal.tsx`).
- **Enabling the App Embed cannot be automated.**
- **Disabled + saved designs:** ATC OK; **Start Fresh Design** / new generate
  blocked (`freshDesignAllowed: false` from proxy → theme embed → iframe).

## Admin surfaces

| Surface | Role |
|---|---|
| Setup | Multi-preview cards; Preview Your Page; link to Customizer Pages for Printify |
| Products Catalogue | Browse catalogue; Details; Preview / Create Page / Add to store (no Connect Printify here) |
| Customizer Pages | Connect Printify banner; Preview / Live / Disabled badges; Create Page wizard → Live; edit settings |

## Server pieces

| Piece | File |
|---|---|
| `isPrintifyConnected` (dependency-free) | `server/printify-connection.ts` |
| Preview JWT sign/verify, `ensureTrialStarted`, `getMerchantSetupStatus` | `server/merchant-setup.ts` |
| `GET /api/appai/setup/status` | `server/routes.ts` |
| `POST /api/appai/setup/confirm-embed` | `server/routes.ts` |
| `GET /api/appai/setup/catalog` | `server/routes.ts` |
| `POST /api/appai/setup/activate-product` — creates `status: "preview"` | `server/routes.ts` |
| `GET /api/appai/setup/preview-url` | `server/routes.ts` |
| Printify + status gates on `GET /api/proxy/customizer-page` (`freshDesignAllowed`) | `server/routes.ts` |
| PATCH status `preview` \| `active` \| `disabled` (Live needs Printify + plan) | `server/routes.ts` |
| Trial/tester quota force in `resolveQuotaContext()` | `server/generation-quota.ts` |
| OAuth → `/admin/setup` deep link | `server/shopify.ts` |
| `embed_confirmed_at` column | `shared/schema.ts`, `server/migrations/startup.ts` |

## Client pieces

| Piece | File |
|---|---|
| Setup rail UI | `client/src/pages/admin/setup.tsx` |
| Catalogue cards (preview + catalogue modes) | `client/src/components/admin/CatalogActivateSection.tsx` |
| Products Catalogue page | `client/src/pages/admin/products.tsx` |
| Customizer Pages + Printify banner + promote deep-links | `client/src/pages/admin/customizer-pages.tsx` |
| Storefront `freshDesignAllowed` | `client/src/pages/embed-design.tsx`, `extensions/theme-extension/assets/appai-art-embed.js` |
| Printify nag modal | `client/src/components/admin/PrintifyNagModal.tsx` |
| Setup status hook | `client/src/hooks/use-setup-status.ts` |
