function blank(value: string | null | undefined): boolean {
  return !String(value || "").trim();
}

/** Drop and delete apply to pending rows. Approved rows stay until they have a product. */
export function isOpenPending(status: string | null | undefined): boolean {
  return status === "pending";
}

/** Pending still needs the full publish chain. Approved with no product needs Promote. */
export function needsOperatorAction(row: {
  status: string | null | undefined;
  shopifyProductId: string | null | undefined;
}): boolean {
  if (row.status === "pending") return true;
  return row.status === "approved" && blank(row.shopifyProductId);
}

export type OperatorQueueRow = {
  id: string;
  status: string;
  createdAt: Date | string;
};

/** Pending first, then approved. Newest first inside each group. */
export function sortOperatorQueue<T extends OperatorQueueRow>(rows: T[]): T[] {
  const rank = (status: string) => status === "pending" ? 0 : 1;
  return [...rows].sort((a, b) => {
    const byGroup = rank(a.status) - rank(b.status);
    if (byGroup) return byGroup;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
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
