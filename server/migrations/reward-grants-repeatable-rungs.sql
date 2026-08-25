-- LIST ONLY — do not run from startup.ts / INDEX_MIGRATIONS.
-- Repeatable rungs: share_design + purchase_threshold unique on related_entity_id.
-- Newsletter (and any other rung) stays once per (shop, customer_id, rung_key).
--
-- Until this is applied, a second share/purchase insert still hits
-- reward_grants_shop_customer_rung / the table UNIQUE and returns duplicate.

ALTER TABLE reward_grants DROP CONSTRAINT IF EXISTS reward_grants_shop_customer_id_rung_key_key;
DROP INDEX IF EXISTS reward_grants_shop_customer_rung;

CREATE UNIQUE INDEX reward_grants_once_per_customer_rung
  ON reward_grants (shop, customer_id, rung_key)
  WHERE rung_key NOT IN ('share_design', 'purchase_threshold');

CREATE UNIQUE INDEX reward_grants_per_event
  ON reward_grants (shop, customer_id, rung_key, related_entity_id)
  WHERE rung_key IN ('share_design', 'purchase_threshold');
