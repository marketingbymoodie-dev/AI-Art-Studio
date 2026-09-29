/**
 * Style pack resolution + enforcement (see shared/stylePacks.ts).
 *
 * Every client receives a page's pack already resolved to
 * `{mode:"selected", presetIds}` for that merchant, so no client code needs to
 * understand packs. Generation re-checks on the server: a `pack_only` style is
 * usable only through an active pack assigned to its merchant.
 */
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { db } from "./db";
import { stylePackItems, stylePackMerchants, stylePacks, stylePresets, type StylePack } from "@shared/schema";
import { PACK_STYLE_CATALOG } from "@shared/packStyleCatalog";
import type { CustomizerPageStyleConfig } from "@shared/customizerPageStyles";
import {
  STYLE_VISIBILITY_PACK_ONLY,
  isPackOnlyStyle,
  packContainsStyle,
  resolvePackPresetIds,
  type StylePackItemRef,
} from "@shared/stylePacks";

export type LoadedStylePack = { pack: StylePack; items: StylePackItemRef[] };

/** An active pack the merchant may use: its own pack, or a platform pack assigned to it. */
export async function loadStylePackForMerchant(
  packId: string,
  merchantId: string | null | undefined,
): Promise<LoadedStylePack | null> {
  if (!packId || !merchantId) return null;
  const [pack] = await db.select().from(stylePacks).where(eq(stylePacks.id, packId)).limit(1);
  if (!pack || !pack.isActive) return null;
  if (pack.merchantId) {
    if (pack.merchantId !== merchantId) return null;
  } else {
    const [assigned] = await db
      .select({ id: stylePackMerchants.id })
      .from(stylePackMerchants)
      .where(and(eq(stylePackMerchants.packId, packId), eq(stylePackMerchants.merchantId, merchantId)))
      .limit(1);
    if (!assigned) return null;
  }
  const items = await db.select().from(stylePackItems).where(eq(stylePackItems.packId, packId));
  return { pack, items };
}

/**
 * Pages store `{mode:"pack"}`; everything downstream expects `category` or
 * `selected`. Unknown / unassigned / inactive packs resolve to an empty
 * selection (fail closed) rather than falling back to every style.
 */
export async function resolvePageStyleConfig(
  config: CustomizerPageStyleConfig,
  merchantId: string | null | undefined,
  presets: Array<{ id: string | number; catalogSlug?: string | null }>,
): Promise<CustomizerPageStyleConfig> {
  if (config.mode !== "pack") return config;
  try {
    const loaded = await loadStylePackForMerchant(config.packId, merchantId);
    return { mode: "selected", presetIds: loaded ? resolvePackPresetIds(loaded.items, presets) : [] };
  } catch (e) {
    console.warn(`[stylePacks] resolve failed for pack ${config.packId}:`, e);
    return { mode: "selected", presetIds: [] };
  }
}

/** Active packs available to a merchant (its own + assigned platform packs). */
async function packsForMerchant(merchantId: string): Promise<StylePack[]> {
  const assigned = await db
    .select({ packId: stylePackMerchants.packId })
    .from(stylePackMerchants)
    .where(eq(stylePackMerchants.merchantId, merchantId));
  const assignedIds = assigned.map((a) => a.packId);
  const own = eq(stylePacks.merchantId, merchantId);
  const where = assignedIds.length
    ? or(own, and(isNull(stylePacks.merchantId), inArray(stylePacks.id, assignedIds)))
    : own;
  return db.select().from(stylePacks).where(and(eq(stylePacks.isActive, true), where));
}

/**
 * The pack a generate request runs under. Standard styles need none (null);
 * a pack_only style must be in an active pack available to the merchant.
 * `requestedPackId` narrows the choice when a style sits in several packs.
 */
export async function resolveGeneratePack(
  style: { id: string | number; catalogSlug?: string | null; visibility?: string | null },
  merchantId: string | null | undefined,
  requestedPackId?: string | null,
): Promise<{ allowed: boolean; pack: LoadedStylePack | null }> {
  const packOnly = isPackOnlyStyle(style);
  if (!merchantId) return { allowed: !packOnly, pack: null };
  // Standard style, no pack named: legacy generation, no pack queries at all.
  if (!packOnly && !requestedPackId) return { allowed: true, pack: null };
  let candidates: LoadedStylePack[];
  try {
    candidates = requestedPackId
      ? [await loadStylePackForMerchant(requestedPackId, merchantId)].filter(
          (p): p is LoadedStylePack => !!p,
        )
      : await Promise.all(
          (await packsForMerchant(merchantId)).map(async (pack) => ({
            pack,
            items: await db.select().from(stylePackItems).where(eq(stylePackItems.packId, pack.id)),
          })),
        );
  } catch (e) {
    // Fail closed for pack-only styles; a standard style still generates as before.
    console.warn("[stylePacks] generate pack lookup failed:", e);
    return { allowed: !packOnly, pack: null };
  }
  const hit = candidates.find((c) => packContainsStyle(c.items, style)) ?? null;
  if (packOnly) return { allowed: !!hit, pack: hit };
  // Standard styles keep today's behaviour; pack layers only apply when the
  // caller explicitly names a pack the style belongs to.
  return { allowed: true, pack: requestedPackId ? hit : null };
}

/**
 * Create/refresh one merchant's pack-only style rows from the code catalog
 * (shared/packStyleCatalog.ts), keyed by catalog slug. Only ever called on an
 * explicit pack assignment — never by boot seeding. Content fields are
 * refreshed; is_active is set on insert only, so later merchant/admin
 * visibility choices survive re-provisioning.
 */
export async function provisionPackStylesForMerchant(
  packSlug: string,
  merchantId: string,
  opts: { dryRun?: boolean } = {},
): Promise<{ inserted: string[]; updated: string[] }> {
  const defs = PACK_STYLE_CATALOG[packSlug];
  if (!defs) throw new Error(`No pack style catalog for ${packSlug}`);
  const existing = await db
    .select({ id: stylePresets.id, catalogSlug: stylePresets.catalogSlug })
    .from(stylePresets)
    .where(eq(stylePresets.merchantId, merchantId));
  const bySlug = new Map(existing.filter((r) => r.catalogSlug).map((r) => [r.catalogSlug!, r.id]));
  const inserted: string[] = [];
  const updated: string[] = [];
  for (let i = 0; i < defs.length; i++) {
    const d = defs[i];
    const content = {
      name: d.name,
      promptPrefix: d.promptPrefix,
      category: d.category,
      promptPlaceholder: d.promptPlaceholder ?? null,
      descriptionOptional: !!d.descriptionOptional,
      visibility: STYLE_VISIBILITY_PACK_ONLY,
      inputCapabilities: d.inputCapabilities,
      generationModel: d.generationModel,
      generationModelDecor: d.generationModelDecor,
      generationQuality: d.generationQuality ?? null,
      updatedAt: new Date(),
    };
    const id = bySlug.get(d.id);
    if (id != null) {
      updated.push(d.id);
      if (!opts.dryRun) await db.update(stylePresets).set(content).where(eq(stylePresets.id, id));
    } else {
      inserted.push(d.id);
      if (!opts.dryRun) {
        await db.insert(stylePresets).values({
          ...content,
          merchantId,
          catalogSlug: d.id,
          isActive: d.launchActive,
          sortOrder: 1000 + i,
          creatorScope: "merchant",
        });
      }
    }
  }
  return { inserted, updated };
}
