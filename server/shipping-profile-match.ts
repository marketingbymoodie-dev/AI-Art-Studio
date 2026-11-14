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
