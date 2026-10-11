/**
 * Insert-only store for flywheel design candidates.
 * Dropped rows stay. There is no delete function.
 */
import { designCandidates } from "@shared/schema";
import type { AdminCandidateDraft } from "@shared/flywheelRecipe";
import { db } from "./db";

export async function insertAdminDesignCandidate(draft: AdminCandidateDraft): Promise<string> {
  const [row] = await db.insert(designCandidates).values({
    shopDomain: draft.shopDomain,
    humourOperator: draft.humourOperator,
    darknessLevel: draft.darknessLevel,
    species: draft.species,
    deviceStructure: draft.deviceStructure,
    deviceText: draft.deviceText,
    funnyTruth: draft.funnyTruth,
    punchline: draft.punchline,
    artStyle: draft.artStyle,
    behaviour: draft.behaviour,
    productFamily: draft.productFamily,
    credentialRef: draft.credentialRef,
    renderProbeResultId: draft.renderProbeResultId,
  }).returning({ id: designCandidates.id });
  if (!row?.id) throw new Error("design candidate insert returned no id");
  return row.id;
}
