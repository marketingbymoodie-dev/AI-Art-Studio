# Merchant setup rail (setup → Products Catalogue → gated Live)

Brand-new merchants: install → enable App Embed → connect Printify → **Products
Catalogue** (Preview in-app and/or Create Page with supplier + suggested retail)
→ Live.

Goal: finish core setup first, then choose products from the catalogue. Preview
never creates a storefront page that can go Live at $0 with the wrong supplier.

## Flow

1. **Install + permissions** — Shopify OAuth → `/admin/setup`.
2. **Enable the App Embed** — theme editor (merchant-only; cannot be automated).
3. **Connect Printify** — Settings: API token + Shop ID (Detect).
4. **Products Catalogue** (prompted at end of setup) —
   - **Preview** — imports a `product_type` only (platform `PRINTIFY_API_TOKEN`),
     opens **Preview Studio** (`/admin/create-product`). **No** Shopify Online
     Store page and **no** `customizer_pages` row.
   - **Create Page** — Customizer Pages wizard:
     - Page info
     - **Print supplier** (merchant token)
     - **Pricing** — Printify costs **required**; suggested retail auto-applied
     - Confirm → Live (`status: "active"`)
   - Provider, pricing, variants, and Art Styles are managed on the Customizer
     Page (not as “settings below” on the catalogue).

## Locked rules

- Preview never creates a public/Live storefront page.
- Live requires Printify connected, a `printifyProviderId`, and retail prices &gt; $0.
- Suggested production costs must load successfully before Create Page can finish
  (not optional manual-only for Live).
- Plan limits count Live (`active`) pages only.
- Generation stays trial-capped until Printify is connected.

## Statuses (legacy + Live)

| Status | Meaning |
|--------|---------|
| `preview` | Legacy storefront draft pages (no longer created). Prefer in-app Preview. |
| `active` | Live for customers (Printify + prices) |
| `disabled` | Off; saved-design ATC may still work |

## Key files

| Piece | Path |
|-------|------|
| Setup UI | `client/src/pages/admin/setup.tsx` |
| Catalogue / Preview cards | `client/src/components/admin/CatalogActivateSection.tsx` |
| Preview Studio | `client/src/pages/admin/create-product.tsx` |
| Create Page wizard | `client/src/pages/admin/customizer-pages.tsx` |
| Art Styles | `client/src/pages/admin/styles.tsx` |
| Preview import (PT only) | `POST /api/appai/setup/activate-product` in `server/routes.ts` |
| Setup status | `server/merchant-setup.ts` |
