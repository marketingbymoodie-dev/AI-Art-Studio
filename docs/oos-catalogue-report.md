# Daily catalogue OOS report

Scans every active `product_types` row that has a Printify blueprint/provider
and a connected merchant, checks stock for the size/color variants that
product actually sells (not the full catalog — unused colors don't false
alarm), and emails a short daily digest. Report-only: nothing is
auto-disabled on the storefront.

Code: [`server/oos-catalogue-report.ts`](../server/oos-catalogue-report.ts),
[`shared/printifyAvailability.ts`](../shared/printifyAvailability.ts),
[`shared/printifyVariantLabels.ts`](../shared/printifyVariantLabels.ts).

## Provider-scoped (not “any supplier”)

Each product type stores one `printifyProviderId` (chosen at import). The scan
dual-fetches Printify’s **provider-specific** catalog URLs:

```
GET .../variants.json                    → in-stock only (availability signal)
GET .../variants.json?show-out-of-stock=1 → all variants (labels / missing check)
```

Stock = membership in the in-stock-only list. Catalog rows often omit
`is_available` (that field is a shop-product property); never treat a missing
flag as in-stock.

JAMS Designs (USA) and T Shirt and Sons (UK) are never merged. Customizer Pages
show fulfill-by as `Printify: …`; Scan stock now toasts include the provider name.

### Printify UI “Available providers” vs our scan

Printify’s product-variants modal (e.g. “Printed by JAMS Designs”) shows
**that provider’s** inventory in the Inventory column. The **Available
providers** column is a cross-supplier hint for the same blueprint: when JAMS
is fully OOS for White/Black, JAMS disappears from that row and only
T Shirt and Sons remains — even while the modal header still says JAMS.

Our scan matches the Inventory column for the product’s stored
`printifyProviderId`. It never merges another supplier’s stock into the ratio.

### Denominator = imported `variantMap` (must include fully OOS colors)

`available / total` counts only size×color rows this product type sells
(`variantMap` filtered by `selectedSizeIds` / `selectedColorIds`).

Import, Refresh Variants, and the import wizard dual-fetch the full provider
catalog (`?show-out-of-stock=1`) so colors that are entirely OOS at that
provider (e.g. White/Black at JAMS) still enter `variantMap` / Edit Variants.
Refresh auto-selects **newly appeared colors only when they have at least one
in-stock size** at this provider — fully OOS newcomers (Deep Heather with no
providers, White/Black while JAMS is OOS) stay unchecked until you enable them
in Edit Variants. Intentional deselections of colors that already existed are
kept.

If an older import used the in-stock-only list, a fully OOS colorway was
omitted and the badge under-counted (e.g. 5/10 instead of 5/15). **Refresh
Variants** on that product type, then **Scan stock now**.

Products Import already documents this:

> One product uses one print provider for fulfilment, costs, and mockup
> calibration. Import the same blueprint again with a different supplier if
> you need a separate EU or US listing.

Uniqueness is **blueprint + provider**. You can keep a JAMS listing and import
the same blueprint again via T Shirt and Sons (e.g. rename to “UK/EU Only”).
Same blueprint + same provider is still blocked.

## Status thresholds

- `fully_oos` — 0 of the selected variants are available (Resync Prices /
  the customizer will likely fail to load costs for this product).
- `critical` — ≥90% of selected variants are out of stock (override with
  `OOS_CRITICAL_RATIO`, e.g. `0.85`).
- `ok` — otherwise.
- `error` — couldn't reach Printify's catalog endpoint for that
  blueprint/provider (bad token, deleted blueprint, etc).

A variant that's part of a product's `variantMap` but missing entirely from
the Printify catalog response (e.g. a delisted option) counts as
out-of-stock rather than being silently ignored.

## Customizer page create (Pricing step)

When costs fail because the provider is fully OOS, the API returns
`code: "PRINTIFY_FULLY_OOS"` and the wizard shows **stock unavailable for
{provider}** (not “Retry — lookup can take a minute”). Review & Create is
disabled until stock returns. Use **Scan stock now** or wait for the daily
digest — when `oosStatus` flips back to `ok`, create can proceed.

## Env vars

| Var | Required | Notes |
|---|---|---|
| `RESEND_API_KEY` | Yes (for email) | Already used by founder alerts. |
| `OOS_REPORT_EMAIL` | Recommended | Digest recipient. Falls back to `FOUNDER_ALERT_EMAIL` if unset. |
| `OOS_SCAN_SECRET` | Optional | Enables `POST /api/internal/oos-catalogue-scan` for an external scheduler. The endpoint 404s if this isn't set. |
| `OOS_CRITICAL_RATIO` | Optional | OOS ratio (0–1) that triggers `critical` status. Defaults to `0.9` (90%) if unset or invalid. |

Without `RESEND_API_KEY`/`OOS_REPORT_EMAIL` the scan still runs and updates
each product's `oosStatus` in the DB (powers the admin badge) — it just
skips sending the email.

## How it runs

- **Primary trigger:** an in-process daily interval (`server/routes.ts`,
  registered next to the other cleanup intervals). It also runs once ~5
  minutes after boot so a deploy doesn't wait a full day for the first scan.
- **Optional external trigger:** `POST /api/internal/oos-catalogue-scan`
  with header `x-oos-scan-secret: <OOS_SCAN_SECRET>`. Useful if you'd rather
  have Railway's Cron Job feature own the schedule instead of relying on the
  app process staying up. Add `?force=1` to bypass the same-day guard.
- Both triggers share one guard: a scan is skipped if the last recorded run
  (`oos_catalogue_scans` table) was less than 20 hours ago, so a redeploy
  restarting the interval — or having both triggers configured — never
  double-runs (and double-emails) on the same day.

### Setting up the optional Railway Cron Job

1. Set `OOS_SCAN_SECRET` on the service (any random string).
2. In Railway, add a Cron Job service in the same project pointing at your
   production URL:
   ```bash
   curl -X POST "https://<your-app>.up.railway.app/api/internal/oos-catalogue-scan" \
     -H "x-oos-scan-secret: $OOS_SCAN_SECRET"
   ```
3. Schedule once daily (e.g. `0 13 * * *` for 1pm UTC). This is optional —
   the in-process interval already covers it as long as the app stays up.

## Admin visibility

- `GET /api/appai/blanks` (admin) includes `oosStatus`, `oosAvailableVariants`,
  `oosTotalVariants`, `lastOosScanAt`, and `printifyProviderName` (from last scan).
- The Customizer Pages list shows fulfill-by provider (`Printify: …`), a red
  “Out of stock” / “Low stock” / “Stock check failed” badge when not `ok`, and
  a per-row **Scan stock now** button
  (`POST /api/admin/product-types/:id/scan-stock`).
