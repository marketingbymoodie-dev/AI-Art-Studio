/**
 * Map variant_shipping rows for one product type from the stored shipping class.
 * Does not refetch Printify. Confirms the generate gate for L / charcoal / JP.
 *
 * Usage: npx tsx scripts/map-variant-shipping.ts 54
 */
import { eq } from "drizzle-orm";
import { shippingRates, variantShipping, productTypes } from "@shared/schema";
import { db, pool } from "../server/db";
import { mapVariantShippingForProductTypes } from "../server/shipping-tables";
import { lookupSizeCountryCoverage } from "../server/shipping-size-coverage";

const productTypeId = Number(process.argv[2] || "54");

async function main() {
  const host = new URL(process.env.DATABASE_URL || "postgres://localhost").hostname;
  console.log(`[map-variant-shipping] database host ${host}`);

  const [pt] = await db
    .select({
      id: productTypes.id,
      name: productTypes.name,
      blueprintId: productTypes.printifyBlueprintId,
      providerId: productTypes.printifyProviderId,
    })
    .from(productTypes)
    .where(eq(productTypes.id, productTypeId));
  if (!pt) {
    console.error(`[map-variant-shipping] product type ${productTypeId} not found — wrong database`);
    process.exitCode = 2;
    return;
  }
  console.log(
    `[map-variant-shipping] type ${pt.id} ${pt.name} bp ${pt.blueprintId} provider ${pt.providerId}`,
  );
  if (pt.blueprintId !== 145 || pt.providerId !== 99) {
    console.error(
      `[map-variant-shipping] refusing: expected blueprint 145 provider 99, got ${pt.blueprintId}/${pt.providerId}`,
    );
    process.exitCode = 2;
    return;
  }

  const mapped = await mapVariantShippingForProductTypes([productTypeId]);
  const mappings = await db
    .select({ id: variantShipping.id, shippingClassId: variantShipping.shippingClassId })
    .from(variantShipping)
    .where(eq(variantShipping.productTypeId, productTypeId));
  const classId = mappings[0]?.shippingClassId ?? mapped[0]?.shippingClassId ?? null;
  const rates = classId
    ? await db
        .select({ id: shippingRates.id, countryCode: shippingRates.countryCode })
        .from(shippingRates)
        .where(eq(shippingRates.shippingClassId, classId))
    : [];
  const zones = [...new Set(rates.map((r) => r.countryCode))].sort();
  const verdict = await lookupSizeCountryCoverage({
    productTypeId,
    size: "l",
    color: "charcoal",
    country: "JP",
  });
  console.log(
    JSON.stringify(
      {
        mapResult: mapped,
        mappingCount: mappings.length,
        rateCount: rates.length,
        zones,
        allowed: verdict.allowed,
        matchedZone: verdict.matchedZone,
        variantGroup: verdict.variantGroup,
        reason: verdict.reason,
        tier: verdict.tier,
        country: verdict.country,
        sizeId: verdict.sizeId,
        colorId: verdict.colorId,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((e) => {
    console.error("[map-variant-shipping] failed:", e?.message || e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
    process.exit(process.exitCode ?? 0);
  });
