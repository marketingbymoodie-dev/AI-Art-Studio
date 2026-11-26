/**
 * Printify and Shopify ids saved the moment each create returns.
 * A rerun reads them instead of creating a second product.
 */
import { mergeCatalogueExternalIds, readCatalogueExternalId, type CatalogueExternalIds } from "@shared/cataloguePublish";
import { pool } from "./db";

let columnReady: Promise<void> | null = null;

async function ensureExternalIdColumn(): Promise<void> {
  if (!columnReady) {
    columnReady = pool.query(`
      ALTER TABLE catalogue_publish_jobs
      ADD COLUMN IF NOT EXISTS external_ids jsonb NOT NULL DEFAULT '{}'::jsonb
    `).then(() => undefined).catch((err) => {
      columnReady = null;
      throw err;
    });
  }
  await columnReady;
}

export async function readCatalogueExternalIds(candidateId: string, productTypeId: number): Promise<CatalogueExternalIds> {
  await ensureExternalIdColumn();
  const result = await pool.query<{ external_ids: unknown }>(
    `SELECT external_ids FROM catalogue_publish_jobs WHERE candidate_id = $1`,
    [candidateId],
  );
  return readCatalogueExternalId(result.rows[0]?.external_ids, productTypeId);
}

export async function rememberCatalogueExternalId(
  candidateId: string,
  productTypeId: number,
  patch: CatalogueExternalIds,
): Promise<void> {
  if (!patch.printifyProductId && !patch.shopifyProductId) return;
  await ensureExternalIdColumn();
  const existing = await pool.query<{ external_ids: unknown }>(
    `SELECT external_ids FROM catalogue_publish_jobs WHERE candidate_id = $1`,
    [candidateId],
  );
  const merged = mergeCatalogueExternalIds(existing.rows[0]?.external_ids, productTypeId, patch);
  const updated = await pool.query(
    `UPDATE catalogue_publish_jobs
     SET external_ids = $2::jsonb, updated_at = now()
     WHERE candidate_id = $1 AND status = 'running'`,
    [candidateId, JSON.stringify(merged)],
  );
  if (!updated.rowCount) {
    throw new Error("The publish job was no longer running, so the product id was not stored.");
  }
}

/** The product was deleted in this run, so the next run must not reuse its id. */
export async function forgetCatalogueExternalIds(
  candidateId: string,
  productTypeId: number,
  which: { printifyProductId?: boolean; shopifyProductId?: boolean },
): Promise<void> {
  if (!which.printifyProductId && !which.shopifyProductId) return;
  await ensureExternalIdColumn();
  const existing = await pool.query<{ external_ids: unknown }>(
    `SELECT external_ids FROM catalogue_publish_jobs WHERE candidate_id = $1`,
    [candidateId],
  );
  const merged = mergeCatalogueExternalIds(existing.rows[0]?.external_ids, productTypeId, {});
  const key = String(productTypeId);
  const row = merged[key];
  if (!row) return;
  if (which.printifyProductId) delete row.printifyProductId;
  if (which.shopifyProductId) delete row.shopifyProductId;
  if (!row.printifyProductId && !row.shopifyProductId) delete merged[key];
  await pool.query(
    `UPDATE catalogue_publish_jobs
     SET external_ids = $2::jsonb, updated_at = now()
     WHERE candidate_id = $1 AND status = 'running'`,
    [candidateId, JSON.stringify(merged)],
  );
}
