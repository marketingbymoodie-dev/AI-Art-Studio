/**
 * Insert-only store for flywheel design candidates.
 * Dropped rows stay. There is no delete function.
 */
import { and, desc, eq } from "drizzle-orm";
import { designCandidates } from "@shared/schema";
import type { AdminCandidateDraft } from "@shared/flywheelRecipe";
import { db } from "./db";

export async function insertAdminDesignCandidate(draft: AdminCandidateDraft): Promise<string> {
  if (draft.status === "approved" && !draft.printFilePath) {
    throw new Error(`${draft.artStyle} has no print path`);
  }
  const [row] = await db.insert(designCandidates).values({
    shopDomain: draft.shopDomain,
    status: draft.status,
    source: draft.conceptSource,
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
    printFilePath: draft.printFilePath ?? null,
  }).returning({ id: designCandidates.id });
  if (!row?.id) throw new Error("design candidate insert returned no id");
  return row.id;
}

export async function listDesignCandidates(shopDomain: string) {
  return db.select({
    id: designCandidates.id,
    status: designCandidates.status,
    source: designCandidates.source,
    artStyle: designCandidates.artStyle,
    funnyTruth: designCandidates.funnyTruth,
    punchline: designCandidates.punchline,
    deviceText: designCandidates.deviceText,
    species: designCandidates.species,
    behaviour: designCandidates.behaviour,
    productFamily: designCandidates.productFamily,
    createdAt: designCandidates.createdAt,
  }).from(designCandidates)
    .where(eq(designCandidates.shopDomain, shopDomain))
    .orderBy(desc(designCandidates.createdAt))
    .limit(40);
}

export async function getDesignCandidate(shopDomain: string, id: string) {
  const [row] = await db.select().from(designCandidates)
    .where(and(eq(designCandidates.shopDomain, shopDomain), eq(designCandidates.id, id)))
    .limit(1);
  return row ?? null;
}
