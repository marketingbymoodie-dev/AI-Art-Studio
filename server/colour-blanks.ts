/**
 * Operator colour list for the mockup library.
 * Saving a colour here does not rename blanks, products, or variants.
 */
import { and, asc, eq, ne, sql } from "drizzle-orm";
import {
  blankNameKey,
  blankNameMatch,
  composeBlankChoice,
  normaliseBlankHex,
  SOFTSTYLE_COLOUR_SEED,
  type BlankFinish,
} from "@shared/colourBlanks";
import { mockupLibraryColours, productTypes } from "@shared/schema";
import { db, pool } from "./db";
import {
  approvePaintedBlank,
  approveUploadedBlank,
  panelsForType,
  previewPaintedBlank,
  renameStoredBlankColour,
  restoreBlankRevision,
  signedBlankPhoto,
  signedLibraryUrl,
} from "./mockup-library-store";

let tableReady: Promise<void> | null = null;

export function ensureColourBlankTable(): Promise<void> {
  if (!tableReady) {
    tableReady = (async () => {
      await pool.query(`CREATE TABLE IF NOT EXISTS mockup_library_colours (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
        product_type_id integer NOT NULL,
        name text NOT NULL,
        printify_option_id integer,
        printify_title text NOT NULL,
        hex text NOT NULL,
        finish text NOT NULL,
        link_stored_name text,
        sort_order integer NOT NULL DEFAULT 0,
        created_at timestamp NOT NULL DEFAULT now()
      )`);
      await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS mockup_library_colours_type_name_uidx
        ON mockup_library_colours (product_type_id, name)`);
    })().catch((err) => {
      tableReady = null;
      throw err;
    });
  }
  return tableReady;
}

async function seedSoftstyleColours(): Promise<void> {
  const [count] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(mockupLibraryColours)
    .where(eq(mockupLibraryColours.productTypeId, 54));
  if (Number(count?.n || 0) > 0) return;
  await db.insert(mockupLibraryColours).values(SOFTSTYLE_COLOUR_SEED.map((row) => ({
    productTypeId: 54,
    name: row.name,
    printifyOptionId: row.printifyOptionId,
    printifyTitle: row.printifyTitle,
    hex: row.hex,
    finish: row.finish,
    linkStoredName: row.linkStoredName,
    sortOrder: row.sortOrder,
  }))).onConflictDoNothing();
}

function asFinish(value: string): BlankFinish {
  return value === "heather" ? "heather" : "solid";
}

export async function colourBlankGrid(productTypeId: number) {
  await ensureColourBlankTable();
  if (productTypeId === 54) await seedSoftstyleColours();
  const [typeRow] = await db
    .select({ id: productTypes.id, name: productTypes.name })
    .from(productTypes)
    .where(eq(productTypes.id, productTypeId))
    .limit(1);
  const typeIds = await pool.query<{ id: number }>(`SELECT DISTINCT product_type_id AS id FROM mockup_panels ORDER BY 1`);
  const known = await db.select({ id: productTypes.id, name: productTypes.name }).from(productTypes);
  const names = new Map(known.map((row) => [row.id, row.name]));
  const colourRows = await db
    .select()
    .from(mockupLibraryColours)
    .where(eq(mockupLibraryColours.productTypeId, productTypeId))
    .orderBy(asc(mockupLibraryColours.sortOrder), asc(mockupLibraryColours.name));
  const panels = await panelsForType(productTypeId);
  const storedNames = [...new Set(panels.map((row) => row.garmentColor))];
  const colours = colourRows.map((row) => {
    const match = blankNameMatch(row.name, row.linkStoredName, storedNames);
    const linked = match.state === "name-mismatch"
      ? panels.filter((panel) => blankNameKey(panel.garmentColor) === blankNameKey(match.storedName))
      : [];
    return {
      id: row.id,
      name: row.name,
      printifyOptionId: row.printifyOptionId,
      printifyTitle: row.printifyTitle,
      hex: row.hex,
      finish: asFinish(row.finish),
      linkStoredName: row.linkStoredName,
      sortOrder: row.sortOrder,
      match: match.state,
      storedName: match.state === "name-mismatch" ? match.storedName : null,
      storedRows: linked.length,
      storedScenes: new Set(linked.map((panel) => panel.panelId)).size,
    };
  });

  const groups = new Map<string, { label: string; isDefault: boolean; rows: typeof panels }>();
  for (const row of panels) {
    let group = groups.get(row.panelId);
    if (!group) {
      group = { label: row.label, isDefault: false, rows: [] };
      groups.set(row.panelId, group);
    }
    if (row.isDefault) group.isDefault = true;
    group.rows.push(row);
  }

  const scenes = [...groups.entries()]
    .sort((a, b) => Number(b[1].isDefault) - Number(a[1].isDefault) || a[0].localeCompare(b[0]))
    .map(([panelId, group]) => {
      const composeRows = group.rows.map((row) => ({
        id: row.id,
        name: row.garmentColor,
        hex: row.garmentHex,
        kind: row.kind === "white-master" ? "white-master" as const : "produced" as const,
      }));
      const cells = colourRows.map((colour) => {
        const exact = group.rows.filter((row) => blankNameKey(row.garmentColor) === blankNameKey(colour.name));
        const current = exact[0] ?? null;
        const choice = composeBlankChoice(composeRows, colour.name);
        const revision = (row: typeof exact[number]) => ({
          id: row.id,
          name: row.garmentColor,
          hex: row.garmentHex,
          kind: row.kind,
          createdAt: row.createdAt.toISOString(),
        });
        return {
          colourId: colour.id,
          state: current ? "present" as const : "missing" as const,
          photoUrl: null as string | null,
          storagePath: current?.storagePath ?? null,
          compose: {
            mode: choice.mode,
            sourceName: choice.sourceName,
            usesThisBlank: Boolean(current && choice.rowId === current.id && choice.mode === "produced"),
          },
          current: current ? revision(current) : null,
          history: exact.slice(1).map(revision),
        };
      });
      return { panelId, label: group.label, isDefault: group.isDefault, cells };
    });

  await Promise.all(scenes.flatMap((scene) => scene.cells.filter((cell) => cell.storagePath).map(async (cell) => {
    try {
      cell.photoUrl = await signedLibraryUrl(cell.storagePath!, 60 * 30);
    } catch {
      cell.photoUrl = null;
    }
  })));
  for (const scene of scenes) for (const cell of scene.cells) delete (cell as { storagePath?: string }).storagePath;

  return {
    productType: { id: productTypeId, name: typeRow?.name || (productTypeId === 54 ? "Unisex Softstyle T-Shirt" : `Type ${productTypeId}`) },
    types: typeIds.rows.map((row) => ({ id: Number(row.id), name: names.get(Number(row.id)) || `Type ${row.id}` })),
    colours,
    scenes,
  };
}

async function requireColour(id: string) {
  await ensureColourBlankTable();
  const [row] = await db.select().from(mockupLibraryColours).where(eq(mockupLibraryColours.id, id)).limit(1);
  if (!row) throw new Error("That colour is not in the list");
  return row;
}

export async function saveColourBlank(id: string, patch: {
  name: string;
  printifyTitle: string;
  printifyOptionId: number | null;
  hex: string;
  finish: string;
  linkStoredName: string | null;
}) {
  const current = await requireColour(id);
  const name = patch.name.trim();
  if (!name) throw new Error("Name is required");
  const hex = normaliseBlankHex(patch.hex);
  const finish = asFinish(patch.finish);
  const [dup] = await db
    .select({ id: mockupLibraryColours.id })
    .from(mockupLibraryColours)
    .where(and(
      eq(mockupLibraryColours.productTypeId, current.productTypeId),
      ne(mockupLibraryColours.id, id),
      sql`lower(trim(${mockupLibraryColours.name})) = ${name.toLowerCase()}`,
    ))
    .limit(1);
  if (dup) throw new Error("That name is already in this list");
  await db.update(mockupLibraryColours).set({
    name,
    printifyTitle: patch.printifyTitle.trim() || name,
    printifyOptionId: patch.printifyOptionId,
    hex,
    finish,
    linkStoredName: patch.linkStoredName?.trim() || null,
  }).where(eq(mockupLibraryColours.id, id));
  return { id };
}

export async function createColourBlank(productTypeId: number, patch: {
  name: string;
  printifyTitle: string;
  printifyOptionId: number | null;
  hex: string;
  finish: string;
  linkStoredName: string | null;
}) {
  await ensureColourBlankTable();
  const name = patch.name.trim();
  if (!name) throw new Error("Name is required");
  const [last] = await db
    .select({ sortOrder: mockupLibraryColours.sortOrder })
    .from(mockupLibraryColours)
    .where(eq(mockupLibraryColours.productTypeId, productTypeId))
    .orderBy(sql`${mockupLibraryColours.sortOrder} desc`)
    .limit(1);
  const [inserted] = await db.insert(mockupLibraryColours).values({
    productTypeId,
    name,
    printifyTitle: patch.printifyTitle.trim() || name,
    printifyOptionId: patch.printifyOptionId,
    hex: normaliseBlankHex(patch.hex),
    finish: asFinish(patch.finish),
    linkStoredName: patch.linkStoredName?.trim() || null,
    sortOrder: (last?.sortOrder ?? -1) + 1,
  }).returning({ id: mockupLibraryColours.id });
  if (!inserted) throw new Error("The colour was not added");
  return { id: inserted.id };
}

export async function paintColourBlank(colourId: string, panelId: string) {
  const colour = await requireColour(colourId);
  if (colour.finish === "heather") throw new Error("Heather colours are photographs. They are not painted from the white master.");
  return previewPaintedBlank(colour.productTypeId, panelId, colour.hex);
}

export async function approveColourBlank(colourId: string, panelId: string, uploadedBy: string | null) {
  const colour = await requireColour(colourId);
  if (colour.finish === "heather") throw new Error("Heather colours are photographs. They are not painted from the white master.");
  return approvePaintedBlank({
    productTypeId: colour.productTypeId,
    panelId,
    garmentColor: colour.name,
    garmentHex: colour.hex,
    uploadedBy,
  });
}

export async function uploadColourBlank(args: {
  colourId: string;
  panelId: string;
  imageBase64: string;
  uploadedBy: string | null;
  confirmMask?: boolean;
}) {
  const colour = await requireColour(args.colourId);
  return approveUploadedBlank({
    productTypeId: colour.productTypeId,
    panelId: args.panelId,
    garmentColor: colour.name,
    garmentHex: colour.hex,
    imageBase64: args.imageBase64,
    uploadedBy: args.uploadedBy,
    confirmMask: args.confirmMask,
  });
}

export async function linkColourBlank(colourId: string) {
  const colour = await requireColour(colourId);
  const from = (colour.linkStoredName || "").trim();
  if (!from) throw new Error("This colour has no stored name to link");
  return renameStoredBlankColour(colour.productTypeId, from, colour.name);
}

export { restoreBlankRevision, signedBlankPhoto };
