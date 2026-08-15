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
  const bySize = new Map<string, Array<{ id: string; title: string }>>();
  for (const v of variants) {
    const { size } = splitVariantTitle(v.title);
    const list = bySize.get(size) ?? [];
    list.push(v);
    bySize.set(size, list);
  }

  const rows: CondensedPriceRow[] = [];
  for (const [size, group] of bySize) {
    const allColors = uniquePreserve(
      group.map((v) => splitVariantTitle(v.title).color).filter((c): c is string => !!c),
    );
    const byPrice = new Map<string, Array<{ id: string; title: string }>>();
    for (const v of group) {
      const front = normalizeRetailPrice(prices[v.id]);
      const both = supportsBoth ? normalizeRetailPrice(pricesBoth[v.id]) : "";
      const priceKey = `${front}|${both}`;
      const list = byPrice.get(priceKey) ?? [];
      list.push(v);
      byPrice.set(priceKey, list);
    }
    for (const [priceKey, members] of byPrice) {
      const colors = members
        .map((v) => splitVariantTitle(v.title).color)
        .filter((c): c is string => !!c);
      const colorLabel = formatCondensedColorLabel(colors, allColors);
      const label = colorLabel ? `${size} / ${colorLabel}` : size;
      const first = members[0]!;
      rows.push({
        key: `${size}|${priceKey}|${members.map((m) => m.id).join(",")}`,
        size,
        label,
        // Keep the raw typed value so pricing inputs are not forced to 2dp mid-edit.
        price: prices[first.id] ?? "",
        priceBoth: pricesBoth[first.id] ?? "",
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
