/**
 * Create pending catalogue candidates from a checked CSV and its PNGs.
 * Nothing is inserted until the whole batch validates. Storage from a
 * refused batch is removed.
 */
import { createHash, randomUUID } from "crypto";
import { and, desc, eq, inArray, isNotNull, isNull, ne } from "drizzle-orm";
import { catalogueBlockingNotes, catalogueStorageName, claimCatalogueHash, createdImportRowMatch, reviewCatalogueImport, type CatalogueCandidateRef, type CatalogueImportRow } from "@shared/catalogueBulkImport";
import { catalogueStudioBlockMessage } from "@shared/cataloguePublishAccess";
import { catalogueShopDomain } from "@shared/operatorCatalogue";
import { catalogueCandidateChoices, catalogueImportBatches, catalogueImportRows, designCandidates } from "@shared/schema";
import { db } from "./db";
import { readLibraryObject, removeLibraryObject, writeLibraryObject } from "./mockup-library-store";

export type CatalogueImportResult = {
  created: number;
  reused: number;
  firstId: string;
  studioPath: string;
  failures: string[];
  removed: string[];
};

function batchIdOk(batchId: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(batchId);
}

export function catalogueImportStagePath(batchId: string, filename: string): string {
  const objectName = catalogueStorageName(filename);
  if (!batchIdOk(batchId) || !objectName) throw new Error("That upload is not a catalogue batch.");
  return `catalogue-import/${batchId}/${objectName}`;
}

function isPng(buf: Buffer): boolean {
  return buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
}

export function decodeCataloguePng(filename: string, imageBase64: string): Buffer {
  const raw = imageBase64.replace(/^data:image\/[a-z0-9.+-]+;base64,/i, "");
  const buf = Buffer.from(raw, "base64");
  if (!isPng(buf)) throw new Error(`${filename} is not a PNG.`);
  return buf;
}

export async function assertCatalogueImportShop(shop: string | null | undefined): Promise<string> {
  const domain = catalogueShopDomain(shop);
  const block = catalogueStudioBlockMessage(domain);
  if (block || !domain) throw new Error(block || "Catalogue changes are not available for this store.");
  const { storage } = await import("./storage");
  const installation = await storage.getShopifyInstallationByShop(domain);
  if (!installation?.accessToken || installation.status !== "active") {
    throw new Error("Connect Shopify before importing designs.");
  }
  const merchant = installation.merchantId ? await storage.getMerchant(installation.merchantId) : null;
  if (!merchant?.printifyApiToken || !merchant.printifyShopId) {
    throw new Error("Connect Printify before importing designs.");
  }
  return domain;
}

async function removeStaged(batchId: string, filenames: string[]): Promise<void> {
  if (!batchIdOk(batchId)) return;
  for (const filename of filenames) {
    if (!catalogueStorageName(filename)) continue;
    try {
      await removeLibraryObject(catalogueImportStagePath(batchId, filename));
    } catch (err) {
      console.error(`[catalogue-import] remove ${filename}:`, err instanceof Error ? err.message : err);
    }
  }
}

export function cataloguePngHash(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

export async function stageCataloguePng(batchId: string, filename: string, imageBase64: string, shop?: string | null): Promise<{ hash: string }> {
  const domain = await assertCatalogueImportShop(shop);
  const buf = decodeCataloguePng(filename, imageBase64);
  const path = catalogueImportStagePath(batchId, filename);
  await removeLibraryObject(path).catch(() => undefined);
  await writeLibraryObject(path, buf, "image/png");
  const hash = cataloguePngHash(buf);
  await ensureCatalogueImportBatch(domain, batchId);
  await upsertCatalogueImportRow(domain, batchId, { filename, contentHash: hash, importStatus: "uploaded" });
  return { hash };
}

export async function abortCatalogueImport(shop: string, batchId: string, filenames: string[]): Promise<void> {
  const names = filenames.map((name) => name.trim()).filter(Boolean);
  await removeStaged(batchId, names);
  if (!batchIdOk(batchId) || !shop || !names.length) return;
  await db.delete(catalogueImportRows).where(and(
    eq(catalogueImportRows.shopDomain, shop),
    eq(catalogueImportRows.batchId, batchId),
    inArray(catalogueImportRows.filename, names),
  ));
}

export async function ensureCatalogueImportBatch(shop: string, batchId: string): Promise<void> {
  if (!batchIdOk(batchId)) throw new Error("That upload is not a catalogue batch.");
  const now = new Date();
  await db.insert(catalogueImportBatches).values({ id: batchId, shopDomain: shop, createdAt: now, updatedAt: now }).onConflictDoUpdate({
    target: catalogueImportBatches.id,
    set: { updatedAt: now },
  });
}

type ImportDb = Pick<typeof db, "select" | "insert" | "update">;

export async function upsertCatalogueImportRow(
  shop: string,
  batchId: string,
  row: Partial<CatalogueImportRow> & { filename: string },
  exec: ImportDb = db,
): Promise<void> {
  if (!batchIdOk(batchId)) throw new Error("That upload is not a catalogue batch.");
  const filename = row.filename;
  const now = new Date();
  const [existing] = await exec.select().from(catalogueImportRows).where(and(
    eq(catalogueImportRows.batchId, batchId),
    eq(catalogueImportRows.filename, filename),
  )).limit(1);
  const next = {
    shopDomain: shop,
    proposedFilename: row.proposedFilename ?? existing?.proposedFilename ?? null,
    contentHash: row.contentHash ?? existing?.contentHash ?? null,
    importStatus: row.importStatus ?? existing?.importStatus ?? "drafted",
    failureReason: row.failureReason ?? (row.importStatus === "failed" ? existing?.failureReason ?? null : null),
    style: row.style ?? existing?.style ?? "",
    species: row.species ?? existing?.species ?? "",
    humourOperator: row.humourOperator ?? existing?.humourOperator ?? "",
    truth: row.truth ?? existing?.truth ?? "",
    device: row.device ?? existing?.device ?? "",
    exactWording: row.exactWording ?? existing?.exactWording ?? "",
    source: row.source ?? existing?.source ?? "draft",
    lowConfidence: row.lowConfidence ?? existing?.lowConfidence ?? { style: false, humourOperator: false },
    selected: row.selected ?? existing?.selected ?? true,
    acknowledgedWarnings: row.acknowledgedWarnings ?? existing?.acknowledgedWarnings ?? false,
    candidateId: row.candidateId ?? existing?.candidateId ?? null,
    rowNumber: row.rowNumber ?? existing?.rowNumber ?? 0,
    updatedAt: now,
  };
  if (!existing) {
    await exec.insert(catalogueImportRows).values({ id: randomUUID(), batchId, filename, createdAt: now, ...next });
    return;
  }
  await exec.update(catalogueImportRows).set(next).where(eq(catalogueImportRows.id, existing.id));
  const savedWording = row.exactWording;
  if (existing.candidateId && typeof savedWording === "string" && savedWording !== existing.exactWording) {
    await exec.update(designCandidates).set({ punchline: savedWording, updatedAt: now }).where(and(
      eq(designCandidates.id, existing.candidateId),
      eq(designCandidates.shopDomain, shop),
      eq(designCandidates.status, "pending"),
    ));
  }
}

export async function readOpenCatalogueImport(shop: string): Promise<{ batchId: string; rows: CatalogueImportRow[] } | null> {
  const batches = await db.select().from(catalogueImportBatches).where(eq(catalogueImportBatches.shopDomain, shop)).orderBy(desc(catalogueImportBatches.updatedAt)).limit(10);
  for (const batch of batches) {
    const stored = await db.select().from(catalogueImportRows).where(eq(catalogueImportRows.batchId, batch.id)).orderBy(catalogueImportRows.rowNumber);
    if (!stored.length) continue;
    if (stored.every((row) => row.importStatus === "queued")) continue;
    return {
      batchId: batch.id,
      rows: stored.map((row) => ({
        rowNumber: row.rowNumber,
        filename: row.filename,
        style: row.style,
        species: row.species,
        humourOperator: row.humourOperator,
        truth: row.truth,
        device: row.device,
        exactWording: row.exactWording,
        source: row.source === "csv" ? "csv" : "draft",
        lowConfidence: row.lowConfidence || { style: false, humourOperator: false },
        proposedFilename: row.proposedFilename || undefined,
        failureReason: row.failureReason || undefined,
        contentHash: row.contentHash || undefined,
        importStatus: row.importStatus as CatalogueImportRow["importStatus"],
        candidateId: row.candidateId || undefined,
        selected: row.selected,
        acknowledgedWarnings: row.acknowledgedWarnings === true,
      })),
    };
  }
  return null;
}

async function knownCatalogueHashes(shop: string): Promise<Map<string, string>> {
  const rows = await db.select({
    hash: catalogueImportRows.contentHash,
    candidateId: catalogueImportRows.candidateId,
  }).from(catalogueImportRows).where(and(
    eq(catalogueImportRows.shopDomain, shop),
    isNotNull(catalogueImportRows.contentHash),
    isNotNull(catalogueImportRows.candidateId),
    ne(catalogueImportRows.candidateId, ""),
  ));
  const known = new Map<string, string>();
  for (const row of rows) {
    if (row.hash && row.candidateId) known.set(row.hash, row.candidateId);
  }
  const stored = await db.select({
    id: designCandidates.id,
    hash: designCandidates.sourceContentHash,
  }).from(designCandidates).where(and(
    eq(designCandidates.shopDomain, shop),
    isNotNull(designCandidates.sourceContentHash),
  ));
  for (const row of stored) {
    if (row.hash) known.set(row.hash, row.id);
  }
  return known;
}

export async function commitCatalogueImport(args: {
  batchId: string;
  filenames: string[];
  rows: CatalogueImportRow[];
  shop?: string | null;
}): Promise<CatalogueImportResult> {
  const shop = await assertCatalogueImportShop(args.shop);
  const empty = { created: 0, reused: 0, firstId: "", studioPath: "", failures: [] as string[], removed: [] as string[] };
  if (!batchIdOk(args.batchId)) {
    return { ...empty, failures: ["That upload is not a catalogue batch."] };
  }
  if (!args.rows.length) return { ...empty, failures: ["The folder has no PNGs."] };
  await ensureCatalogueImportBatch(shop, args.batchId);
    const review = reviewCatalogueImport({ filenames: args.filenames, rows: args.rows });
    const known = await knownCatalogueHashes(shop);
  const failures: string[] = [];
  const removed: string[] = [];
  const ids: string[] = [];
  let created = 0;

  for (const row of args.rows) {
    const attention = catalogueBlockingNotes(row, args.rows);
    const named = review.failures.filter((failure) => failure.toLowerCase().includes(row.filename.toLowerCase()));
    if (attention.length || named.length) {
      const reason = named[0] || `${row.filename}: ${attention[0].message}`;
      failures.push(reason);
      await upsertCatalogueImportRow(shop, args.batchId, { ...row, importStatus: "failed", failureReason: reason });
      continue;
    }
    const path = catalogueImportStagePath(args.batchId, row.filename);
    let hash = row.contentHash || "";
    try {
      const buf = await readLibraryObject(path);
      if (!isPng(buf)) throw new Error(`${row.filename} is not a PNG.`);
      hash = cataloguePngHash(buf);
    } catch (err) {
      const reason = err instanceof Error ? err.message : `${row.filename} was not uploaded.`;
      failures.push(reason);
      await upsertCatalogueImportRow(shop, args.batchId, { ...row, importStatus: "failed", failureReason: reason });
      continue;
    }
    try {
      const claim = claimCatalogueHash(known, hash, () => randomUUID());
      try {
      await db.transaction(async (tx) => {
        if (claim.created) {
          const now = new Date();
          await tx.insert(designCandidates).values({
            id: claim.candidateId,
            shopDomain: shop,
            status: "pending",
            source: "manual",
            humourOperator: row.humourOperator,
            darknessLevel: 0,
            species: row.species,
            deviceStructure: "",
            deviceText: row.device,
            funnyTruth: row.truth,
            punchline: row.exactWording,
            artStyle: row.style,
            behaviour: "",
            productFamily: "apparel",
            credentialRef: "replicate:shared",
            artworkPath: path,
            sourceContentHash: hash,
            updatedAt: now,
            createdAt: now,
          });
          await tx.insert(catalogueCandidateChoices).values({
            candidateId: claim.candidateId,
            artworkPath: path,
            selectedColors: [],
            updatedAt: now,
          });
        } else if (hash) {
          await tx.update(designCandidates).set({ sourceContentHash: hash }).where(and(
            eq(designCandidates.id, claim.candidateId),
            eq(designCandidates.shopDomain, shop),
            isNull(designCandidates.sourceContentHash),
          ));
        }
        await tx.delete(catalogueImportRows).where(and(
          eq(catalogueImportRows.batchId, args.batchId),
          eq(catalogueImportRows.shopDomain, shop),
          eq(catalogueImportRows.filename, row.filename),
        ));
      });
      if (claim.created) created += 1;
      ids.push(claim.candidateId);
      removed.push(row.filename);
      } catch (err) {
        if (claim.created) known.delete(hash);
        throw err;
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : `${row.filename} was not queued.`;
      failures.push(`${row.filename}: ${reason}`);
      await upsertCatalogueImportRow(shop, args.batchId, { ...row, contentHash: hash, importStatus: "failed", failureReason: reason }).catch(() => undefined);
    }
  }

  const firstId = ids[ids.length - 1] || "";
  return {
    created,
    reused: ids.length - created,
    firstId,
    studioPath: firstId ? `/admin/catalogue-studio?candidate=${firstId}` : "",
    failures,
    removed,
  };
}

/** Drop import rows whose candidate already exists. Uncreated rows stay. The artwork file stays. */
export async function clearCreatedCatalogueImportRows(shop: string, batchId: string): Promise<{ removed: string[] }> {
  const domain = await assertCatalogueImportShop(shop);
  if (!batchIdOk(batchId)) throw new Error("That upload is not a catalogue batch.");
  const stored = await db.select().from(catalogueImportRows).where(and(
    eq(catalogueImportRows.batchId, batchId),
    eq(catalogueImportRows.shopDomain, domain),
  ));
  const candidates = await db.select({
    id: designCandidates.id,
    status: designCandidates.status,
    artworkPath: designCandidates.artworkPath,
    contentHash: designCandidates.sourceContentHash,
  }).from(designCandidates).where(eq(designCandidates.shopDomain, domain));
  const hashed = await db.select({
    hash: catalogueImportRows.contentHash,
    candidateId: catalogueImportRows.candidateId,
  }).from(catalogueImportRows).where(and(
    eq(catalogueImportRows.shopDomain, domain),
    isNotNull(catalogueImportRows.contentHash),
    isNotNull(catalogueImportRows.candidateId),
    ne(catalogueImportRows.candidateId, ""),
  ));
  const hashByCandidate = new Map<string, string>();
  for (const row of hashed) {
    if (row.hash && row.candidateId && !hashByCandidate.has(row.candidateId)) hashByCandidate.set(row.candidateId, row.hash);
  }
  const refs: CatalogueCandidateRef[] = candidates.map((candidate) => ({
    id: candidate.id,
    status: candidate.status,
    artworkPath: candidate.artworkPath,
    contentHash: candidate.contentHash || hashByCandidate.get(candidate.id) || null,
  }));
  const removed: string[] = [];
  for (const row of stored) {
    const match = createdImportRowMatch({
      filename: row.filename,
      contentHash: row.contentHash,
      candidateId: row.candidateId,
    }, refs);
    if (!match) continue;
    if (row.contentHash) {
      await db.update(designCandidates).set({ sourceContentHash: row.contentHash }).where(and(
        eq(designCandidates.id, match.candidateId),
        eq(designCandidates.shopDomain, domain),
        isNull(designCandidates.sourceContentHash),
      ));
    }
    await db.delete(catalogueImportRows).where(and(
      eq(catalogueImportRows.id, row.id),
      eq(catalogueImportRows.shopDomain, domain),
    ));
    removed.push(row.filename);
  }
  return { removed };
}
