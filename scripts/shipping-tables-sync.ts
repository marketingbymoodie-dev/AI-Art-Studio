/**
 * Manual Shipping Coverage sync + inspection (Phase 1 ops tool).
 *
 *   npx tsx scripts/shipping-tables-sync.ts                 # sync all in-use pairs
 *   npx tsx scripts/shipping-tables-sync.ts --verify framed # print a class's groups/rates/tiers
 *   npx tsx scripts/shipping-tables-sync.ts --sync --verify framed
 *   npx tsx scripts/shipping-tables-sync.ts --ingest 540:99 # ingest one (blueprint, provider) pair
 *
 * Requires .env: DATABASE_URL, PRINTIFY_API_TOKEN.
 * Runs the idempotent startup migrations first, so it is safe on a fresh DB.
 */
import "../server/load-env";
import { ilike } from "drizzle-orm";
import { eq } from "drizzle-orm";

async function main() {
  const args = process.argv.slice(2);
  const verifyIdx = args.indexOf("--verify");
  const verifyPattern = verifyIdx !== -1 ? args[verifyIdx + 1] : null;
  const ingestIdx = args.indexOf("--ingest");
  const ingestPair = ingestIdx !== -1 ? args[ingestIdx + 1] : null;
  const doSync = args.includes("--sync") || (verifyIdx === -1 && ingestIdx === -1);

  const { runStartupMigrations } = await import("../server/migrations/startup");
  await runStartupMigrations();

  const { db } = await import("../server/db");
  const { shippingClasses, shippingRates, variantShipping } = await import("../shared/schema");
  const { runShippingTablesSync, ingestShippingClass } = await import("../server/shipping-tables");

  if (ingestPair) {
    const [bpRaw, providerRaw] = ingestPair.split(":");
    const blueprintId = parseInt(bpRaw, 10);
    const providerId = parseInt(providerRaw, 10);
    if (!Number.isFinite(blueprintId) || !Number.isFinite(providerId)) {
      console.error("--ingest expects blueprintId:providerId, e.g. 540:99");
      process.exit(1);
    }
    console.log(`\n=== Ingesting bp ${blueprintId} / provider ${providerId} ===`);
    const result = await ingestShippingClass({ blueprintId, providerId, force: true });
    console.log(`  → ${result.status}${result.error ? ` (${result.error})` : ""} classId=${result.classId ?? "?"}`);
  }

  if (doSync) {
    console.log("\n=== Running shipping tables sync (force) ===");
    const summary = await runShippingTablesSync({ source: "manual", force: true });
    console.log(
      `sync: ok=${summary.ok} checked=${summary.checked} changed=${summary.changed} failed=${summary.failed}`,
    );
    for (const r of summary.results || []) {
      console.log(
        `  bp=${r.blueprintId} provider=${r.providerId} → ${r.status}${r.error ? ` (${r.error})` : ""}`,
      );
    }
  }

  if (verifyPattern) {
    console.log(`\n=== Classes matching "${verifyPattern}" ===`);
    const classes = await db
      .select()
      .from(shippingClasses)
      .where(ilike(shippingClasses.name, `%${verifyPattern}%`));
    if (classes.length === 0) {
      console.log("No matching shipping classes.");
    }
    for (const cls of classes) {
      console.log(`\n#${cls.id} ${cls.name} (bp ${cls.blueprintId} / provider ${cls.providerId})`);
      console.log(`  method=${cls.shippingMethod} hash=${(cls.tableHash || "").slice(0, 12)}…`);
      const groups = JSON.parse(cls.variantGroupsJson || "[]") as Array<{
        group: string;
        label: string;
        printifyVariantIds: string[];
      }>;
      console.log(`  variant groups: ${groups.length}`);
      for (const g of groups) {
        console.log(`    ${g.group}: ${g.label} [${g.printifyVariantIds.length} variants]`);
      }
      const rates = await db
        .select()
        .from(shippingRates)
        .where(eq(shippingRates.shippingClassId, cls.id));
      const focus = ["US", "CA", "AU", "GB", "ROW"];
      for (const country of focus) {
        const rows = rates
          .filter((r) => r.countryCode === country)
          .sort((a, b) => (a.variantGroup < b.variantGroup ? -1 : 1));
        if (rows.length === 0) continue;
        const cells = rows
          .map(
            (r) =>
              `${r.variantGroup}=$${(r.firstItemCents / 100).toFixed(2)}/$${(
                r.additionalCents / 100
              ).toFixed(2)} ${r.tier}${r.ratioBp != null ? ` (${(r.ratioBp / 100).toFixed(0)}%)` : ""}`,
          )
          .join("  ");
        console.log(`  ${country}: ${cells}`);
      }
      const zoneCount = new Set(rates.map((r) => r.countryCode)).size;
      const excluded = Array.from(
        new Set(rates.filter((r) => r.tier === "excluded").map((r) => r.countryCode)),
      ).sort();
      const warned = Array.from(
        new Set(rates.filter((r) => r.tier === "warned").map((r) => r.countryCode)),
      ).sort();
      console.log(`  zones=${zoneCount} warned=[${warned.join(",")}] excluded=[${excluded.join(",")}]`);
      const variants = await db
        .select()
        .from(variantShipping)
        .where(eq(variantShipping.shippingClassId, cls.id));
      console.log(
        `  variant_shipping rows=${variants.length} products=${new Set(variants.map((v) => v.productTypeId)).size}`,
      );
    }
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
