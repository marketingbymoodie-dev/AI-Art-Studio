# provider_credentials migration (operator API key store)

Applied by `server/migrations/startup.ts` on every boot (idempotent):

- `TABLE_MIGRATIONS` → `provider_credentials` (CHECKs on provider / scope / status, platform⇔shop_id null CHECK, `shop_id` FK → `merchants.id`).
- `INDEX_MIGRATIONS` → `provider_credentials_live_ref_uidx` — unique `(scope, COALESCE(shop_id,''), provider, credential_ref) WHERE status <> 'disabled'`.
- `COLUMN_MIGRATIONS` → `merchants.can_use_own_api_keys BOOLEAN NOT NULL DEFAULT FALSE` (reserved, unread).
- `DATA_MIGRATIONS` → clears legacy plaintext `merchants.custom_nano_banana_token` (never used for generation; pre-launch, no snapshot).

## Verify (staging)

```sql
SELECT to_regclass('public.provider_credentials');
SELECT indexname FROM pg_indexes WHERE tablename = 'provider_credentials';
SELECT column_name FROM information_schema.columns WHERE table_name = 'merchants' AND column_name = 'can_use_own_api_keys';
```

Railway boot log must show no `[startup-migration] FAILED` lines.

## Down (reversible)

Remove the four entries from `startup.ts` first (otherwise the next boot recreates them), then:

```sql
DROP INDEX IF EXISTS "provider_credentials_live_ref_uidx";
DROP TABLE IF EXISTS "provider_credentials";
ALTER TABLE "merchants" DROP COLUMN IF EXISTS "can_use_own_api_keys";
```

The token clear is not reversible (intentional; the column held unused plaintext).

## Secrets

`CREDENTIAL_ENCRYPTION_KEY` — 32 random bytes, base64 (`node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`). Separate value per Railway environment. Without it the DB store is disabled and the resolver uses env vars only. Rotating it makes existing rows undecryptable (they are skipped → env fallback) — re-enter keys after rotating.
