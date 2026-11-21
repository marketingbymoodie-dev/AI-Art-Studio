/**
 * Match desired delivery profiles to Shopify profiles that already exist,
 * so an empty ID map is rebuilt instead of creating a second copy.
 */
export type NameMatchDesired = { name: string; classKey: string };
export type NameMatchLive = { name: string };

export type NameMatchResult<D extends NameMatchDesired, L extends NameMatchLive> =
  | { ok: true; pairs: Array<{ desired: D; live: L }> }
  | { ok: false; reason: string };

export function matchAppaiProfilesByName<D extends NameMatchDesired, L extends NameMatchLive>(
  desired: D[],
  live: L[],
): NameMatchResult<D, L> {
  const byDesiredName = new Map<string, D[]>();
  for (const row of desired) {
    const list = byDesiredName.get(row.name) || [];
    list.push(row);
    byDesiredName.set(row.name, list);
  }
  const byLiveName = new Map<string, L[]>();
  for (const row of live) {
    const list = byLiveName.get(row.name) || [];
    list.push(row);
    byLiveName.set(row.name, list);
  }
  if (byDesiredName.size !== desired.length) {
    return { ok: false, reason: "two desired profiles share a name" };
  }
  if (byLiveName.size !== live.length) {
    return { ok: false, reason: "two Shopify profiles share a name" };
  }
  const pairs: Array<{ desired: D; live: L }> = [];
  for (const row of desired) {
    const hits = byLiveName.get(row.name) || [];
    if (hits.length !== 1) {
      return { ok: false, reason: `desired name matched ${hits.length} Shopify profiles` };
    }
    const provider = row.classKey.split(":")[1] || "";
    const named = row.name.match(/provider\s+(\d+)/);
    if (named && named[1] !== provider) {
      return { ok: false, reason: `provider ${named[1]} in the name does not match ${row.classKey}` };
    }
    pairs.push({ desired: row, live: hits[0] });
  }
  for (const row of live) {
    if (!byDesiredName.has(row.name)) {
      return { ok: false, reason: "a Shopify AppAI profile has no desired match" };
    }
  }
  return { ok: true, pairs };
}

/** Trailing digits of a Shopify gid or a bare numeric id. */
export function numericShopifyId(id: string | null | undefined): string {
  if (!id) return "";
  const match = String(id).match(/(\d+)\s*$/);
  return match ? match[1] : "";
}

/**
 * Variant ids we asked to move that Shopify did not report on `profileId`.
 * A null node, a null delivery profile, or a different profile all count.
 */
export function unconfirmedVariantIds(
  expectedVariantIds: string[],
  found: Array<{ id: string | null; profileId: string | null }>,
  profileId: string,
): string[] {
  const want = numericShopifyId(profileId);
  const onProfile = new Set(
    found
      .filter((row) => row.id && want && numericShopifyId(row.profileId) === want)
      .map((row) => numericShopifyId(row.id)),
  );
  return expectedVariantIds.map(numericShopifyId).filter((id) => id && !onProfile.has(id));
}

/**
 * Old per-class profile → the shared profile that now owns that class.
 * Null when the old profile is not part of a merge (leave it for the caller).
 */
export function replacementProfileKey(
  oldProfileKey: string,
  desired: Array<{ profileKey: string; classKeys: string[] }>,
): string | null {
  const classKey = oldProfileKey.replace(/#.*$/, "");
  const hit = desired.find(
    (profile) => profile.profileKey.startsWith("share:") && profile.classKeys.includes(classKey),
  );
  return hit?.profileKey ?? null;
}
