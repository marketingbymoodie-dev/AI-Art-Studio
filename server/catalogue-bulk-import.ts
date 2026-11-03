/**
 * Create pending catalogue candidates from a checked CSV and its PNGs.
 * Nothing is inserted until the whole batch validates. Storage from a
 * refused batch is removed.
 */
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { reviewCatalogueImport, catalogueImportObjectName, type CatalogueImportRow } from "@shared/catalogueBulkImport";
import { catalogueCandidateChoices, designCandidates, productTypes } from "@shared/schema";
import { db } from "./db";
import { readLibraryObject, removeLibraryObject, writeLibraryObject } from "./mockup-library-store";

const STAGING_SHOP = "ai-art-studio-staging.myshopify.com";

export type CatalogueImportResult = {
  created: number;
  firstId: string;
  studioPath: string;
  failures: string[];
};

function batchIdOk(batchId: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(batchId);
}

export function catalogueImportStagePath(batchId: string, filename: string): string {
  const objectName = catalogueImportObjectName(filename);
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

async function assertStagingCatalogue(): Promise<void> {
  if (process.env.RAILWAY_ENVIRONMENT_NAME === "production") {
    throw new Error("Catalogue import is staging only.");
  }
  const [row] = await db
    .select({ shop: productTypes.shopifyShopDomain })
    .from(productTypes)
    .where(eq(productTypes.id, 54))
    .limit(1);
  if (String(row?.shop || "") !== STAGING_SHOP) throw new Error("Catalogue import is staging only.");
}

async function removeStaged(batchId: string, filenames: string[]): Promise<void> {
  if (!batchIdOk(batchId)) return;
  for (const filename of filenames) {
    if (!catalogueImportObjectName(filename)) continue;
    try {
      await removeLibraryObject(catalogueImportStagePath(batchId, filename));
    } catch (err) {
      console.error(`[catalogue-import] remove ${filename}:`, err instanceof Error ? err.message : err);
    }
  }
}

export async function stageCataloguePng(batchId: string, filename: string, imageBase64: string): Promise<void> {
  await assertStagingCatalogue();
  const buf = decodeCataloguePng(filename, imageBase64);
  const path = catalogueImportStagePath(batchId, filename);
  await removeLibraryObject(path).catch(() => undefined);
  await writeLibraryObject(path, buf, "image/png");
}

export async function abortCatalogueImport(batchId: string, filenames: string[]): Promise<void> {
  await removeStaged(batchId, filenames);
}

export async function commitCatalogueImport(args: {
  batchId: string;
  filenames: string[];
  rows: CatalogueImportRow[];
}): Promise<CatalogueImportResult> {
  await assertStagingCatalogue();
  const empty = { created: 0, firstId: "", studioPath: "", failures: [] as string[] };
  if (!batchIdOk(args.batchId)) {
    return { ...empty, failures: ["That upload is not a catalogue batch."] };
  }
  const review = reviewCatalogueImport({ filenames: args.filenames, rows: args.rows });
  if (review.failures.length || !args.rows.length) {
    await removeStaged(args.batchId, args.filenames);
    return { ...empty, failures: review.failures.length ? review.failures : ["The folder has no PNGs."] };
  }

  const staged: Array<{ row: CatalogueImportRow; path: string }> = [];
  const failures: string[] = [];
  for (const row of args.rows) {
    const path = catalogueImportStagePath(args.batchId, row.filename);
    try {
      const buf = await readLibraryObject(path);
      if (!isPng(buf)) failures.push(`${row.filename} is not a PNG.`);
      else staged.push({ row, path });
    } catch {
      failures.push(`${row.filename} is in the CSV and was not uploaded.`);
    }
  }
  if (staged.length !== args.rows.length) {
    failures.push("A staged image did not match the review table.");
  }
  if (failures.length) {
    await removeStaged(args.batchId, args.filenames);
    return { ...empty, failures };
  }

  const ids: string[] = [];
  try {
    const started = Date.now();
    await db.transaction(async (tx) => {
      for (let index = 0; index < staged.length; index++) {
        const item = staged[index];
        const id = randomUUID();
        const now = new Date(started + index);
        ids.push(id);
        await tx.insert(designCandidates).values({
          id,
          shopDomain: STAGING_SHOP,
          status: "pending",
          source: "manual",
          humourOperator: item.row.humourOperator,
          darknessLevel: 0,
          species: item.row.species,
          deviceStructure: "",
          deviceText: item.row.device,
          funnyTruth: item.row.truth,
          punchline: item.row.exactWording,
          artStyle: item.row.style,
          behaviour: "",
          productFamily: "apparel",
          credentialRef: "replicate:shared",
          artworkPath: item.path,
          updatedAt: now,
          createdAt: now,
        });
        await tx.insert(catalogueCandidateChoices).values({
          candidateId: id,
          artworkPath: item.path,
          selectedColors: [],
          updatedAt: now,
        });
      }
    });
  } catch (err) {
    await removeStaged(args.batchId, args.filenames);
    throw err;
  }

  const firstId = ids[0] || "";
  return {
    created: ids.length,
    firstId,
    studioPath: firstId ? `/admin/catalogue-studio?candidate=${firstId}` : "",
    failures: [],
  };
}
