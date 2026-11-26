/**
 * Staging-only: find credit_balances rows where credits > earned+pack
 * and classify the orphan from credit_ledger (never guess).
 *
 *   npx tsx scripts/classify-credit-orphans.ts           # report only
 *   npx tsx scripts/classify-credit-orphans.ts --apply   # move PACK-classified orphans only
 *
 * Do NOT point DATABASE_URL at production.
 */
import "../server/load-env";
import { sql } from "drizzle-orm";
import { db } from "../server/db";

const APPLY = process.argv.includes("--apply");

const PACK_REASONS = new Set([
  "coupon",
  "merchant_pack",
  "creator_pack",
  "generation_refund",
]);
const PACK_REASON_PREFIXES = ["merchant_pack:", "creator_pack:", "reward:email_signup"];

const EARNED_REASON_PREFIXES = [
  "reward:share_design",
  "reward:purchase_threshold",
  "creator_reward",
  "reward:",
];

function classifyReason(reason: string, source: string | null): "pack" | "earned" | "unknown" {
  if (source === "pack") return "pack";
  if (source === "earned") return "earned";
  const r = String(reason || "");
  if (PACK_REASONS.has(r) || PACK_REASON_PREFIXES.some((p) => r.startsWith(p))) return "pack";
  // email_signup is platform-funded pack — already covered by prefix above.
  // Other reward:* are shop-local earned (except email_signup).
  if (r.startsWith("reward:email_signup")) return "pack";
  if (EARNED_REASON_PREFIXES.some((p) => r.startsWith(p))) return "earned";
  return "unknown";
}

async function main() {
  const orphans = ((await db.execute(sql`
    select customer_id, credits, earned_credits, pack_credits,
           credits - earned_credits - pack_credits as orphan
    from credit_balances
    where credits > earned_credits + pack_credits
    order by orphan desc
  `)) as any).rows ?? [];

  console.log(`orphan rows: ${orphans.length}`);
  if (!orphans.length) return;

  const report: Array<{
    customerId: string;
    credits: number;
    earned: number;
    pack: number;
    orphan: number;
    classification: "pack" | "earned" | "mixed" | "unknown";
    unsourced: Array<{ reason: string; source: string | null; delta: number }>;
  }> = [];

  for (const row of orphans) {
    const customerId = String(row.customer_id);
    const ledger = ((await db.execute(sql`
      select reason, source, delta_credits
      from credit_ledger
      where customer_id = ${customerId} and delta_credits > 0
      order by created_at
    `)) as any).rows ?? [];

    const unsourced = ledger
      .filter((l: any) => !l.source)
      .map((l: any) => ({
        reason: String(l.reason),
        source: l.source,
        delta: Number(l.delta_credits),
      }));

    const classes = new Set<"pack" | "earned" | "unknown">();
    for (const l of ledger) {
      classes.add(classifyReason(String(l.reason), l.source));
    }
    // Classification of the ORPHAN itself comes from unsourced positive grants only.
    const orphanClasses = new Set(unsourced.map((u) => classifyReason(u.reason, u.source)));
    let classification: "pack" | "earned" | "mixed" | "unknown" = "unknown";
    if (orphanClasses.size === 1 && orphanClasses.has("pack")) classification = "pack";
    else if (orphanClasses.size === 1 && orphanClasses.has("earned")) classification = "earned";
    else if (orphanClasses.size > 1) classification = "mixed";
    else if (unsourced.length === 0) classification = "unknown";

    report.push({
      customerId,
      credits: Number(row.credits),
      earned: Number(row.earned_credits),
      pack: Number(row.pack_credits),
      orphan: Number(row.orphan),
      classification,
      unsourced,
    });
  }

  const byClass: Record<string, number> = {};
  for (const r of report) byClass[r.classification] = (byClass[r.classification] || 0) + 1;
  console.log("classification counts:", byClass);
  for (const r of report) {
    console.log(
      `${r.classification.padEnd(8)} ${r.customerId}  total=${r.credits} earned=${r.earned} pack=${r.pack} orphan=${r.orphan}  unsourced=${JSON.stringify(r.unsourced)}`,
    );
  }

  if (!APPLY) {
    console.log("\nDry run only. Re-run with --apply to move PACK-classified orphans into pack_credits.");
    return;
  }

  const packRows = report.filter((r) => r.classification === "pack");
  const skipped = report.filter((r) => r.classification !== "pack");
  console.log(`\nApplying pack backfill to ${packRows.length} row(s); skipping ${skipped.length} (mixed/unknown/earned).`);
  for (const r of packRows) {
    await db.execute(sql`
      update credit_balances
         set pack_credits = pack_credits + ${r.orphan},
             version = version + 1,
             updated_at = now()
       where customer_id = ${r.customerId}
         and credits - earned_credits - pack_credits = ${r.orphan}
    `);
    console.log(`  moved ${r.orphan} → packCredits for ${r.customerId}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("FAILED:", e?.message || e);
    process.exit(1);
  });
