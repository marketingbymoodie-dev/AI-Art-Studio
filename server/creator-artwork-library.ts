import { and, desc, eq, inArray, or } from "drizzle-orm";
import { db } from "./db";
import { generationJobs } from "@shared/schema";
import {
  CREATOR_ARTWORK_LIMIT,
  dedupeCreatorArtworksByUrl,
  pickOldestCreatorArtworkJobIdsToEvict,
} from "@shared/creatorArtworkLibrary";

export type CreatorArtworkIdentity = {
  creatorId: string;
  sessionId?: string | null;
  customerId?: string | null;
};

export type CreatorArtworkListItem = {
  jobId: string;
  artworkUrl: string;
  prompt: string;
  productTypeId: string | null;
  createdAt: Date | null;
};

function identityClause(identity: CreatorArtworkIdentity) {
  const sessionId = String(identity.sessionId || "").trim();
  const customerId = String(identity.customerId || "").trim();
  if (sessionId && customerId) {
    return or(
      eq(generationJobs.creatorSessionId, sessionId),
      eq(generationJobs.customerId, customerId),
    );
  }
  if (sessionId) return eq(generationJobs.creatorSessionId, sessionId);
  if (customerId) return eq(generationJobs.customerId, customerId);
  return null;
}

function visitorOwnsJob(
  job: { creatorSessionId?: string | null; customerId?: string | null },
  identity: CreatorArtworkIdentity,
): boolean {
  const sessionId = String(identity.sessionId || "").trim();
  const customerId = String(identity.customerId || "").trim();
  if (sessionId && job.creatorSessionId === sessionId) return true;
  if (customerId && job.customerId === customerId) return true;
  return false;
}

export async function listCreatorArtworks(
  identity: CreatorArtworkIdentity,
  limit = CREATOR_ARTWORK_LIMIT,
): Promise<CreatorArtworkListItem[]> {
  const clause = identityClause(identity);
  if (!clause) return [];
  const fetchLimit = Math.min(Math.max(limit * 3, limit), 200);
  const rows = await db
    .select({
      jobId: generationJobs.id,
      artworkUrl: generationJobs.designImageUrl,
      prompt: generationJobs.userPrompt,
      fallbackPrompt: generationJobs.prompt,
      productTypeId: generationJobs.productTypeId,
      createdAt: generationJobs.createdAt,
    })
    .from(generationJobs)
    .where(
      and(
        eq(generationJobs.creatorId, identity.creatorId),
        eq(generationJobs.status, "complete"),
        clause,
      ),
    )
    .orderBy(desc(generationJobs.createdAt))
    .limit(fetchLimit);

  return dedupeCreatorArtworksByUrl(
    rows.map((row) => ({
      jobId: row.jobId,
      artworkUrl: String(row.artworkUrl || "").trim(),
      prompt: String(row.prompt || row.fallbackPrompt || "").trim(),
      productTypeId: row.productTypeId,
      createdAt: row.createdAt,
    })),
    limit,
  );
}

export async function unlinkCreatorArtwork(
  identity: CreatorArtworkIdentity,
  jobId: string,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const id = String(jobId || "").trim();
  if (!id) return { ok: false, status: 400, error: "Design ID required." };
  const [job] = await db
    .select({
      id: generationJobs.id,
      creatorId: generationJobs.creatorId,
      creatorSessionId: generationJobs.creatorSessionId,
      customerId: generationJobs.customerId,
    })
    .from(generationJobs)
    .where(eq(generationJobs.id, id))
    .limit(1);
  if (!job || job.creatorId !== identity.creatorId) {
    return { ok: false, status: 404, error: "Design not found." };
  }
  if (!visitorOwnsJob(job, identity)) {
    return { ok: false, status: 403, error: "Not authorized to delete this design." };
  }
  await db
    .update(generationJobs)
    .set({
      customerId: null,
      creatorSessionId: null,
      updatedAt: new Date(),
    })
    .where(eq(generationJobs.id, id));
  return { ok: true };
}

/** Unlink oldest unique artworks when the visitor is over `limit`. */
export async function evictOldestCreatorArtworksIfNeeded(
  identity: CreatorArtworkIdentity,
  limit = CREATOR_ARTWORK_LIMIT,
): Promise<number> {
  const clause = identityClause(identity);
  if (!clause) return 0;
  const rows = await db
    .select({
      jobId: generationJobs.id,
      artworkUrl: generationJobs.designImageUrl,
    })
    .from(generationJobs)
    .where(
      and(
        eq(generationJobs.creatorId, identity.creatorId),
        eq(generationJobs.status, "complete"),
        clause,
      ),
    )
    .orderBy(desc(generationJobs.createdAt))
    .limit(200);

  const evictIds = pickOldestCreatorArtworkJobIdsToEvict(
    rows.map((row) => ({
      jobId: row.jobId,
      artworkUrl: String(row.artworkUrl || "").trim(),
    })),
    limit,
  );
  if (evictIds.length === 0) return 0;

  await db
    .update(generationJobs)
    .set({
      customerId: null,
      creatorSessionId: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(generationJobs.creatorId, identity.creatorId),
        inArray(generationJobs.id, evictIds),
      ),
    );
  return evictIds.length;
}

export { CREATOR_ARTWORK_LIMIT };
