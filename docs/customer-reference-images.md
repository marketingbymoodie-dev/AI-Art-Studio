# Customer reference photos (style packs)

Pet and owner photos uploaded for **style-pack generations** (e.g. Petposterous) are kept so a design can be reloaded, regenerated or reused with the same likeness. Photos for classic styles are not stored; they go to the model as data URLs, exactly as before.

## Storage

- **Bucket:** private Supabase bucket `customer-references` (env `SUPABASE_CUSTOMER_REFERENCES_BUCKET`). It is created with `public: false`, and the code refuses to write if the bucket is ever public.
- **Path:** `<shop>/<jobId>/<index>-<role>-<rand8>.<ext>`, where role is `pet`, `owner` or `other`.
- **What the job stores:** only paths, in `generation_jobs.creative_brief.referenceImages[]` as `{path, role, label}`. It never stores a URL or data.
- **What clients get:** 1-hour signed URLs, created per request by `publicCreativeBrief` (`server/customer-references.ts`).
- **Validation:** every path is checked by `referencePathBelongsToShop` against the **requesting shop's** prefix and a fixed filename shape before signing. A path from another merchant is never signed, and clients never send bucket URLs back, only brief paths.

## Who can see photos

- **`GET /api/storefront/generate/status`:** returns the brief to whoever has the job id. That is the same capability as today's artwork URL on that endpoint.
- **`POST /api/storefront/customizer/my-designs`:**
  - Returns briefs (names + signed photos) **only** when the request carries a valid identity token.
  - A token for a different customer is rejected with 403.
  - Token-less callers (the theme's Saved Designs menu) get the classic list without briefs.

## Retention policy

The data model supports this policy. The sweeper itself is **not built yet**.

| State | Rule |
|---|---|
| Referenced by a saved design (job has a customer, or was forked/shadowed from one) | **Keep.** Must stay signable for reload, regenerate and reuse. |
| Design deleted | The photo becomes an orphan once **no** `creative_brief` references its path (forks copy the brief, so a shared photo stays while any copy lives). Orphans are eligible for removal. |
| Abandoned / temporary job (no customer, past `expires_at`, never saved) | Eligible for removal by a scheduled sweep. Paths are job-scoped, so the sweep can decide job by job. |

**Future sweep:** list `<shop>/<jobId>/` prefixes, keep any path still referenced by a `creative_brief` on a live job, and delete the rest older than a grace period (suggested 7 days).
