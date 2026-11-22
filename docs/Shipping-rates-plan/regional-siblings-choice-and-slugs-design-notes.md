# Design Notes — Regional Customizer Pages, Printify Choice, Slugs

**Status: PARKED — do not build during Phases 1–3.** These are agreed design decisions to implement alongside Phase 4 (geo-gating) or later. Recorded now so they aren't re-litigated or forgotten. The only near-term action is §1.4 (two metadata fields on the page model — cheap to add early).

---

## 1. Regional sibling pages (same product, per-region provider)

### 1.1 Problem & decision

We want the same base product offered via different print providers per region (e.g. Heavy Cotton Tee via Dimona for US shoppers, The Print Bar for AU shoppers), so shoppers get local production and cheap domestic shipping.

**Decision: siblings are resolved by the SHOPPER'S country, never assigned by the creator's country.** An AU influencer's audience is not 100% Australian; pinning her storefront to an AU-provider page would warn/exclude her US and UK followers whom a US/UK provider could serve cheaply. Creator nationality is the wrong key; visitor geography is the right one.

### 1.2 Mechanism: sibling groups

- Same base product, one customizer page per provider/region, linked by a shared `productGroupId`.
- Each page carries structured metadata: `provider` (blueprint/provider ids) and `intendedZones` (e.g. `["AU"]`). Region markers in titles (e.g. "— AU") are human labels only, never parsed as mechanism.
- **Creator assignment targets the group, not a page.** Curation model unchanged — operator still decides what each creator carries — but chooses "Heavy Cotton Tee" once, not per region.
- **Zone restriction is emergent, never manual.** A page is effectively "AU-focused" because its provider's international rates land in warned/excluded tiers via the existing coverage system. No page-level "AU only" flag exists.

### 1.3 Geo-resolution (Phase 4)

- The Phase 4 geo-layer (which already resolves visitor country for gating) also resolves the best sibling within a group for that country and serves/redirects to it.
- A direct/shared link to one sibling (e.g. the AU page shared on socials) 301s a visitor from another region to their sibling instead of showing a warned/excluded state.
- Sibling choice priority: sibling whose provider gives the visitor's country the best tier (normal > warned), tiebreak on first-item cost.

### 1.4 Near-term action (cheap, do early)

Add `productGroupId` (nullable) and `intendedZones` (nullable array) to the customizer page model now. Grouping is pure linking metadata, so pages created today as plain separate pages can be grouped retroactively — but having the columns early avoids a migration mid-Phase-4.

### 1.5 Caveat: imperfect variant overlap

Sibling providers are not interchangeable — variant counts differ per provider (observed: 16 vs 18 vs 24 variants for the same blueprint). The group model must tolerate partial overlap: a size/colour existing on the US sibling may not exist on the AU sibling. Do not assume identical variant sets across a group; resolution lands the shopper on the sibling page as-is, with that sibling's own variants.

---

## 2. Printify Choice — how routing interacts with our shipping system

- **Choice's per-order routing is invisible and unknowable in advance.** Provider is picked at order time (destination, stock, capacity). We never branch on it.
- **The published Choice table is the pricing contract and the coverage signal.** We charge the published (ceiling) table. If Choice routes cheaper, the margin lands with the merchant/operator — never against them.
- **Read local coverage off the table itself:** a domestic-looking rate for a country (framed prints: US $11.89) means Choice has local routing there; an international-looking rate (AU $197.59) means it does not. The existing tier system therefore classifies Choice's real coverage automatically — no special-casing.
- Cross-check available: the Printify catalog lists all providers per blueprint with print locations. If no provider in a country exists for a blueprint, Choice categorically cannot route locally there.
- **Choice vs hand-built sibling groups:** for blueprints where Choice's table shows good multi-region coverage, one Choice page may beat maintaining regional siblings. Reserve sibling groups for markets where a local specialist (e.g. The Print Bar AU) clearly beats Choice's ceiling. Evaluate per blueprint using ingested tables; not a global policy.

---

## 3. Merchant provider freedom — no new work needed

A merchant may select any independent provider, including ones never curated on the platform. This is already fully handled by design: everything is keyed on `(blueprintId, providerId)`; the wizard ingests unknown providers' tables on demand at the supplier step; tiers, profiles, and coverage follow automatically. The wizard's per-provider shipping display (ships-from, coverage tiers, primary-market first-item rate) exists precisely so an uncurated choice is an informed one. **Do not add merchant-side provider allowlists or approval flows.**

---

## 4. Slugs & URLs for sibling pages

- **Auto-derive slugs from metadata**, never hand-name: base slug + region/provider suffix from `intendedZones` (e.g. `heavy-cotton-tee-au`, `heavy-cotton-tee-uk`), numeric fallback on collision.
- **The base slug is the group's front door.** `/heavy-cotton-tee` must not 404 or arbitrarily belong to one sibling — it hits the geo-resolver and redirects to the visitor's sibling. This is the URL creators share; suffixes are implementation detail.
- **SEO canonical:** siblings are near-duplicate content. Every sibling sets `rel=canonical` to the base slug so one page per product is indexed, not competing regional copies.

---

## 5. Related reminders already agreed elsewhere (context, not new work)

- **Phase 3 initial reconcile must backfill the entire existing catalogue** (weights, profile membership, coverage) — not just newly imported products. Pages created before Phase 3 launch end up identical to pages created after.
- **Interim page-creation guidance (pre-Phase-1 data):** pages with an obvious/sole provider can be created freely now; pages with a genuinely contested provider choice (especially differing ship-from countries) should wait until the wizard shows coverage data. Avoid bulk-building the catalogue before the first Phase 3 reconcile — a small known catalogue is the better shakedown.
- **Creator order attribution** (creator ID written at checkout on the platform shop, read back from the order) is load-bearing for payouts and must be verified as implemented — tracked as its own task, separate from shipping phases.
