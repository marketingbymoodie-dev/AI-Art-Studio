# Daily catalogue OOS report

Scans every active `product_types` row that has a Printify blueprint/provider
and a connected merchant, checks stock for the size/color variants that
product actually sells (not the full catalog — unused colors don't false
alarm), and emails a short daily digest. Report-only: nothing is
auto-disabled on the storefront.

Code: [`server/oos-catalogue-report.ts`](../server/oos-catalogue-report.ts),
[`shared/printifyAvailability.ts`](../shared/printifyAvailability.ts),
[`shared/printifyVariantLabels.ts`](../shared/printifyVariantLabels.ts).

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
  `oosTotalVariants`, and `lastOosScanAt` per product.
- The Customizer Pages list (`client/src/pages/admin/customizer-pages.tsx`)
  shows a red "Out of stock" / "Low stock" / "Stock check failed" badge next
  to a page's status when its linked product isn't `ok`, with a tooltip
  showing the available/total count and last scan time.
- Each row also has a "Scan Printify stock now" button
  (`POST /api/admin/product-types/:id/scan-stock`) that re-checks just that
  product immediately (no email — that's the daily job's job) and shows the
  result in a toast.
