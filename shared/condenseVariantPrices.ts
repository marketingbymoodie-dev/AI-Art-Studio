/** Split "14\" x 11\" / Black" into size + colour. Size-only titles have no colour. */
export function splitVariantTitle(title: string): { size: string; color: string | null } {
  const trimmed = title.trim();
  const sep = " / ";
  const idx = trimmed.indexOf(sep);
  if (idx === -1) return { size: trimmed, color: null };
  const size = trimmed.slice(0, idx).trim();
  const color = trimmed.slice(idx + sep.length).trim();
  return { size, color: color || null };
}

export function normalizeRetailPrice(value: string | undefined | null): string {
  if (value == null || String(value).trim() === "") return "";
  const n = parseFloat(String(value));
  return Number.isFinite(n) ? n.toFixed(2) : String(value).trim();
}

/** Same size despite quote / X-vs-x drift between wizard and Printify labels. */
export function normalizeSizeGroupKey(size: string): string {
  return size
    .toLowerCase()
    .replace(/[""″‶‴]/g, '"')
    .replace(/\s+/g, " ")
    .replace(/\s*x\s*/g, " x ")
    .trim();
}

/**
 * Printify colour costs often differ by a few cents, then round-up-to-.95
 * makes Black $66.95 and White $67.95. Treat that as the same retail price.
 */
export const SAME_SIZE_PRICE_TOLERANCE = 1;

function priceNumber(value: string | undefined | null): number | null {
  if (value == null || String(value).trim() === "") return null;
  const n = parseFloat(String(value));
  return Number.isFinite(n) ? n : null;
}

/** Snap same-size colours to one retail price when they only differ by rounding. */
export function unifySameSizeSuggestedPrices(
  variants: Array<{ id: string; title: string }>,
  prices: Record<string, string>,
  tolerance = SAME_SIZE_PRICE_TOLERANCE,
): Record<string, string> {
  const bySize = new Map<string, string[]>();
  for (const v of variants) {
    const key = normalizeSizeGroupKey(splitVariantTitle(v.title).size);
    const list = bySize.get(key) ?? [];
    list.push(v.id);
    bySize.set(key, list);
  }
  const next = { ...prices };
  for (const ids of bySize.values()) {
    const nums = ids.map((id) => priceNumber(prices[id])).filter((n): n is number => n != null);
    if (nums.length < 2) continue;
    const min = Math.min(...nums);
    const max = Math.max(...nums);
    if (max - min > tolerance) continue;
    const unified = max.toFixed(2);
    for (const id of ids) {
      if (prices[id] != null && prices[id] !== "") next[id] = unified;
    }
  }
  return next;
}

const ALL_COLOURS_MIN = 4;

/** Label the colour side of a condensed row. */
export function formatCondensedColorLabel(
  colorsInGroup: string[],
  allColorsForSize: string[],
): string {
  const uniqueGroup = uniquePreserve(colorsInGroup);
  const uniqueAll = uniquePreserve(allColorsForSize);
  if (uniqueGroup.length === 0) return "";
  const coversAll =
    uniqueAll.length > 0 &&
    uniqueGroup.length === uniqueAll.length &&
    uniqueGroup.every((c) => uniqueAll.includes(c));
  if (coversAll && uniqueGroup.length >= ALL_COLOURS_MIN) return "All Colours";
  if (!coversAll && uniqueGroup.length >= ALL_COLOURS_MIN) {
    return `${uniqueGroup.length} colours`;
  }
  return uniqueGroup.join("/");
}

export type CondensedPriceRow = {
  key: string;
  size: string;
  label: string;
  price: string;
  priceBoth: string;
  variantIds: string[];
};

export function condenseVariantPriceRows(
  variants: Array<{ id: string; title: string }>,
  prices: Record<string, string>,
  pricesBoth: Record<string, string> = {},
  supportsBoth = false,
): CondensedPriceRow[] {
  const bySize = new Map<string, { size: string; group: Array<{ id: string; title: string }> }>();
  for (const v of variants) {
    const { size } = splitVariantTitle(v.title);
    const key = normalizeSizeGroupKey(size);
    const entry = bySize.get(key) ?? { size, group: [] };
    entry.group.push(v);
    bySize.set(key, entry);
  }

  const rows: CondensedPriceRow[] = [];
  for (const { size, group } of bySize.values()) {
    const allColors = uniquePreserve(
      group.map((v) => splitVariantTitle(v.title).color).filter((c): c is string => !!c),
    );
    const remaining = [...group];
    while (remaining.length > 0) {
      const seed = remaining.shift()!;
      const seedFront = priceNumber(prices[seed.id]);
      const seedBoth = supportsBoth ? priceNumber(pricesBoth[seed.id]) : null;
      const members = [seed];
      for (let i = remaining.length - 1; i >= 0; i--) {
        const candidate = remaining[i]!;
        const front = priceNumber(prices[candidate.id]);
        const both = supportsBoth ? priceNumber(pricesBoth[candidate.id]) : null;
        const frontClose =
          seedFront == null || front == null
            ? seedFront == null && front == null
            : Math.abs(front - seedFront) <= SAME_SIZE_PRICE_TOLERANCE;
        const bothClose =
          !supportsBoth ||
          seedBoth == null ||
          both == null
            ? !supportsBoth || (seedBoth == null && both == null)
            : Math.abs(both - seedBoth) <= SAME_SIZE_PRICE_TOLERANCE;
        if (frontClose && bothClose) {
          members.push(candidate);
          remaining.splice(i, 1);
        }
      }
      const colors = members
        .map((v) => splitVariantTitle(v.title).color)
        .filter((c): c is string => !!c);
      const colorLabel = formatCondensedColorLabel(colors, allColors);
      const label = colorLabel ? `${size} / ${colorLabel}` : size;
      const frontNums = members.map((m) => priceNumber(prices[m.id])).filter((n): n is number => n != null);
      const bothNums = members.map((m) => priceNumber(pricesBoth[m.id])).filter((n): n is number => n != null);
      const first = members[0]!;
      const rawFront = members.map((m) => prices[m.id] ?? "");
      const rawBoth = members.map((m) => pricesBoth[m.id] ?? "");
      const sameFront = rawFront.every((p) => p === rawFront[0]);
      const sameBoth = rawBoth.every((p) => p === rawBoth[0]);
      rows.push({
        key: `${size}|${members.map((m) => m.id).join(",")}`,
        size,
        label,
        price: sameFront ? (rawFront[0] ?? "") : (frontNums.length ? Math.max(...frontNums).toFixed(2) : (prices[first.id] ?? "")),
        priceBoth: sameBoth ? (rawBoth[0] ?? "") : (bothNums.length ? Math.max(...bothNums).toFixed(2) : (pricesBoth[first.id] ?? "")),
        variantIds: members.map((m) => m.id),
      });
    }
  }
  return rows;
}

function uniquePreserve(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}
