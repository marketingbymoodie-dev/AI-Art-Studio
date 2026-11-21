/** One image from the catalogue concept studio. Draw 1 is the candidate artwork. */
export type CatalogueConceptDraw = {
  id: string;
  artworkPath: string;
  prompt: string;
  model: string;
  /** Text-input quote from the sent prompt, before the provider returns usage. */
  estimatedCostUsd: number | null;
  /** Provider usage total. Null when the provider did not return usage. */
  actualCostUsd: number | null;
  createdAt: string;
};

/** Saved on design_candidates.generation. Imported PNGs leave the column null. */
export type CatalogueConceptGeneration = {
  concept: string;
  species: string;
  humor: string;
  look: string;
  wordsMode: "none" | "exact";
  exactWords: string;
  garment: "light" | "dark";
  aspect: string;
  draws: CatalogueConceptDraw[];
};

export const CATALOGUE_CONCEPT_ASPECTS = ["3:4", "1:1", "4:5", "2:3", "4:3"] as const;

export function parseCatalogueConceptGeneration(value: unknown): CatalogueConceptGeneration | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<CatalogueConceptGeneration>;
  if (typeof row.concept !== "string" || !row.concept.trim()) return null;
  const draws = Array.isArray(row.draws)
    ? row.draws.filter((draw): draw is CatalogueConceptDraw => {
        if (!draw || typeof draw !== "object") return false;
        const item = draw as CatalogueConceptDraw;
        return typeof item.id === "string" && typeof item.artworkPath === "string" && typeof item.prompt === "string";
      })
    : [];
  return {
    concept: row.concept,
    species: typeof row.species === "string" ? row.species : "",
    humor: typeof row.humor === "string" ? row.humor : "",
    look: typeof row.look === "string" ? row.look : "",
    wordsMode: row.wordsMode === "exact" ? "exact" : "none",
    exactWords: typeof row.exactWords === "string" ? row.exactWords : "",
    garment: row.garment === "dark" ? "dark" : "light",
    aspect: typeof row.aspect === "string" ? row.aspect : "3:4",
    draws,
  };
}
