# Stale shipping membership rows

**Status:** open · hygiene · low priority. Not a launch blocker. Not a Shopify membership leak.

## Problem

`shipping_store_variants` keeps a row for every variant an Apply has associated. Apply never deletes a row when that variant disappears. The end-of-Apply GC only removes a delivery profile when the whole profile key has no desired members left, so a recreate of a product that stays on the same profile leaves the old variant ids behind.

Observed on staging after recreating Men's Lightweight (pt 5), 2026-10-04: dry-run "members not desired" went from 79 to 141. The new 62 are that deleted product's previously recorded variants. The previous 79 are the same class of row from earlier recreates (cotton crew, framed posters). 135 of the 141 variant ids no longer exist on Shopify. Shopify's own profile member count does not include them — delete already drops them — and the number does not count toward the 90-profile cap.

The dry-run line still reads like a warning. After a few more recreates it will be large enough that a real "members not desired" (a live variant we recorded and no longer want) is invisible. That is how the 36 failed syncs sat unnoticed.

## Decision

GC the dead rows. Do not add a second counter.

On Apply (not on dry-run), after the profile loop, delete `shipping_store_variants` rows whose Shopify variant no longer exists (`nodes(ids:)` returns null). Leave rows whose variant still exists. Those stay in "members not desired", which then means only live variants the reconciler recorded and no longer wants (a removed colour, an unexpired shadow whose base was deleted).

Dry-run keeps reporting that live remainder only, so the headline stays meaningful. Do not delete rows during a dry-run.

## Out of scope

- Dissociating live variants Shopify still has on the profile. That is a real membership change and stays a separate decision.
- The 6 still-live shadow products seen on 2026-10-04. Shadow cleanup already deletes those products; this GC then drops the row.
