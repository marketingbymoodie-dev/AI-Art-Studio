/**
 * Experience profile resolution (shared/experienceProfile.ts).
 *
 * page.experience_profile_id → profile, only when it is active and available
 * to the page's merchant (its own, or a platform profile explicitly assigned).
 * Anything missing or failing resolves to null = the classic customizer.
 */
import { and, eq } from "drizzle-orm";
import { db } from "./db";
import { experienceProfileMerchants, experienceProfiles, stylePacks, type ExperienceProfileRow } from "@shared/schema";
import type { CustomizerPageStyleConfig } from "@shared/customizerPageStyles";
import { publicExperienceProfile, type PublicExperienceProfile } from "@shared/experienceProfile";
import { getStylePackProfile } from "@shared/stylePackProfiles";

export type ResolvedExperience = { row: ExperienceProfileRow; public: PublicExperienceProfile };

/** Active, and either the merchant's own profile or a platform profile assigned to it. */
export function profileAvailableToMerchant(
  row: { isActive: boolean; merchantId: string | null } | null | undefined,
  merchantId: string | null | undefined,
  assigned: boolean,
): boolean {
  if (!row || !row.isActive || !merchantId) return false;
  return row.merchantId ? row.merchantId === merchantId : assigned;
}

export async function loadExperienceProfileForMerchant(
  profileId: string | null | undefined,
  merchantId: string | null | undefined,
): Promise<ExperienceProfileRow | null> {
  if (!profileId || !merchantId) return null;
  const [row] = await db.select().from(experienceProfiles).where(eq(experienceProfiles.id, profileId)).limit(1);
  if (!row || !row.isActive) return null;
  if (row.merchantId) return profileAvailableToMerchant(row, merchantId, false) ? row : null;
  const [assigned] = await db
    .select({ id: experienceProfileMerchants.id })
    .from(experienceProfileMerchants)
    .where(and(eq(experienceProfileMerchants.profileId, profileId), eq(experienceProfileMerchants.merchantId, merchantId)))
    .limit(1);
  return profileAvailableToMerchant(row, merchantId, !!assigned) ? row : null;
}

/** Active profiles a merchant may assign: its own + explicitly assigned platform profiles. */
export async function listExperienceProfilesForMerchant(
  merchantId: string | null | undefined,
): Promise<Array<{ id: string; slug: string; name: string; stylePackId: string | null }>> {
  if (!merchantId) return [];
  const assigned = await db
    .select({ profileId: experienceProfileMerchants.profileId })
    .from(experienceProfileMerchants)
    .where(eq(experienceProfileMerchants.merchantId, merchantId));
  const ids = new Set(assigned.map((a) => a.profileId));
  const rows = await db.select().from(experienceProfiles).where(eq(experienceProfiles.isActive, true));
  return rows
    .filter((r) => profileAvailableToMerchant(r, merchantId, ids.has(r.id)))
    .map((r) => ({ id: r.id, slug: r.slug, name: r.name, stylePackId: r.stylePackId ?? null }));
}

/** Humour/relationship choices (ids + labels only) from the profile's pack prompt profile. */
async function packControlOptions(stylePackId: string | null) {
  if (!stylePackId) return null;
  const [pack] = await db
    .select({ key: stylePacks.promptProfileKey })
    .from(stylePacks)
    .where(eq(stylePacks.id, stylePackId))
    .limit(1);
  const profile = getStylePackProfile(pack?.key);
  if (!profile) return null;
  const strip = (o: { id: string; label: string }) => ({ id: o.id, label: o.label });
  return {
    humorOptions: profile.humorOptions.map(strip),
    relationshipOptions: profile.relationshipOptions.map(strip),
    conceptWriter: !!profile.concept?.system?.trim(),
  };
}

/** Never throws: a broken profile must not break a classic page response. */
export async function resolvePageExperience(
  page: { experienceProfileId?: string | null } | null | undefined,
  merchantId: string | null | undefined,
): Promise<ResolvedExperience | null> {
  if (!page?.experienceProfileId) return null;
  try {
    const row = await loadExperienceProfileForMerchant(page.experienceProfileId, merchantId);
    if (!row) return null;
    return { row, public: publicExperienceProfile(row, await packControlOptions(row.stylePackId)) };
  } catch (e) {
    console.warn(`[experienceProfile] resolve failed for ${page.experienceProfileId}:`, e);
    return null;
  }
}

/**
 * Style source for a page: an explicit page pack wins, else the profile's
 * pack, else the page's own config (null → caller's designer-type default).
 */
export function effectiveStyleConfigForPage(
  pageConfig: CustomizerPageStyleConfig | null,
  profile: { stylePackId?: string | null } | null | undefined,
): CustomizerPageStyleConfig | null {
  if (pageConfig?.mode === "pack") return pageConfig;
  if (profile?.stylePackId) return { mode: "pack", packId: profile.stylePackId };
  return pageConfig;
}
