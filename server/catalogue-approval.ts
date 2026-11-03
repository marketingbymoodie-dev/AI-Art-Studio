import {
  darknessLevel,
  deviceStructureId,
  humourOperatorId,
  type ArtStyleDeviceStructure,
} from "@shared/flywheelRecipe";
import { printFilePathForStyle } from "./flywheel-print-file";

type ChoiceColor = { name: string; hex: string };

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

/** Catalogue imports are source manual. Generation fields are not part of that artwork. */
export function generationFieldsRequired(source: string | null | undefined): boolean {
  return source !== "manual";
}

export function requireRecipe(recipe: ApprovalRecipe, source: string | null | undefined): {
  artStyle: string;
  species: string;
  humourOperator: string;
  structure: ArtStyleDeviceStructure | "";
  darkness: number;
  behaviour: string;
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
  const generated = generationFieldsRequired(source);
  const structure = deviceStructureId(recipe.deviceStructure);
  if (generated && !structure) throw new Error("Device structure is not stored.");
  const darkness = darknessLevel(recipe.darknessLevel);
  if (generated && darkness == null) throw new Error("Darkness is not stored.");
  const behaviour = clip(recipe.behaviour, 400);
  if (generated && !behaviour) throw new Error("Behaviour is not stored.");
  if (!clip(recipe.funnyTruth, 400)) throw new Error("Truth is not stored.");
  if (!clip(recipe.deviceText, 400)) throw new Error("Device is not stored.");
  if (!recipe.panelId) throw new Error("Scene is not stored.");
  if (!recipe.selectedColors.length) throw new Error("No colours selected.");
  return { artStyle, species, humourOperator, structure: structure || "", darkness: darkness ?? 0, behaviour };
}
