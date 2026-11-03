/**
 * Approval stores everything promote later publishes.
 * Promote does not render, vectorize, or write the title.
 */
import { eq } from "drizzle-orm";
import { requireRecipe, type ApprovalRecipe } from "./catalogue-approval";
export type { ApprovalRecipe };
import { designCandidates, productTypes } from "@shared/schema";
import { catalogueListingIsFresh, catalogueTruthIsSentence, rememberCatalogueListingSpend, writeCatalogueListing } from "./catalogue-listing";
import { db } from "./db";
import { buildFlywheelPrintFile, printCanvasFromStoredPlaceholders } from "./flywheel-print-file";
import {
  approveCandidateChoice,
  readChoice,
  readLibraryObject,
  softstyleType,
  writeLibraryObject,
} from "./mockup-library-store";

const STAGING_SHOP = "ai-art-studio-staging.myshopify.com";

function clip(value: string, max: number): string {
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

async function printFilePathFor(candidateId: string, artStyle: string, source: Buffer, canvas: { width: number; height: number }): Promise<string> {
  const path = `print-files/${candidateId}-${artStyle}.png`;
  try {
    await readLibraryObject(path);
    return path;
  } catch {
    const print = await buildFlywheelPrintFile(artStyle, source, canvas);
    await writeLibraryObject(path, print.buffer, "image/png");
    return path;
  }
}

export async function approveCatalogueCandidate(recipe: ApprovalRecipe): Promise<{
  title: string;
  description: string;
  printFilePath: string;
  mockupCount: number;
  writerError: string;
}> {
  const [stored] = await db.select().from(designCandidates).where(eq(designCandidates.id, recipe.candidateId)).limit(1);
  const checked = requireRecipe(recipe, stored?.source);
  const garment = await softstyleType();
  const [typeRow] = await db
    .select({
      name: productTypes.name,
      shop: productTypes.shopifyShopDomain,
      placeholderPositions: productTypes.placeholderPositions,
    })
    .from(productTypes)
    .where(eq(productTypes.id, garment.id))
    .limit(1);
  if (!typeRow) throw new Error("Unisex Softstyle T-Shirt was not found.");
  const shop = String(typeRow.shop || "");
  if (shop !== STAGING_SHOP) throw new Error("Approval of this candidate is staging only.");

  let choice = await readChoice(recipe.candidateId);
  const covered = recipe.selectedColors.every((color) =>
    choice.mockupImages.some((image) => image.name.toLowerCase() === color.name.toLowerCase()),
  );
  if (!covered) {
    await approveCandidateChoice({
      candidateId: recipe.candidateId,
      productTypeId: garment.id,
      typeName: typeRow.name,
      panelId: recipe.panelId,
      selectedColors: recipe.selectedColors,
    });
    choice = await readChoice(recipe.candidateId);
  }
  if (!choice.artworkPath) throw new Error("Candidate artwork is not stored.");
  const missingMockup = recipe.selectedColors.find(
    (color) => !choice.mockupImages.some((image) => image.name.toLowerCase() === color.name.toLowerCase()),
  );
  if (missingMockup) throw new Error(`No stored mockup for ${missingMockup.name}.`);

  const canvas = printCanvasFromStoredPlaceholders(typeRow.placeholderPositions, typeRow.name);
  const source = await readLibraryObject(choice.artworkPath);
  const printFilePath = await printFilePathFor(recipe.candidateId, checked.artStyle, source, canvas);

  const lettering = clip(recipe.punchline, 120);
  const truth = clip(recipe.funnyTruth, 600);
  let listing = stored?.title && stored.description && await catalogueListingIsFresh(recipe.candidateId)
    ? { title: stored.title, description: stored.description }
    : null;
  let writerError = "";
  if (!listing) {
    const started = Date.now();
    try {
      listing = await writeCatalogueListing({
        title: lettering,
        species: checked.species,
        artStyle: checked.artStyle,
        humourOperator: checked.humourOperator,
        punchline: lettering,
        funnyTruth: clip(recipe.funnyTruth, 400),
        deviceText: clip(recipe.deviceText, 400),
        artwork: source,
      });
      await rememberCatalogueListingSpend(recipe.candidateId, shop, true, Date.now() - started);
    } catch (err) {
      await rememberCatalogueListingSpend(recipe.candidateId, shop, false, Date.now() - started);
      writerError = err instanceof Error ? err.message : String(err);
      if (!lettering || !catalogueTruthIsSentence(truth)) throw err;
      listing = { title: lettering, description: truth };
    }
  }

  if (!listing) throw new Error("Title and description were not stored.");
  const row = {
    shopDomain: shop,
    status: "approved" as const,
    source: stored?.source === "generated" ? "generated" as const : "manual" as const,
    humourOperator: checked.humourOperator,
    darknessLevel: checked.darkness || stored?.darknessLevel || 0,
    species: checked.species,
    deviceStructure: checked.structure || stored?.deviceStructure || "",
    deviceText: clip(recipe.deviceText, 400),
    funnyTruth: clip(recipe.funnyTruth, 400),
    punchline: clip(recipe.punchline, 120),
    artStyle: checked.artStyle,
    behaviour: checked.behaviour || stored?.behaviour || "",
    productFamily: "apparel",
    credentialRef: "replicate:shared",
    printFilePath,
    panelId: recipe.panelId,
    selectedColors: recipe.selectedColors,
    title: listing.title,
    description: listing.description,
    updatedAt: new Date(),
  };
  if (stored) {
    await db.update(designCandidates).set(row).where(eq(designCandidates.id, recipe.candidateId));
  } else {
    await db.insert(designCandidates).values({ id: recipe.candidateId, ...row });
  }
  return {
    title: listing.title,
    description: listing.description,
    printFilePath,
    mockupCount: choice.mockupImages.length,
    writerError,
  };
}
