/**
 * Fills listing copy on product types that have never had a garment word stored.
 * A later explicit clear to "" stays empty and blocks publish.
 */
import { and, eq, isNull } from "drizzle-orm";
import { suggestListingCopy } from "@shared/listingCopy";
import { productTypes } from "@shared/schema";
import { db } from "./db";

export async function backfillListingCopy(): Promise<number> {
  const rows = await db
    .select({ id: productTypes.id, name: productTypes.name })
    .from(productTypes)
    .where(isNull(productTypes.listingGarmentWord));
  let updated = 0;
  for (const row of rows) {
    const copy = suggestListingCopy(row.name);
    const written = await db
      .update(productTypes)
      .set({
        listingGarmentWord: copy.garmentWord,
        listingHandleSuffix: copy.handleSuffix,
        listingStyleLabel: copy.styleLabel,
      })
      .where(and(eq(productTypes.id, row.id), isNull(productTypes.listingGarmentWord)))
      .returning({ id: productTypes.id });
    updated += written.length;
  }
  return updated;
}
