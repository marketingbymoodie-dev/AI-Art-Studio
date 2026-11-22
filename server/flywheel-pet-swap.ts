/**
 * Customer pet swap from a stored design.
 * The probe simulation calls this, then the same art-style render the creation
 * screen uses. The storefront My Pet button becomes a second caller of that
 * render. It does not grow a compose path of its own.
 */
export type StoredPetSwapRecipe = {
  artStyle: string;
  funnyTruth: string;
  punchline: string;
  deviceText: string;
  deviceStructure: string;
  humourOperator: string;
  darknessLevel: number;
  species: string;
  behaviour: string;
  productFamily: string;
  shopDomain: string;
};

export function petSwapRenderInput(recipe: StoredPetSwapRecipe, referencePhotoId: string, batchId: string): Record<string, unknown> {
  return {
    batchId,
    variant: 1,
    artStyle: recipe.artStyle,
    mode: "full",
    funnyTruth: recipe.funnyTruth,
    punchline: recipe.punchline,
    device: recipe.deviceText,
    deviceStructure: recipe.deviceStructure,
    humourOperator: recipe.humourOperator,
    darknessLevel: recipe.darknessLevel,
    species: recipe.species,
    behaviour: recipe.behaviour,
    productFamily: recipe.productFamily,
    referencePhotoId,
    shopDomain: recipe.shopDomain,
    petSwap: true,
  };
}
