/**
 * Read a pose note and pet mask for each My Pet design.
 * Dry-run is the default: it calls vision and prints the notes, and it does not write.
 * Pass --write to store them. A design that already has a note is left as it is.
 *
 *   npx tsx scripts/backfill-my-pet-pose-notes.ts
 *   npx tsx scripts/backfill-my-pet-pose-notes.ts --write
 */
import { and, eq, inArray, isNotNull, isNull, ne, or } from "drizzle-orm";
import { designCandidates } from "@shared/schema";
import { db, pool } from "../server/db";
import { ensureMyPetPose } from "../server/my-pet-quality";

async function main() {
  const write = process.argv.includes("--write");
  const rows = await db
    .select({
      id: designCandidates.id,
      poseNote: designCandidates.poseNote,
    })
    .from(designCandidates)
    .where(and(
      isNotNull(designCandidates.artworkPath),
      ne(designCandidates.status, "dropped"),
      or(eq(designCandidates.publishMyPetEnabled, true), isNull(designCandidates.publishMyPetEnabled)),
      inArray(designCandidates.shopDomain, [
        "h7epay-gh.myshopify.com",
        "petstage.myshopify.com",
      ]),
    ));
  let overlap = 0;
  let read = 0;
  let cost = 0;
  let ms = 0;
  for (const row of rows) {
    if (String(row.poseNote || "").trim()) {
      console.log(`skip ${row.id.slice(0, 8)} already has a pose note`);
      continue;
    }
    try {
      const pose = await ensureMyPetPose(row.id, { write });
      read += 1;
      cost += pose.costUsd;
      ms += pose.durationMs;
      if (pose.letteringOverlapsPet) overlap += 1;
      console.log(
        `${write ? "wrote" : "dry-run"} ${row.id.slice(0, 8)} ${pose.title} overlap=${pose.letteringOverlapsPet} ` +
          `ms=${pose.durationMs} usd=${pose.costUsd.toFixed(4)} note=${JSON.stringify(pose.poseNote)}`,
      );
    } catch (err) {
      console.log(`failed ${row.id.slice(0, 8)} ${(err as Error).message}`);
    }
  }
  console.log(`designs=${rows.length} read=${read} letteringOverlapsPet=${overlap} ms=${ms} usd=${cost.toFixed(4)} write=${write}`);
}

main()
  .catch((err) => {
    console.error((err as Error).message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end().catch(() => undefined);
    process.exit(process.exitCode || 0);
  });
