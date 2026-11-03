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

/** Every missing input, not just the first. Publish shows the whole list before it spends. */
export function recipeGaps(recipe: ApprovalRecipe, source: string | null | undefined): string[] {
  const gaps: string[] = [];
  try {
    printFilePathForStyle(recipe.artStyle);
  } catch {
    gaps.push("Style is not stored. Approval needs a launch style.");
  }
  if (!clip(recipe.species, 80)) gaps.push("Species is not stored.");
  if (!humourOperatorId(recipe.humourOperator)) gaps.push("Humour operator is not stored.");
  const generated = generationFieldsRequired(source);
  const structure = deviceStructureId(recipe.deviceStructure);
  if (generated && !structure) gaps.push("Device structure is not stored.");
  if (generated && darknessLevel(recipe.darknessLevel) == null) gaps.push("Darkness is not stored.");
  if (generated && !clip(recipe.behaviour, 400)) gaps.push("Behaviour is not stored.");
  if (!clip(recipe.funnyTruth, 400)) gaps.push("Truth is not stored.");
  if (!clip(recipe.deviceText, 400)) gaps.push("Device is not stored.");
  if (!recipe.panelId) gaps.push("Scene is not stored.");
  if (!recipe.selectedColors.length) gaps.push("No colours selected.");
  return gaps;
}

export function requireRecipe(recipe: ApprovalRecipe, source: string | null | undefined): {
  artStyle: string;
  species: string;
  humourOperator: string;
  structure: ArtStyleDeviceStructure | "";
  darkness: number;
  behaviour: string;
} {
  const gaps = recipeGaps(recipe, source);
  if (gaps.length) throw new Error(gaps[0]);
  return {
    artStyle: recipe.artStyle,
    species: clip(recipe.species, 80),
    humourOperator: humourOperatorId(recipe.humourOperator) || "",
    structure: deviceStructureId(recipe.deviceStructure) || "",
    darkness: darknessLevel(recipe.darknessLevel) ?? 0,
    behaviour: clip(recipe.behaviour, 400),
  };
}
