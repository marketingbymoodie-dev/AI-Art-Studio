/**
 * Approval stores everything promote later publishes.
 * Promote does not render, vectorize, or write the title.
 */
import { eq } from "drizzle-orm";
import {
  darknessLevel,
  deviceStructureId,
  humourOperatorId,
  type ArtStyleDeviceStructure,
} from "@shared/flywheelRecipe";
import { designCandidates, productTypes } from "@shared/schema";
import { writeCatalogueListing } from "./catalogue-listing";
import { db } from "./db";
import { buildFlywheelPrintFile, printCanvasFromStoredPlaceholders, printFilePathForStyle } from "./flywheel-print-file";
import {
  approveCandidateChoice,
  readChoice,
  readLibraryObject,
  softstyleType,
  writeLibraryObject,
} from "./mockup-library-store";

type ChoiceColor = { name: string; hex: string };

const STAGING_SHOP = "ai-art-studio-staging.myshopify.com";

export type ApprovalRecipe = {
  candidateId: string;
  panelId: string;
  selectedColors: ChoiceColor[];
  artStyle: string;
  species: string;
  humourOperator: string;
  punchline: string;
  behaviour: string;
  funnyTruth: string;
  deviceText: string;
  deviceStructure: string;
  darknessLevel: number;
  /** Name already on the design. The listing writer keeps it. */
  title: string;
};

function clip(value: string, max: number): string {
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

function requireRecipe(recipe: ApprovalRecipe): {
  artStyle: string;
  species: string;
  humourOperator: string;
  structure: ArtStyleDeviceStructure;
  darkness: number;
} {
  let artStyle = "";
  try {
    artStyle = recipe.artStyle;
    printFilePathForStyle(artStyle);
  } catch {
    throw new Error("Style is not stored. Approval needs a launch style.");
  }
  const species = clip(recipe.species, 80);
  if (!species) throw new Error("Species is not stored.");
  const humourOperator = humourOperatorId(recipe.humourOperator);
  if (!humourOperator) throw new Error("Humour operator is not stored.");
  const structure = deviceStructureId(recipe.deviceStructure);
  if (!structure) throw new Error("Device structure is not stored.");
  const darkness = darknessLevel(recipe.darknessLevel);
  if (darkness == null) throw new Error("Darkness is not stored.");
  if (!clip(recipe.funnyTruth, 400)) throw new Error("Truth is not stored.");
  if (!clip(recipe.deviceText, 400)) throw new Error("Device is not stored.");
  if (!clip(recipe.behaviour, 400)) throw new Error("Behaviour is not stored.");
  if (!recipe.panelId) throw new Error("Scene is not stored.");
  if (!recipe.selectedColors.length) throw new Error("No colours selected.");
  return { artStyle, species, humourOperator, structure, darkness };
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
  const checked = requireRecipe(recipe);
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

  const [existing] = await db
    .select({ title: designCandidates.title, description: designCandidates.description })
    .from(designCandidates)
    .where(eq(designCandidates.id, recipe.candidateId))
    .limit(1);
  const givenTitle = clip(recipe.title, 120) || clip(recipe.punchline, 120);
  let listing = existing?.title && existing.description
    ? { title: existing.title, description: existing.description }
    : null;
  let writerError = "";
  if (!listing) {
    try {
      listing = await writeCatalogueListing({
        title: givenTitle,
        species: checked.species,
        artStyle: checked.artStyle,
        humourOperator: checked.humourOperator,
        punchline: clip(recipe.punchline, 120),
      });
    } catch (err) {
      writerError = err instanceof Error ? err.message : String(err);
      const description = clip(recipe.funnyTruth, 600);
      if (!givenTitle || !description) throw err;
      listing = { title: givenTitle, description };
    }
  }

  if (!listing) throw new Error("Title and description were not stored.");
  const row = {
    shopDomain: shop,
    status: "approved" as const,
    source: "manual" as const,
    humourOperator: checked.humourOperator,
    darknessLevel: checked.darkness,
    species: checked.species,
    deviceStructure: checked.structure,
    deviceText: clip(recipe.deviceText, 400),
    funnyTruth: clip(recipe.funnyTruth, 400),
    punchline: clip(recipe.punchline, 120),
    artStyle: checked.artStyle,
    behaviour: clip(recipe.behaviour, 400),
    productFamily: "apparel",
    credentialRef: "replicate:shared",
    printFilePath,
    panelId: recipe.panelId,
    selectedColors: recipe.selectedColors,
    title: listing.title,
    description: listing.description,
    updatedAt: new Date(),
  };
  if (existing) {
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
