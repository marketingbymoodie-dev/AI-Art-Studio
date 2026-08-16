import { normalizeSelectionId } from "./variantMapResolve";

export type VariantComboPair = { sizeId: string; colorId?: string };

export function variantComboKey(sizeId: string, colorId?: string | null): string {
  return `${normalizeSelectionId(sizeId)}::${normalizeSelectionId(colorId || "")}`;
}

export function comboSetFromPairs(pairs: VariantComboPair[] | null | undefined): Set<string> {
  const set = new Set<string>();
  if (!pairs) return set;
  for (const p of pairs) {
    if (!p?.sizeId) continue;
    set.add(variantComboKey(p.sizeId, p.colorId));
  }
  return set;
}

export function isAllowedVariantCombo(
  sizeId: string,
  colorId: string,
  comboSet: Set<string> | null | undefined,
): boolean {
  if (!comboSet || comboSet.size === 0) return true;
  return comboSet.has(variantComboKey(sizeId, colorId));
}

/** Count Printify-real size×colour picks. Falls back to a cartesian product if no combo list. */
export function countExistingVariantCombos(
  sizeIds: Iterable<string>,
  colorIds: Iterable<string>,
  comboSet: Set<string> | null | undefined,
): number {
  const sizes = [...sizeIds].filter(Boolean);
  const colors = [...colorIds].filter(Boolean);
  if (sizes.length === 0) return 0;
  if (!comboSet || comboSet.size === 0) {
    return sizes.length * (colors.length > 0 ? colors.length : 1);
  }
  if (colors.length === 0) {
    return sizes.filter((s) => comboSet.has(variantComboKey(s, ""))).length || sizes.length;
  }
  let n = 0;
  for (const s of sizes) {
    for (const c of colors) {
      if (comboSet.has(variantComboKey(s, c))) n++;
    }
  }
  return n;
}
