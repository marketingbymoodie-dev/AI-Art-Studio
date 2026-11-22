export type CatalogueListing = { title: string; description: string };

export function parseCatalogueListing(raw: unknown, givenTitle: string): CatalogueListing[] | null {
  const row = raw && typeof raw === "object" ? raw as { title?: unknown; description?: unknown } : null;
  const written = String(row?.title || "").replace(/\s+/g, " ").trim();
  const description = String(row?.description || "").replace(/\s+/g, " ").trim();
  const title = givenTitle || written;
  if (!title || title.length > 120 || !description || description.length > 600) return null;
  return [{ title, description }];
}

/**
 * A truth can anchor the listing only when it is one sentence.
 * A vision stutter such as "fishes with a rod into a rod into" cannot.
 */
export function catalogueTruthIsSentence(truth: string): boolean {
  const text = String(truth || "").replace(/\s+/g, " ").trim();
  const words = text.split(" ").filter(Boolean);
  if (words.length < 4) return false;
  if (!/^[A-Z]/.test(text)) return false;
  if (!/[.!?]$/.test(text)) return false;
  const norm = words.map((word) => word.toLowerCase().replace(/[^a-z0-9']+/g, "")).filter(Boolean);
  for (let i = 1; i < norm.length; i++) {
    if (norm[i] === norm[i - 1]) return false;
  }
  for (let size = 2; size <= 4; size++) {
    const seen = new Set<string>();
    for (let i = 0; i <= norm.length - size; i++) {
      const gram = norm.slice(i, i + size).join(" ");
      if (seen.has(gram)) return false;
      seen.add(gram);
    }
  }
  return true;
}
