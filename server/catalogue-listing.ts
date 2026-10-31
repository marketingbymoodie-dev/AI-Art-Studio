/**
 * Shopify title and description, written at approval.
 * Promote reads the stored strings and does not write new copy.
 */
import { PETPOSTEROUS_CONCEPT_FRAMEWORKS } from "@shared/petposterousCreative";
import { runConceptEngine } from "./concept-engine";

export type CatalogueListing = { title: string; description: string };

export function parseCatalogueListing(raw: unknown, givenTitle: string): CatalogueListing[] | null {
  const row = raw && typeof raw === "object" ? raw as { title?: unknown; description?: unknown } : null;
  const written = String(row?.title || "").replace(/\s+/g, " ").trim();
  const description = String(row?.description || "").replace(/\s+/g, " ").trim();
  const title = givenTitle || written;
  if (!title || title.length > 120 || !description || description.length > 600) return null;
  return [{ title, description }];
}

export async function writeCatalogueListing(input: {
  title: string;
  species: string;
  artStyle: string;
  humourOperator: string;
  punchline: string;
}): Promise<CatalogueListing> {
  const givenTitle = input.title.replace(/\s+/g, " ").trim();
  const framework = PETPOSTEROUS_CONCEPT_FRAMEWORKS[input.humourOperator] || input.humourOperator;
  const [listing] = await runConceptEngine<CatalogueListing>(
    {
      id: "catalogue-listing",
      logTag: "[catalogue-listing]",
      noun: "Listing writer",
      maxTokens: 400,
      system: [
        "You write the Shopify title and description for one Petposterous shirt.",
        "When a name is supplied, the title is that name unchanged.",
        "The description is two sentences a customer reads on the product page.",
        "No price, no sizes, no colour list, no hashtags.",
        'Return ONLY JSON: {"title": string, "description": string}',
      ].join(" "),
      parse: (raw) => parseCatalogueListing(raw, givenTitle),
    },
    [
      givenTitle ? `Name: ${givenTitle}` : "Name: not supplied. Write a short product title from the punchline.",
      `Punchline: ${input.punchline || givenTitle}`,
      `Species: ${input.species}`,
      `Style: ${input.artStyle}`,
      `Humour: ${framework}`,
    ].join("\n"),
  );
  return listing;
}
