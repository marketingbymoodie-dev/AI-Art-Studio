# Staging + release (safe updates after merchants are live)

Goal: test every change on a **demo store + staging backend** first. Only promote to live merchants when you explicitly say **yes, go live**.

You do **not** need to be a trained developer day-to-day. Cursor (via the deploy skill) will prompt you at each gate. This doc is the **one-time setup** plus what each prompt means.

---

## Big picture

```text
You + Cursor edit code
        │
        ▼
   staging branch ──► Railway STAGING ──► Staging Shopify app ──► DEMO store
        │                                      (theme/checkout extensions)
        │
        │  only after you say "go live"
        ▼
   production branch ──► Railway PRODUCTION ──► Live Shopify app ──► MERCHANTS
```

| Piece | Staging (safe) | Production (live merchants) |
|-------|----------------|-----------------------------|
| Git branch Railway watches | `staging` | `production` |
| Railway service | new service (copy of current) | current `appai-pod-production` |
| Database | **new** Postgres (auto with Railway) | existing DB — never point staging at this |
| Shopify Partner app | **new** app e.g. `AI Art Studio (Staging)` | current `AI Art Studio` |
| Store | your **demo / development** store only | merchant stores |
| Stripe | **test** keys | live keys |
| Supabase | same project OK at first (see below) | same project |

---

## One-time setup checklist

Do these in order. After each major step, tell Cursor: “staging setup step X done” so it can help with the next one.

### A. Shopify (Partners)

1. Open [Shopify Partners](https://partners.shopify.com) → **Apps** → **Create app**.
2. Name it clearly: `AI Art Studio (Staging)` (or similar).
3. Leave it **unlisted** / not on the App Store — demo store only.
4. Create or pick a **development store** (demo store). Install **only** the staging app on that store — never install staging on a live merchant store.
5. In this repo, fill in `shopify.app.staging.toml`:
   - Replace `REPLACE_WITH_STAGING_CLIENT_ID` with the staging app’s **Client ID**.
   - Replace `REPLACE_WITH_STAGING_RAILWAY_URL` after Railway staging exists (step B).
6. On your machine (once Shopify CLI is installed):

```bash
npm run shopify:config:use:staging
npm run shopify:deploy:staging
```

That publishes theme/checkout extensions to the **staging** Partner app only.

7. On the demo store: Theme editor → App embeds → enable **AI Art Studio** for the **staging** app. Set up 1–2 customizer pages for smoke tests.

**Install Shopify CLI once** (Windows): follow [Shopify CLI install](https://shopify.dev/docs/api/shopify-cli). You only need the terminal for Shopify extension deploy / occasional `shopify app dev` — not for every code edit.

### B. Railway (staging service)

1. In Railway → open the **current production** project.
2. **Duplicate** the service (or create a new service from the same GitHub repo).
3. Name it something like `appai-pod-staging`.
4. Set the service to deploy from branch **`staging`** (not `production`).
5. Add a **new Postgres** database for this staging service (Railway “Add Postgres”). Copy its `DATABASE_URL` into the staging service variables.
6. **Do not** copy production `DATABASE_URL` into staging.
7. Copy other variables from production into staging, then **change** the ones in the table below.
8. Note the staging public URL, e.g. `https://appai-pod-staging.up.railway.app`.
9. Put that URL into `shopify.app.staging.toml` (`application_url`, `app_proxy.url`, `auth.redirect_urls`).
10. Run `npm run shopify:deploy:staging` again so Shopify knows the staging URLs.

#### Railway variables — what to change on staging

| Variable | Staging value |
|----------|----------------|
| `APP_URL` / `PUBLIC_APP_URL` | Staging Railway HTTPS URL |
| `SHOPIFY_API_KEY` | Staging app **Client ID** |
| `SHOPIFY_API_SECRET` | Staging app **Client secret** |
| `DATABASE_URL` | **New** staging Postgres only |
| `STRIPE_SECRET_KEY` | Stripe **test** secret (`sk_test_…`) |
| `STRIPE_WEBHOOK_SECRET` | Webhook secret for staging endpoint (see Stripe below) |
| `OWNER_SHOP_DOMAIN` | Your **demo** store `something.myshopify.com` |
| `NODE_ENV` | `production` (normal for Railway hosts) |

Usually **keep the same** on staging (platform tooling):

- `PRINTIFY_API_TOKEN` / `PRINTIFY_SHOP_ID` (catalog / platform flows)
- `REPLICATE_API_TOKEN` and related AI keys
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, bucket names (see Supabase)
- `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (if set as Railway build vars)
- `RESEND_API_KEY` (optional; or omit so staging doesn’t email you)

### C. GitHub branch `staging`

1. Create branch `staging` from current `production` (or `main` if they match).
2. In Railway, confirm the staging service tracks `staging`.
3. Pushing to `staging` should auto-deploy the staging Railway service (same idea as today’s `production` → live Railway).

### D. Supabase

**You do not need a second Supabase project to start.**

Why it’s OK to share one project:

- Designs/mockups are keyed by shop / design IDs.
- Staging only talks to the **demo** shop install in the **staging** database.
- Platform calibration assets (hoodie templates, flat blanks) are read-mostly and fine to share.

Optional later (only if staging files clutter production buckets):

- Create buckets like `designs-staging` / `mockups-staging` and set `SUPABASE_DESIGNS_BUCKET` / `SUPABASE_BUCKET` on the staging Railway service only.

**Never** point staging `DATABASE_URL` at production Postgres. That is the dangerous mix-up — not Supabase buckets.

### E. Stripe (if you test billing on staging)

1. Stripe Dashboard → **Test mode**.
2. Webhooks → add endpoint: `https://<staging-railway-url>/…` (same path as production webhook).
3. Put the test signing secret into staging `STRIPE_WEBHOOK_SECRET`.
4. Production keeps live keys + live webhook.

### F. Lock the habit

- Day-to-day default Shopify config: **staging** (`npm run shopify:config:use:staging`).
- Only use production Shopify deploy when going live (`npm run shopify:deploy:production`).
- Demo store = staging app only. Merchant stores = production app only.

---

## Everyday workflow (after setup)

Cursor will drive this. Your job is mostly answering prompts.

1. **Keep All** on AI edits when you’re happy with them.
2. Cursor builds, commits, deploys to **`staging`** (Railway + Shopify staging extensions if needed).
3. You test on the **demo store**.
4. Cursor asks: **“Ready to set this feature live for merchants?”**
5. Only if you say **yes** → merge to `production`, Railway production deploy, then `shopify:deploy:production` if extensions changed.
6. If you say **no** → stays on staging; keep fixing.

### What you test on the demo store (short checklist)

- Customizer page loads; generate / place art
- Add to cart → cart thumbnail is the custom mockup (shadow SKU)
- Checkout image still correct
- Hard refresh still lands near the preview (not buried at footer)
- If you touched billing: Stripe **test** mode only

---

## Commands cheat sheet

| Intent | Command |
|--------|---------|
| Use staging Shopify app as default | `npm run shopify:config:use:staging` |
| Use production Shopify app as default | `npm run shopify:config:use:production` |
| Deploy extensions to **staging** only | `npm run shopify:deploy:staging` |
| Deploy extensions to **production** (live) | `npm run shopify:deploy:production` |
| Local tunnel against staging app + demo store | `npm run shopify:dev:staging` |

**Never run `shopify:dev` / `shopify:deploy` against production while experimenting** — always pass the staging config (the npm scripts above do that for you).

---

## Safety rules (avoid expensive mistakes)

1. Staging Railway must have its **own** `DATABASE_URL`.
2. Staging Shopify credentials must be the **staging** Client ID/secret.
3. Do not install the staging app on a merchant’s live shop.
4. Do not say “go live” until the demo store checklist passed.
5. Theme/checkout JS changes need a Shopify deploy, not only Railway.
6. If unsure which environment a command targets — stop and ask Cursor to confirm **staging vs production**.

---

## Status

- [x] Staging Partner app created (`AI Art Studio (Staging)`)
- [x] Demo store created + staging app installed (`ai-art-studio-staging`)
- [x] Railway Staging environment + Postgres + `https://ai-art-studio-staging.up.railway.app`
- [x] Staging env vars updated (Shopify + APP_URL); admin app loads in store
- [x] `shopify.app.staging.toml` — Client ID + Railway URL filled
- [x] Git branch `staging` pushed to GitHub
- [ ] Railway Staging source branch set to `staging` (confirm in Railway Settings)

- [ ] Theme App Embed enabled on demo store
- [ ] `npm run shopify:deploy:staging` succeeded once (extensions)
- [ ] First feature shipped staging → explicit go-live → production
