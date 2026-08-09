/**
 * Seed (or restore) demo-shop metering for upgrade-preview QA.
 *
 * Usage (staging DATABASE_PUBLIC_URL):
 *   $env:DATABASE_URL = "<staging DATABASE_PUBLIC_URL>"
 *   npx tsx scripts/seed-demo-quota-for-upgrade-qa.ts seed
 *   npx tsx scripts/seed-demo-quota-for-upgrade-qa.ts restore
 *
 * Optional:
 *   $env:QA_SHOP_DOMAIN = "your-demo.myshopify.com"  (default: OWNER_SHOP_DOMAIN)
 *   $env:QA_PLAN = "dabbler"
 *   $env:QA_USED = "800"
 */
import "../server/load-env";
import { eq } from "drizzle-orm";
import { db } from "../server/db";
import { shopifyInstallations } from "../shared/schema";
import { generationMonthKey } from "../server/customizer-plans";
import fs from "fs";
import path from "path";

const SNAPSHOT = path.resolve("tmp", "demo-quota-qa-snapshot.json");

type Snapshot = {
  id: number;
  shopDomain: string;
  planName: string | null;
  planStatus: string | null;
  monthlyGenerationsUsed: number;
  monthlyOverageUsed: number;
  generationMonth: string | null;
};

async function resolveShop() {
  const want = (
    process.env.QA_SHOP_DOMAIN ||
    process.env.OWNER_SHOP_DOMAIN ||
    ""
  )
    .toLowerCase()
    .trim()
    .replace(/^https?:\/\//, "");
  const rows = await db.select().from(shopifyInstallations);
  if (!rows.length) throw new Error("No shopify_installations rows");
  if (!want) {
    if (rows.length === 1) return rows[0]!;
    throw new Error(
      `Set QA_SHOP_DOMAIN or OWNER_SHOP_DOMAIN. Installs: ${rows.map((r) => r.shopDomain).join(", ")}`,
    );
  }
  const hit = rows.find(
    (r) => r.shopDomain.toLowerCase().replace(/^https?:\/\//, "") === want,
  );
  if (!hit) {
    throw new Error(
      `No install for ${want}. Found: ${rows.map((r) => r.shopDomain).join(", ")}`,
    );
  }
  return hit;
}

async function seed() {
  const row = await resolveShop();
  const snap: Snapshot = {
    id: row.id,
    shopDomain: row.shopDomain,
    planName: row.planName,
    planStatus: row.planStatus,
    monthlyGenerationsUsed: row.monthlyGenerationsUsed ?? 0,
    monthlyOverageUsed: row.monthlyOverageUsed ?? 0,
    generationMonth: row.generationMonth,
  };
  fs.mkdirSync(path.dirname(SNAPSHOT), { recursive: true });
  fs.writeFileSync(SNAPSHOT, JSON.stringify(snap, null, 2));

  const plan = (process.env.QA_PLAN || "dabbler").trim();
  const used = Math.max(0, parseInt(process.env.QA_USED || "800", 10) || 800);
  const month = generationMonthKey();

  await db
    .update(shopifyInstallations)
    .set({
      planName: plan,
      planStatus: "active",
      monthlyGenerationsUsed: used,
      monthlyOverageUsed: 0,
      generationMonth: month,
    })
    .where(eq(shopifyInstallations.id, row.id));

  console.log(
    `Seeded ${row.shopDomain}: plan=${plan} used=${used} overage=0 month=${month}`,
  );
  console.log(`Snapshot written to ${SNAPSHOT}`);
  console.log(
    "Also set Railway staging OWNER_BYPASS_QUOTA=false (keep OWNER_SHOP_DOMAIN).",
  );
}

async function restore() {
  if (!fs.existsSync(SNAPSHOT)) {
    throw new Error(`No snapshot at ${SNAPSHOT} — run seed first`);
  }
  const snap = JSON.parse(fs.readFileSync(SNAPSHOT, "utf8")) as Snapshot;
  await db
    .update(shopifyInstallations)
    .set({
      planName: snap.planName,
      planStatus: snap.planStatus,
      monthlyGenerationsUsed: snap.monthlyGenerationsUsed,
      monthlyOverageUsed: snap.monthlyOverageUsed,
      generationMonth: snap.generationMonth,
    })
    .where(eq(shopifyInstallations.id, snap.id));
  console.log(
    `Restored ${snap.shopDomain}: plan=${snap.planName} used=${snap.monthlyGenerationsUsed}`,
  );
  console.log("Unset Railway staging OWNER_BYPASS_QUOTA (or set true).");
}

const cmd = process.argv[2] || "seed";
if (cmd === "seed") await seed();
else if (cmd === "restore") await restore();
else throw new Error(`Unknown command ${cmd} (use seed|restore)`);
process.exit(0);
