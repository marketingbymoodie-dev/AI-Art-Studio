/**
 * Seed the Petposterous style pack + experience profile and assign them to ONE
 * store explicitly. Idempotent; dry run unless --apply.
 *
 *   npx tsx scripts/seed-petposterous.ts --shop ai-art-studio-staging.myshopify.com
 *   npx tsx scripts/seed-petposterous.ts --shop … --clone men-s-lightweight-fashion-tee:petposterous-tee
 *   npx tsx scripts/seed-petposterous.ts --shop … --pages petposterous-tee,petposterous-pillow --apply
 *
 * --clone src:dst  creates a new customizer page `dst` (Shopify page + DB row)
 *                  copying `src`'s product binding, with NO style config of its
 *                  own (so other pages' style resolution is unaffected) and the
 *                  profile assigned. Existing pages are never modified except
 *                  those named in --pages / created by --clone.
 */
import "../server/load-env";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../server/db";
import { storage } from "../server/storage";
import { shopifyApiCall } from "../server/shopify";
import {
  experienceProfileMerchants,
  experienceProfiles,
  stylePackItems,
  stylePackMerchants,
  stylePacks,
} from "@shared/schema";
import { PACK_STYLE_CATALOG } from "@shared/packStyleCatalog";
import {
  PETPOSTEROUS_EXPERIENCE_CONFIG,
  PETPOSTEROUS_PACK_SLUG,
  PETPOSTEROUS_PROFILE_KEY,
} from "@shared/packs/petposterous";
import { provisionPackStylesForMerchant } from "../server/style-packs";

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] ?? null : null;
}
const apply = process.argv.includes("--apply");
const log = (...a: unknown[]) => console.log(apply ? "" : "[dry-run]", ...a);

async function main() {
  const shop = arg("shop");
  if (!shop) throw new Error("--shop is required (explicit assignment only)");
  const installation = await storage.getShopifyInstallationByShop(shop);
  if (!installation?.merchantId) throw new Error(`No installation/merchant for ${shop}`);
  const merchantId = installation.merchantId;
  log(`shop ${shop} → merchant ${merchantId}`);

  // 1. Platform pack + items
  let [pack] = await db
    .select()
    .from(stylePacks)
    .where(and(eq(stylePacks.slug, PETPOSTEROUS_PACK_SLUG), isNull(stylePacks.merchantId)))
    .limit(1);
  if (!pack) {
    log(`create platform pack ${PETPOSTEROUS_PACK_SLUG}`);
    if (apply) {
      [pack] = await db
        .insert(stylePacks)
        .values({ slug: PETPOSTEROUS_PACK_SLUG, name: "Petposterous V1", promptProfileKey: PETPOSTEROUS_PROFILE_KEY })
        .returning();
    }
  } else {
    log(`pack exists ${pack.id}`);
  }
  const defs = PACK_STYLE_CATALOG[PETPOSTEROUS_PACK_SLUG];
  if (pack) {
    const items = await db.select().from(stylePackItems).where(eq(stylePackItems.packId, pack.id));
    const have = new Set(items.map((i) => i.catalogSlug));
    const missing = defs.filter((d) => !have.has(d.id));
    log(`pack items: ${items.length} present, ${missing.length} to add`);
    if (apply && missing.length) {
      await db.insert(stylePackItems).values(
        missing.map((d) => ({ packId: pack!.id, catalogSlug: d.id, sortOrder: defs.indexOf(d) })),
      );
    }
  }

  // 2. Assign pack to this merchant only; provision its pack-only style rows
  if (pack) {
    const [assigned] = await db
      .select()
      .from(stylePackMerchants)
      .where(and(eq(stylePackMerchants.packId, pack.id), eq(stylePackMerchants.merchantId, merchantId)))
      .limit(1);
    log(assigned ? "pack already assigned" : "assign pack to merchant");
    if (apply && !assigned) await db.insert(stylePackMerchants).values({ packId: pack.id, merchantId });
  }
  const prov = await provisionPackStylesForMerchant(PETPOSTEROUS_PACK_SLUG, merchantId, { dryRun: !apply });
  log(`styles: insert ${prov.inserted.length} [${prov.inserted.join(", ")}], refresh ${prov.updated.length}`);

  // 3. Platform experience profile, assigned to this merchant
  let [profile] = await db
    .select()
    .from(experienceProfiles)
    .where(and(eq(experienceProfiles.slug, PETPOSTEROUS_PROFILE_KEY), isNull(experienceProfiles.merchantId)))
    .limit(1);
  if (!profile) {
    log(`create experience profile ${PETPOSTEROUS_PROFILE_KEY}`);
    if (apply) {
      [profile] = await db
        .insert(experienceProfiles)
        .values({
          slug: PETPOSTEROUS_PROFILE_KEY,
          name: "Petposterous",
          stylePackId: pack?.id ?? null,
          config: PETPOSTEROUS_EXPERIENCE_CONFIG,
        })
        .returning();
    }
  } else {
    log(`profile exists ${profile.id} — refreshing config + pack link`);
    if (apply) {
      await db
        .update(experienceProfiles)
        .set({ config: PETPOSTEROUS_EXPERIENCE_CONFIG, stylePackId: pack?.id ?? null, updatedAt: new Date() })
        .where(eq(experienceProfiles.id, profile.id));
    }
  }
  if (profile) {
    const [assigned] = await db
      .select()
      .from(experienceProfileMerchants)
      .where(and(eq(experienceProfileMerchants.profileId, profile.id), eq(experienceProfileMerchants.merchantId, merchantId)))
      .limit(1);
    log(assigned ? "profile already assigned" : "assign profile to merchant");
    if (apply && !assigned) await db.insert(experienceProfileMerchants).values({ profileId: profile.id, merchantId });
  }

  // 4. Pages: clone new ones, then assign the profile to the named pages only
  const targets = new Set((arg("pages") || "").split(",").map((s) => s.trim()).filter(Boolean));
  for (const pair of (arg("clone") || "").split(",").map((s) => s.trim()).filter(Boolean)) {
    const [src, dst] = pair.split(":");
    targets.add(dst);
    if (await storage.getCustomizerPageByHandle(shop, dst)) {
      log(`page ${dst} exists — not cloning`);
      continue;
    }
    const source = await storage.getCustomizerPageByHandle(shop, src);
    if (!source) throw new Error(`clone source ${src} not found`);
    log(`clone ${src} → ${dst} (Shopify page + DB row, no style config)`);
    if (!apply) continue;
    const srcPage = await shopifyApiCall(shop, installation.accessToken!, `pages/${source.shopifyPageId}.json`);
    const bodyHtml = srcPage.data?.page?.body_html;
    if (!srcPage.ok || !bodyHtml) throw new Error(`could not read Shopify page for ${src}: ${srcPage.error}`);
    const title = `Petposterous — ${source.title}`;
    const created = await shopifyApiCall(shop, installation.accessToken!, "pages.json", {
      method: "POST",
      body: JSON.stringify({ page: { title, handle: dst, body_html: bodyHtml, published: true } }),
    });
    if (!created.ok || !created.data?.page?.id) throw new Error(`Shopify page create failed: ${created.error}`);
    await storage.createCustomizerPage({
      shop: source.shop,
      shopifyPageId: String(created.data.page.id),
      handle: dst,
      title,
      baseVariantId: source.baseVariantId,
      baseProductId: source.baseProductId,
      baseProductHandle: source.baseProductHandle,
      baseProductTitle: source.baseProductTitle,
      baseVariantTitle: source.baseVariantTitle,
      baseProductPrice: source.baseProductPrice,
      productTypeId: source.productTypeId,
      status: "active",
    } as any);
  }
  for (const handle of targets) {
    const page = await storage.getCustomizerPageByHandle(shop, handle);
    if (!page) {
      log(`page ${handle} not found${apply ? "" : " (created by --clone on --apply)"}`);
      continue;
    }
    log(`assign profile → page ${handle}`);
    if (apply && profile) await storage.updateCustomizerPage(page.id, { experienceProfileId: profile.id } as any);
  }
  console.log(apply ? "Applied." : "\nDRY RUN — nothing written.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("FAILED:", e?.message || e);
    process.exit(1);
  });
