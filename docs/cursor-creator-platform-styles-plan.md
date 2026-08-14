# Creator Platform — Custom Style Assignment & Tenancy

**Status:** Approved with refinements (2026-08-14). Building in reviewed stages.  
**Source request:** `cursor-creator-platform-styles.md` (operator handoff).  
**Repo:** AppAI POD (`appai-pod`).  
**Dates:** Plan 2026-08-14; refined 2026-08-14.

This document is the implementation plan. It confirms the two-product split, curated assignment, availability vs enabled, and every shared code path.

---

## Revision (operator-confirmed)

Two refinements replace the earlier “all globals on by default + disable-list” model.

### R1 — Curated assignment (not all-globals-by-default)

The operator **hand-picks** a mix of base/global styles and customs **per creator**. Different creators get different subsets, including of the base set.

- Create an assignment row **only** for styles the operator assigns.
- Each new assignment defaults to `enabled = true`.
- A style with **no row** for that creator does **not** show (portal or storefront).
- **No `creator_style_global_disables` table.** One mechanism: assignment rows.
- `global` vs `custom` remains a property of the **style** (who is *eligible* to be assigned it). The creator’s view is uniformly: **my assigned styles, each toggleable on/off.**

### R2 — `available` (operator) vs `enabled` (creator)

Two separate concepts. Do not conflate.

| Field | Who sets it | Meaning | Display |
|-------|-------------|---------|---------|
| `enabled` | Creator | Their on/off curation | Off = hidden from customers; still listed in portal as toggled off |
| `available` | Operator | Still offered to this creator | `false` = greyed out **“Currently Unavailable”** in portal, regardless of `enabled`. Hidden from storefront customers. |

**Unassign / retire flow:** do **not** delete the assignment row. Set `available = false`. The style stays on the creator’s list, greyed out. Re-offer sets `available = true` (creator’s `enabled` choice is preserved). Hard-delete is not the retire path.

Style-level `is_active = false` (catalog retired) also treats the assignment as unavailable for storefront/generate.

### Also confirmed

- Custom styles reuse existing `style_presets` base ruleset and categorisation (Decor / Apparel / any, apparel background-removal). No parallel custom-style table.
- Assigned styles apply across **any** product customizer page the creator has access to. Page `style_config` still filters by **category** after entitlement.

---

## READ FIRST

Do not write code from this file until the plan is approved.

This is an architecture change: adding **tenancy + assignment** on top of a resource that is currently merchant-global (per Shopify install). Treat it like pricing work — plan, flag mismatches, then build in reviewed stages.

There are **two products in one codebase** with different (sometimes opposite) style rules. Do not merge their creation/permission rules.

---

## 1. Decisions to confirm

| # | Decision | Plan verdict |
|---|----------|--------------|
| 1 | Shopify merchant styles vs creator-platform styles are separate segments. Merchant create-your-own path stays fully untouched. | **Confirmed.** Merchants authenticate via Shopify and live on `shopify_installations` → `merchants.id` → `style_presets.merchant_id`. Creators are first-class `creators` rows with `/c/:username` (and later `*.aiartstudio.app`). Creator storefronts check out on one platform Shopify shop (`CREATOR_PLATFORM_SHOP_DOMAIN`). |
| 2 | Many-to-many `style_assignments` join (with `enabled`), not a single `ownerId` column. | **Confirmed.** A single owner column breaks custom-shared (one style, several creators). |
| 3 | Globals are creator-toggleable. | **Refined.** Globals are *eligible* to assign, not auto-visible. Visibility = assignment row. Toggle = `enabled` on that row. No disable-list. |
| 4 | Flag every shared code path and whether sharing is safe. | **See §7.** Safe: read/filter/prompt sanitize. Unsafe: create/edit/delete/permission. |

---

## 2. Two products — do not merge their rules

### 2.1 Shopify app (already works — MUST NOT CHANGE)

- Independent merchant installs the app on their own Shopify store.
- Merchant **can create their own styles** within a fixed base ruleset they cannot change.
- Styles are **copied per merchant** into `style_presets` (`merchant_id` required).
- Admin UI: `/admin/styles`. APIs: `GET/POST/PATCH/DELETE /api/admin/styles`, seed/reseed.
- Page-level subset: `customizer_pages.style_config` (`mode: category` or `mode: selected`).
- **Do not alter** this create path, its scoping, or its base rules.

### 2.2 Creator platform (the new work)

- Hosted multi-creator storefronts. Creators **cannot create or edit styles**.
- Operator assigns a curated set. Creators only toggle on/off.
- No pricing control, no style creation.
- Today (before this work): creators inherit the **platform shop merchant’s** `style_presets`, or hardcoded `STYLE_PRESETS` if that merchant has zero rows. There is **no** per-creator style assignment.

These are separate entities. A shared **read** layer (“resolve tenant → filter styles”) is fine. Shared **creation/permission** rules are not.

---

## 3. Styles today — preserve these properties

- **Category** (existing axis): `decor` | `apparel` | `graphics` | `all` (`shared/styleCategories.ts`). Some styles are apparel-specific (background removal / chroma). Category is a property of the style and **carries over unchanged**.
- **Base ruleset** creators/merchants cannot change: hardcoded `STYLE_PRESETS` (`shared/schema.ts`), apparel chroma (`shared/apparel-chroma-prompts.ts`), runtime `sanitizeApparelStylePrefix` (`server/apparel-matting.ts`). Live prompt text after seed lives on `style_presets.prompt_prefix` / `prompt_prefix_dark`.
- Custom styles created for the creator platform must be **categorised and behave identically** to globals (same base rules, same apparel behaviours). Only **visibility** differs. Reuse existing style infrastructure; the new layer is assignment/visibility only.

### 3.1 Current schema (merchant)

`style_presets` (`shared/schema.ts` ~503–517):

- `id` serial PK  
- `merchant_id` varchar NOT NULL — **tenant key** (not shop, not creator)  
- `name`, `prompt_prefix`, `prompt_prefix_dark`, `category`, `is_active`, `sort_order`  
- `base_image_url`, `prompt_placeholder`, `description_optional`  
- timestamps  

There is **no** `shop` column and **no** global row with null `merchant_id`. Each merchant gets independent copied rows on seed.

`customizer_pages.style_config` filters which of that merchant’s presets appear on a page.

### 3.2 Current creator tenant (already exists — reuse)

| Piece | Where |
|-------|--------|
| `creators` + `branding` JSONB | `shared/schema.ts` |
| Host / path resolve | `server/creator-host.ts` — `resolveCreatorForRequest`, `lookupCreatorByUsername`, `assertPublicCreatorApiContext` |
| Path fallback | `/c/:username` |
| Designer URL | `/s/designer?shop={platformShop}&page={handle}&creatorUsername=&creatorId=&storefront=true` |
| Branding today | `creators.branding.headline`, `.description`, `.accentColor` — room for logo/images later on the **same** tenant row |

**Do not invent a second tenant table.** Style assignments key to `creators.id`. Branding already hangs off that record.

Portal today: `/portal` — stats/rank only. **No style UI.**  
Admin today: assign **customizer pages** only (`creator_customizer_pages`). **No style assignment.**

---

## 4. Creator-platform style model (new work)

### 4.1 Two independent axes — keep them separate

1. **Category** (existing): Decor / Apparel / Graphics / any. What the style is *for*.
2. **Scope/assignment** (new): global vs assigned. Who can *use* it.

Do not collapse these. Filter on scope first (server-side). Presentation is still grouped by category. After entitlement, apply the existing page/product category filter (`filterStylePresetsForPage` + `customizer_pages.style_config`) so an apparel page still hides decor-only styles.

### 4.2 Three assignment cases — join table, NOT owner column

| Case | Meaning | Storage |
|------|---------|---------|
| **Global** | Base catalog; *eligible* to assign to any creator. | `style_presets.creator_scope = 'global'`. Visible to a creator **only** if an assignment row exists. |
| **Custom-shared** | One custom style, several creators (e.g. a niche). | `creator_scope = 'custom'` + **many** assignment rows. |
| **Custom-exclusive** | Assigned to exactly one creator. | `creator_scope = 'custom'` + **one** assignment row. |

Because custom-shared exists, a single `ownerId` column is wrong.

### 4.3 Why keep custom styles in `style_presets`

Handoff: custom styles reuse existing infrastructure; only visibility is new.

Generate, apparel chroma, category, and admin-style field shapes already operate on `style_presets`. New custom rows stay in that table so behaviour stays identical.

**This does not change merchant shops** if:

- New column `creator_scope` defaults to `'merchant'` (existing rows stay merchant).
- `/api/admin/styles*` continues to return only `merchant_id = session merchant` **and** (`creator_scope` is null or `'merchant'`).
- Platform-shop `/admin/styles` also **hides** `custom` (and optionally `global` if we migrate those rows) so operator assignment happens in Creator Marketplace, not the merchant Styles page.
- Other merchants’ installs never see creator custom rows.

**One-time data step:** mark the **platform shop merchant’s** current active `style_presets` as `creator_scope = 'global'`. Those are today’s creator catalog. Do **not** flip other merchants’ rows.

### 4.4 Creator on/off toggle (curation, not creation)

Funnel for what a customer sees:

1. **We assign** a curated subset to a creator (operator). No row = not shown.  
2. **The creator toggles** each assigned style on/off in their portal (`enabled`).  
3. **The storefront shows** only assigned **and** `available` **and** `enabled` **and** catalog-active styles.

| Field | Storage |
|-------|---------|
| Creator on/off | `creator_style_assignments.enabled` (default true) — **globals and customs** |
| Operator offer | `creator_style_assignments.available` (default true). Retire → `false`, do not delete. |

### 4.5 Storefront query (customer-facing)

Server-side, scoped to the resolved creator:

```
assignment exists
  AND assignment.available = true
  AND assignment.enabled = true
  AND style is_active
```

Then apply existing category / page `style_config` filter.

**Never** send other creators’ styles to the client and hide them in the UI. Scope on the server. The client only receives its entitled, enabled set.

**Generate** must reject a `stylePreset` id that is not in that entitled set for the creator (same discipline as operator-vs-merchant data separation).

---

## 5. Data model

### 5.1 Extend `style_presets`

| Column | Type | Default | Meaning |
|--------|------|---------|---------|
| `creator_scope` | text NOT NULL | `'merchant'` | `merchant` \| `global` \| `custom` |

Additive via `server/migrations/startup.ts` column patch + Drizzle in `shared/schema.ts`.  
Merchant create/update APIs do not set this field (stay `'merchant'`).

### 5.2 Create `creator_style_assignments`

```
id
creator_id          NOT NULL  → creators.id
style_preset_id     NOT NULL  → style_presets.id
enabled             NOT NULL DEFAULT true   -- creator on/off
available           NOT NULL DEFAULT true   -- operator offer; retire = false
created_at, updated_at
UNIQUE (creator_id, style_preset_id)
INDEX (style_preset_id)
```

- One row = exclusive.  
- Many rows for the same `style_preset_id` = shared.  
- `enabled` = creator on/off for **custom** styles.

### 5.3 No global-disable table

Removed. `enabled` + `available` on the assignment row cover curation and retire.

Assignment row also needs:

```
enabled     NOT NULL DEFAULT true    -- creator toggle
available   NOT NULL DEFAULT true    -- operator offer; retire sets false
```

### 5.4 Tenant / branding

No new tenant entity. `creators.id` is the tenant. `creators.branding` already has headline / description / accentColor; logo and images can be added to that JSON later. Style assignments key to the same id.

---

## 6. Tenant resolution — reusable primitive

A storefront request must resolve **which creator** it is serving; that resolution scopes styles server-side.

**Already built (reuse, do not duplicate):**

- `server/creator-host.ts` — host subdomain + `/c/:username` + `assertPublicCreatorApiContext` (platform shop + status + id/username match)
- `server/static.ts` — `window.__CREATOR__` boot
- `shared/creatorMarketplace.ts` — `extractSubdomainFromHost`, `extractUsernameFromPath`

**Add (style-specific read, tenant-generic input):**

- `server/creator-styles.ts` — `resolveCreatorStorefrontStyles(creatorId)`  
  Input is only `creatorId`. Same function signature can later sit beside branding/page loaders.

Do not make tenant resolution style-specific. Do not resolve tenant from a style id.

---

## 7. Shared code paths — safe vs unsafe

| File / function | Merchant | Creator | Share? |
|-----------------|----------|---------|--------|
| `shared/customizerPageStyles.ts` — `filterStylePresetsForPage`, `parseCustomizerPageStyleConfig`, `dedupeStylePresets` | ✓ | ✓ | **Safe** (category / page filter) |
| `shared/styleCategories.ts` | ✓ | ✓ | **Safe** |
| `shared/schema.ts` — `STYLE_PRESETS` hardcoded catalog | ✓ | ✓ fallback | **Safe** (read-only) |
| `shared/apparel-chroma-prompts.ts` | ✓ | ✓ | **Safe** |
| `server/apparel-matting.ts` — `sanitizeApparelStylePrefix` | ✓ | ✓ | **Safe** (base rules) |
| `server/routes.ts` — `mapDbStylesForDesigner`, `hardcodedStylePresetsForDesigner` | ✓ | ✓ | **Safe** |
| `client` `StyleSelector` / `embed-design.tsx` display | ✓ | ✓ | **Safe** if payload is already scoped |
| `GET /api/storefront/customizer-page` (~7369–7496) | ✓ | ✓ | **Extend only when creator context present.** After merchant/platform load, replace list with `resolveCreatorStorefrontStyles`, then existing page filter. Merchant-only requests unchanged. |
| Storefront generate style lookup (~7942–7970) | ✓ | ✓ | **Same:** if `creatorCtx`, entitled set only |
| `GET /api/proxy/customizer-page` | merchant theme | — | **Do not change** (merchant theme embed) |
| `GET /api/config` + `getAllActiveStylePresets` | legacy, **all merchants** | accidental fallback | **Unsafe** as a creator source. Do not use for creator storefront. |
| `POST/PATCH/DELETE /api/admin/styles*` + `client/src/pages/admin/styles.tsx` | ✓ | — | **Unsafe** to reuse for creators. Keep merchant-only. Add `creator_scope` filter so `custom` rows never appear here. |
| `storage.createStylePreset` / `update` / `delete` | merchant writes | — | **Unsafe** to expose on portal. Operator clone uses a new helper that sets `creator_scope = 'custom'`. |
| `configCache.delete("global")` on merchant style mutate | ✓ | side effect on `/api/config` | Leave as-is; do not tie creator writes to this cache. |

---

## 8. Surfaces to build

### 8.1 Operator (our side)

Location: `/admin/platform/creators` → Manage creator → new **Styles** tab  
(New APIs under `/api/platform/creators/...`, `requirePlatformAdmin`. **Not** `/api/admin/styles`.)

- Assign / unassign custom styles to one or more creators (writes `creator_style_assignments`).
- List globals (platform `creator_scope = global`) vs customs.
- **Duplicate style and assign exclusively to one creator:** clone an existing global or shared custom (`creator_scope = custom`), copy category + prefixes + apparel/image fields, insert **one** assignment row (`enabled = true`). Original untouched.
- Create custom style: same categorisation + base-ruleset fields as merchant styles, but `creator_scope = custom` + assignments. Creators never hit this API.

### 8.2 Creator portal (their side)

Location: `/portal` — new Styles tab. Auth: existing creator JWT (`requireCreator`). Own `creatorId` only.

- List styles available to them: globals + assigned customs, **grouped by category**.
- Per-style on/off → `UPDATE creator_style_assignments.enabled` (globals and customs).
- If `available = false` (or catalog `is_active = false`): show **Currently Unavailable**, greyed out; toggle may be disabled; do not treat as “creator turned it off.”
- **No create/edit.** No changing base rules or categories.

### 8.3 Storefront (customer-facing)

- `GET /api/storefront/customizer-page` when `creatorUsername` / `creatorId` is present and `assertPublicCreatorApiContext` succeeds.
- Storefront generate: same entitled set; reject unknown ids.
- Theme proxy path for **merchant** shops stays on merchant `style_presets` only.

---

## 9. Key files (extend vs create)

### Extend

| File | Change |
|------|--------|
| `shared/schema.ts` | `creator_scope` on `stylePresets`; new tables |
| `server/migrations/startup.ts` | CREATE TABLE + column patch + unique indexes |
| `server/routes.ts` | customizer-page + generate: creator branch only |
| `server/routes/creators.ts` | operator assign / duplicate / list APIs |
| `server/routes/creator-portal.ts` | list + toggle |
| `client/src/pages/admin/platform-creator-detail.tsx` | Styles tab |
| `client/src/pages/admin/styles.tsx` / admin style GET | filter `creator_scope` so customs never show |
| `client/src/pages/portal/dashboard.tsx` | Styles tab |
| `docs/creator-marketplace.md` | two-product rules, three cases, two axes, toggle funnel |

### Create

| File | Role |
|------|------|
| `server/creator-styles.ts` | `resolveCreatorStorefrontStyles`, clone helper, entitlement check |
| `server/creator-styles.test.ts` | entitlement math: global+disable, shared, exclusive, leak of other creator’s custom |
| `shared/creatorMarketplace.ts` (small) | `CREATOR_STYLE_SCOPES` constants if needed |

### Do not touch (merchant create path)

- Merchant style POST/PATCH/DELETE semantics  
- Seed/reseed of merchant copies  
- `CustomizerPageStyleSelector` merchant page assignment  
- Theme `appai-art-embed.js` merchant style postMessage  
- Apparel chroma / `sanitizeApparelStylePrefix` rules  

---

## 10. Build stages (after approval)

| Stage | Work | Exit test |
|-------|------|-----------|
| **A — data + resolve** | Schema, `resolveCreatorStorefrontStyles`, wire customizer-page + generate. One-time backfill of current globals for existing creators only. New creators start empty. | Merchant `/admin/styles` + merchant storefront unchanged. Existing staging creators keep today’s catalog. |
| **B — operator UI** | Assign / unassign / duplicate-and-assign-exclusively / create custom. | Shared custom appears only on assigned creators. Clone does not mutate original. |
| **C — portal toggles** | Read + on/off for globals and customs. | Disabled global hidden on that creator’s storefront only. |
| **D — docs** | This model in `docs/creator-marketplace.md`. | — |

Staging-first per repo rules. Do not merge production until explicit go-live.

---

## 11. Do NOT

- Do not change the Shopify merchant’s create-your-own-styles feature, scoping, or base rules.
- Do not merge the two products’ style **creation/permission** rules into one system.
- Do not use a single owner column for assignment (breaks custom-shared).
- Do not client-side-filter styles (leaks other creators’ styles) — scope server-side.
- Do not let creator-platform creators create or edit styles — assign/toggle only.
- Do not use `/api/config` / `getAllActiveStylePresets` as the creator style source (cross-merchant).
- Do not auto-assign all globals to every creator.
- Do not use a global-disable-list (retired).
- Do not delete assignment rows to unassign/retire — set `available = false`.

---

## 12. Docs to add when building (stage D)

Record in `docs/creator-marketplace.md`:

1. Two-product separation (Shopify merchant vs creator platform).  
2. Three assignment cases (global / custom-shared / custom-exclusive).  
3. Two independent axes (category vs scope).  
4. Toggle funnel (operator assign → creator enable → storefront).  
5. Confirmation the merchant path is untouched.

---

## 13. Reviewer items — resolved

1. Custom styles stay in `style_presets` with `creator_scope = 'custom'` — **confirmed** (no parallel table).  
2. Platform-shop merchant presets become the **eligible global catalog** (`creator_scope = 'global'`). They are **not** auto-shown; operator assigns per creator.  
3. Disable-list — **dropped.** Assignment row only.  
4. Page `style_config` still applies **after** entitlement (category). Assignment is creator-wide, not per-page.  
5. Unassign/retire = `available = false`, keep the row.

**Staging migration:** existing creators who already see today’s full platform catalog get a **one-time backfill** of assignment rows for current platform globals (`enabled=true`, `available=true`) so we do not blank live staging shops. New creators start with **zero** assignments until the operator picks a set.

End of plan.
