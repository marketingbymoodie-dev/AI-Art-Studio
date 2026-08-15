/**
 * Creator platform style assignment — curated per creator.
 * Merchant /api/admin/styles create path is untouched.
 */
import { and, eq, inArray, or } from "drizzle-orm";
import {
  CREATOR_ASSIGNABLE_STYLE_SCOPES,
  PLATFORM_CONFIG_KEYS,
  computeStyleVisibility,
  isAssignableCreatorScope,
} from "@shared/creatorMarketplace";
import {
  creatorStyleAssignments,
  creators,
  customizerPages,
  merchants,
  platformConfig,
  productTypes,
  STYLE_PRESETS,
  stylePresets,
  type StylePresetDB,
} from "@shared/schema";
import { db } from "./db";
import { getCreatorPlatformShopDomain, setPlatformConfig } from "./creator-config";
import { normalizeMyshopifyShopDomain } from "./shopDomain";
import { storage } from "./storage";

export type CreatorStyleRow = {
  stylePresetId: number;
  name: string;
  category: string;
  creatorScope: string;
  promptPrefix: string;
  promptPrefixDark: string | null;
  baseImageUrl: string | null;
  promptPlaceholder: string | null;
  descriptionOptional: boolean;
  sortOrder: number;
  isActive: boolean;
  enabled: boolean;
  available: boolean;
  /** Operator offer AND catalog still active. */
  currentlyAvailable: boolean;
};

function toRow(style: StylePresetDB, asg: typeof creatorStyleAssignments.$inferSelect): CreatorStyleRow {
  const currentlyAvailable = computeStyleVisibility({
    enabled: !!asg.enabled,
    available: !!asg.available,
    isActive: !!style.isActive,
  }).currentlyAvailable;
  return {
    stylePresetId: style.id,
    name: style.name,
    category: style.category || "all",
    creatorScope: (style as any).creatorScope || "merchant",
    promptPrefix: style.promptPrefix,
    promptPrefixDark: style.promptPrefixDark ?? null,
    baseImageUrl: style.baseImageUrl ?? null,
    promptPlaceholder: style.promptPlaceholder ?? null,
    descriptionOptional: !!style.descriptionOptional,
    sortOrder: style.sortOrder ?? 0,
    isActive: !!style.isActive,
    enabled: !!asg.enabled,
    available: !!asg.available,
    currentlyAvailable,
  };
}

export { computeStyleVisibility, isAssignableCreatorScope };

export function getNormalizedPlatformShop(): string | null {
  const shop = normalizeMyshopifyShopDomain(getCreatorPlatformShopDomain());
  return shop || null;
}

function shopLookupVariants(shop: string): string[] {
  return [shop, shop.replace(/\.myshopify\.com$/, "")].filter(
    (s, i, arr) => !!s && arr.indexOf(s) === i,
  );
}

function addMerchantId(ids: string[], id?: string | null) {
  const v = String(id || "").trim();
  if (v && !ids.includes(v)) ids.push(v);
}

/** Every merchant id that might own platform-shop styles (user row vs install row). */
export async function resolvePlatformStyleMerchantIds(
  fallbackMerchantId?: string | null,
  extraMerchantIds?: string[] | null,
): Promise<string[]> {
  const ids: string[] = [];
  const shop = getNormalizedPlatformShop();
  const variants = shop ? shopLookupVariants(shop) : [];

  for (const candidate of variants) {
    const byUser = await storage.getMerchantByShop(candidate);
    addMerchantId(ids, byUser?.id);
    addMerchantId(ids, byUser?.userId);
    const inst = await storage.getShopifyInstallationByShop(candidate);
    addMerchantId(ids, inst?.merchantId);
  }

  if (shop) {
    const handle = shop.replace(/\.myshopify\.com$/, "");
    const shopMerchants = await db
      .select({ id: merchants.id })
      .from(merchants)
      .where(
        or(
          eq(merchants.userId, `shopify:merchant:${shop}`),
          eq(merchants.userId, `shopify:merchant:${handle}`),
        ),
      );
    for (const row of shopMerchants) addMerchantId(ids, row.id);
  }

  addMerchantId(ids, fallbackMerchantId);
  if (fallbackMerchantId) {
    const fallback = await storage.getMerchant(fallbackMerchantId);
    addMerchantId(ids, fallback?.userId);
  }
  for (const extra of extraMerchantIds || []) addMerchantId(ids, extra);

  if (variants.length > 0) {
    const [page] = await db
      .select({ productTypeId: customizerPages.productTypeId })
      .from(customizerPages)
      .where(inArray(customizerPages.shop, variants))
      .limit(1);
    if (page?.productTypeId) {
      const [pt] = await db
        .select({ merchantId: productTypes.merchantId })
        .from(productTypes)
        .where(eq(productTypes.id, page.productTypeId))
        .limit(1);
      addMerchantId(ids, pt?.merchantId);
    }
  }

  return ids;
}

export async function getPlatformMerchantId(): Promise<string | null> {
  const ids = await resolvePlatformStyleMerchantIds();
  if (ids.length === 0) return null;
  if (ids.length === 1) return ids[0];

  let best = ids[0];
  let bestCount = -1;
  for (const id of ids) {
    const rows = await db
      .select({ id: stylePresets.id })
      .from(stylePresets)
      .where(eq(stylePresets.merchantId, id));
    if (rows.length > bestCount) {
      best = id;
      bestCount = rows.length;
    }
  }
  return best;
}

/** Mark platform-shop catalog rows as global (eligible to assign). Idempotent. */
export async function ensurePlatformStylesMarkedGlobal(): Promise<number> {
  const merchantIds = await resolvePlatformStyleMerchantIds();
  if (merchantIds.length === 0) return 0;
  const result = await db
    .update(stylePresets)
    .set({ creatorScope: "global" })
    .where(
      and(
        inArray(stylePresets.merchantId, merchantIds),
        eq(stylePresets.creatorScope, "merchant"),
      ),
    );
  return (result as any)?.rowCount ?? 0;
}

/**
 * One-time: existing creators get today's platform globals so staging shops
 * are not blanked. New creators after this still start with zero rows.
 */
export async function backfillExistingCreatorGlobalAssignments(): Promise<number> {
  const [flag] = await db
    .select({ value: platformConfig.value })
    .from(platformConfig)
    .where(eq(platformConfig.key, PLATFORM_CONFIG_KEYS.CREATOR_STYLE_ASSIGNMENT_BACKFILL_AT))
    .limit(1);
  if (flag?.value) return 0;

  await ensurePlatformStylesMarkedGlobal();
  const merchantId = await getPlatformMerchantId();
  if (!merchantId) return 0;

  const globals = await db
    .select({ id: stylePresets.id })
    .from(stylePresets)
    .where(
      and(
        eq(stylePresets.merchantId, merchantId),
        eq(stylePresets.creatorScope, "global"),
        eq(stylePresets.isActive, true),
      ),
    );
  const creatorRows =
    globals.length === 0 ? [] : await db.select({ id: creators.id }).from(creators);

  const existing = await db
    .select({
      creatorId: creatorStyleAssignments.creatorId,
      stylePresetId: creatorStyleAssignments.stylePresetId,
    })
    .from(creatorStyleAssignments);
  const have = new Set(existing.map((e) => `${e.creatorId}:${e.stylePresetId}`));

  const toInsert: Array<{
    creatorId: string;
    stylePresetId: number;
    enabled: boolean;
    available: boolean;
  }> = [];
  for (const c of creatorRows) {
    const alreadyAny = existing.some((e) => e.creatorId === c.id);
    if (alreadyAny) continue; // curated already — do not flood
    for (const g of globals) {
      const key = `${c.id}:${g.id}`;
      if (have.has(key)) continue;
      toInsert.push({
        creatorId: c.id,
        stylePresetId: g.id,
        enabled: true,
        available: true,
      });
    }
  }
  if (toInsert.length > 0) {
    const CHUNK = 80;
    for (let i = 0; i < toInsert.length; i += CHUNK) {
      await db.insert(creatorStyleAssignments).values(toInsert.slice(i, i + CHUNK)).onConflictDoNothing();
    }
  }
  await setPlatformConfig(
    PLATFORM_CONFIG_KEYS.CREATOR_STYLE_ASSIGNMENT_BACKFILL_AT,
    new Date().toISOString(),
  );
  return toInsert.length;
}

export async function listAssignableCatalog(opts?: {
  fallbackMerchantId?: string | null;
  fallbackMerchantIds?: string[] | null;
}): Promise<StylePresetDB[]> {
  const merchantIds = await resolvePlatformStyleMerchantIds(
    opts?.fallbackMerchantId,
    opts?.fallbackMerchantIds,
  );
  if (merchantIds.length > 0) {
    await db
      .update(stylePresets)
      .set({ creatorScope: "global" })
      .where(
        and(
          inArray(stylePresets.merchantId, merchantIds),
          eq(stylePresets.creatorScope, "merchant"),
        ),
      );
    const rows = await db
      .select()
      .from(stylePresets)
      .where(inArray(stylePresets.merchantId, merchantIds))
      .orderBy(stylePresets.sortOrder, stylePresets.name);
    if (rows.length > 0) return rows;
    console.warn("[creator-styles] catalog empty for merchant ids", merchantIds);
  }

  await ensurePlatformStylesMarkedGlobal();
  const scoped = await db
    .select()
    .from(stylePresets)
    .where(inArray(stylePresets.creatorScope, [...CREATOR_ASSIGNABLE_STYLE_SCOPES]))
    .orderBy(stylePresets.sortOrder, stylePresets.name);
  if (scoped.length > 0) return scoped;

  // Operator must be able to assign whatever exists on Art Styles even if
  // merchant-id resolution still misses (Shopify user id vs merchants.id).
  const all = await db
    .select()
    .from(stylePresets)
    .orderBy(stylePresets.sortOrder, stylePresets.name);
  if (all.length > 0) {
    console.warn("[creator-styles] catalog fallback to all style_presets", all.length);
    return all;
  }

  const seeded = await seedPlatformDefaultStylesIfEmpty(opts);
  if (seeded.length > 0) {
    console.warn("[creator-styles] seeded default platform styles", seeded.length);
  }
  return seeded;
}

async function seedPlatformDefaultStylesIfEmpty(opts?: {
  fallbackMerchantId?: string | null;
  fallbackMerchantIds?: string[] | null;
}): Promise<StylePresetDB[]> {
  const merchantId =
    (await getPlatformMerchantId()) ||
    opts?.fallbackMerchantId ||
    opts?.fallbackMerchantIds?.[0] ||
    null;
  if (!merchantId) return [];

  const existing = await storage.getStylePresetsByMerchant(merchantId);
  if (existing.length > 0) return existing;

  const created: StylePresetDB[] = [];
  for (let i = 0; i < STYLE_PRESETS.length; i++) {
    const style = STYLE_PRESETS[i];
    if (style.id === "none") continue;
    const row = await storage.createStylePreset({
      merchantId,
      name: style.name,
      promptPrefix: style.promptPrefix || "",
      category: style.category || "all",
      isActive: true,
      sortOrder: i,
      creatorScope: "global",
      promptPlaceholder: (style as any).promptPlaceholder || null,
      descriptionOptional: !!(style as any).descriptionOptional,
      baseImageUrl: (style as any).baseImageUrl || null,
    } as any);
    created.push(row);
  }
  return created;
}

let backfillOnce: Promise<number> | null = null;

function runBackfillOnce() {
  if (!backfillOnce) {
    backfillOnce = backfillExistingCreatorGlobalAssignments().catch(() => 0);
  }
  return backfillOnce;
}

export async function listCreatorStyleAssignments(creatorId: string): Promise<CreatorStyleRow[]> {
  await runBackfillOnce();
  const rows = await db
    .select({
      assignment: creatorStyleAssignments,
      style: stylePresets,
    })
    .from(creatorStyleAssignments)
    .innerJoin(stylePresets, eq(creatorStyleAssignments.stylePresetId, stylePresets.id))
    .where(eq(creatorStyleAssignments.creatorId, creatorId));

  return rows
    .map((r) => toRow(r.style, r.assignment))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

/** Customer-facing: assigned + available + enabled + catalog active. */
export async function resolveCreatorStorefrontStyles(creatorId: string): Promise<CreatorStyleRow[]> {
  const all = await listCreatorStyleAssignments(creatorId);
  return all.filter((s) => s.currentlyAvailable && s.enabled);
}

export async function isStyleEntitledForGenerate(
  creatorId: string,
  stylePresetId: string | number,
): Promise<boolean> {
  const id = Number(stylePresetId);
  if (!Number.isFinite(id)) return false;
  const entitled = await resolveCreatorStorefrontStyles(creatorId);
  return entitled.some((s) => s.stylePresetId === id);
}

export async function assignStylesToCreator(params: {
  creatorId: string;
  stylePresetIds: number[];
  fallbackMerchantId?: string | null;
  fallbackMerchantIds?: string[] | null;
}): Promise<CreatorStyleRow[]> {
  const catalog = await listAssignableCatalog({
    fallbackMerchantId: params.fallbackMerchantId,
    fallbackMerchantIds: params.fallbackMerchantIds,
  });
  const allowed = new Set(catalog.map((s) => s.id));
  for (const id of params.stylePresetIds) {
    if (!allowed.has(id)) {
      throw new Error(`Style ${id} is not assignable on the creator platform`);
    }
    await db
      .insert(creatorStyleAssignments)
      .values({
        creatorId: params.creatorId,
        stylePresetId: id,
        enabled: true,
        available: true,
      })
      .onConflictDoUpdate({
        target: [creatorStyleAssignments.creatorId, creatorStyleAssignments.stylePresetId],
        set: { available: true, updatedAt: new Date() },
      });
  }
  return listCreatorStyleAssignments(params.creatorId);
}

/** Retire: keep row, set available=false. Does not change enabled. */
export async function retireCreatorStyles(params: {
  creatorId: string;
  stylePresetIds: number[];
}): Promise<CreatorStyleRow[]> {
  if (params.stylePresetIds.length === 0) {
    return listCreatorStyleAssignments(params.creatorId);
  }
  await db
    .update(creatorStyleAssignments)
    .set({ available: false, updatedAt: new Date() })
    .where(
      and(
        eq(creatorStyleAssignments.creatorId, params.creatorId),
        inArray(creatorStyleAssignments.stylePresetId, params.stylePresetIds),
      ),
    );
  return listCreatorStyleAssignments(params.creatorId);
}

export async function setCreatorStyleEnabled(params: {
  creatorId: string;
  stylePresetId: number;
  enabled: boolean;
}): Promise<CreatorStyleRow | null> {
  const [row] = await db
    .update(creatorStyleAssignments)
    .set({ enabled: params.enabled, updatedAt: new Date() })
    .where(
      and(
        eq(creatorStyleAssignments.creatorId, params.creatorId),
        eq(creatorStyleAssignments.stylePresetId, params.stylePresetId),
      ),
    )
    .returning();
  if (!row) return null;
  const list = await listCreatorStyleAssignments(params.creatorId);
  return list.find((s) => s.stylePresetId === params.stylePresetId) ?? null;
}

export async function duplicateStyleAndAssignExclusive(params: {
  sourceStylePresetId: number;
  creatorId: string;
  name?: string;
}): Promise<CreatorStyleRow> {
  const [source] = await db
    .select()
    .from(stylePresets)
    .where(eq(stylePresets.id, params.sourceStylePresetId))
    .limit(1);
  if (!source) throw new Error("Source style not found");
  if (!isAssignableCreatorScope((source as any).creatorScope) && source.creatorScope !== "merchant") {
    /* platform merchant rows may still be merchant until ensurePlatformStylesMarkedGlobal */
  }
  const merchantId = await getPlatformMerchantId();
  if (!merchantId) throw new Error("Platform shop merchant is not configured");

  const [clone] = await db
    .insert(stylePresets)
    .values({
      merchantId,
      name: params.name?.trim() || `${source.name} (custom)`,
      promptPrefix: source.promptPrefix,
      promptPrefixDark: source.promptPrefixDark,
      category: source.category,
      isActive: true,
      sortOrder: source.sortOrder,
      baseImageUrl: source.baseImageUrl,
      promptPlaceholder: source.promptPlaceholder,
      descriptionOptional: source.descriptionOptional,
      creatorScope: "custom",
    })
    .returning();

  await db.insert(creatorStyleAssignments).values({
    creatorId: params.creatorId,
    stylePresetId: clone.id,
    enabled: true,
    available: true,
  });

  const list = await listCreatorStyleAssignments(params.creatorId);
  const row = list.find((s) => s.stylePresetId === clone.id);
  if (!row) throw new Error("Clone assigned but not readable");
  return row;
}
