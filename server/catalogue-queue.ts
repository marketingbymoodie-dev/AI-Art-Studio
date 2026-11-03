function blank(value: string | null | undefined): boolean {
  return !String(value || "").trim();
}

/** Pending is the only status that still needs a decision. Dropped rows stay stored. */
export function isOpenPending(status: string | null | undefined): boolean {
  return status === "pending";
}

/** The candidate after `currentId` in an already-ordered queue. */
export function nextQueueId(ids: string[], currentId: string): string {
  const index = ids.indexOf(currentId);
  if (index < 0) return ids[0] || "";
  return ids[index + 1] || "";
}

/** A pending candidate with no artwork, print file, or product can be deleted. */
export function candidateCanBeDeleted(row: {
  status: string | null | undefined;
  artworkPath: string | null | undefined;
  choiceArtworkPath: string | null | undefined;
  printFilePath: string | null | undefined;
  shopifyProductId: string | null | undefined;
  printifyProductId: string | null | undefined;
}): boolean {
  return isOpenPending(row.status)
    && blank(row.artworkPath)
    && blank(row.choiceArtworkPath)
    && blank(row.printFilePath)
    && blank(row.shopifyProductId)
    && blank(row.printifyProductId);
}
