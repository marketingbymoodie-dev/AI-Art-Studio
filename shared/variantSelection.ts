import { PRINT_SIDES_OPTION_NAME } from "./printSides";
import { normalizeSelectionId } from "./variantMapResolve";

export type SelectionAxis = { id: string; name: string };

/** Empty selection means "not configured" and keeps every axis. A selection that matches nothing is id drift, not an intentional wipe. */
export function offeredAxes(axes: readonly SelectionAxis[], selectedIds: readonly string[]): SelectionAxis[] {
  if (!selectedIds.length || !axes.length) return [...axes];
  const wanted = new Set(selectedIds.map((id) => normalizeSelectionId(id)));
  const kept = axes.filter((axis) => wanted.has(normalizeSelectionId(axis.id)));
  return kept.length ? kept : [...axes];
}

export function variantKeyIsOffered(
  key: string,
  sizes: readonly SelectionAxis[],
  colors: readonly SelectionAxis[],
  selectedSizeIds: readonly string[],
  selectedColorIds: readonly string[],
): boolean {
  if (!sizes.length) return true;
  const idx = key.indexOf(":");
  const sizeId = idx < 0 ? key : key.slice(0, idx);
  const colorId = idx < 0 ? "default" : key.slice(idx + 1);
  const sizeOk = offeredAxes(sizes, selectedSizeIds).some(
    (size) => normalizeSelectionId(size.id) === normalizeSelectionId(sizeId),
  );
  if (!sizeOk) return false;
  if (!colors.length || colorId === "default") return true;
  return offeredAxes(colors, selectedColorIds).some(
    (color) => normalizeSelectionId(color.id) === normalizeSelectionId(colorId),
  );
}

export function droppedSelectionNames(
  axes: readonly SelectionAxis[],
  selectedIds: readonly string[],
): string[] {
  const kept = new Set(offeredAxes(axes, selectedIds).map((axis) => normalizeSelectionId(axis.id)));
  return axes.filter((axis) => !kept.has(normalizeSelectionId(axis.id))).map((axis) => axis.name);
}

const printSidesOption = PRINT_SIDES_OPTION_NAME.trim().toLowerCase();

function normName(value: string | null | undefined): string {
  return String(value || "").trim().toLowerCase();
}

/** A live Shopify variant belongs to an unticked size or colour. Print sides is never a size or colour. */
export function variantMatchesDroppedSelection(
  selectedOptions: readonly { name?: string | null; value?: string | null }[],
  droppedSizeNames: readonly string[],
  droppedColorNames: readonly string[],
): boolean {
  const dropped = new Set([...droppedSizeNames, ...droppedColorNames].map(normName).filter(Boolean));
  if (!dropped.size) return false;
  return selectedOptions.some((option) => {
    if (normName(option.name) === printSidesOption) return false;
    return dropped.has(normName(option.value));
  });
}

export function withoutDroppedVariantKeys<T>(
  map: Record<string, T>,
  sizes: readonly SelectionAxis[],
  colors: readonly SelectionAxis[],
  selectedSizeIds: readonly string[],
  selectedColorIds: readonly string[],
): Record<string, T> {
  return Object.fromEntries(
    Object.entries(map).filter(([key]) =>
      variantKeyIsOffered(key, sizes, colors, selectedSizeIds, selectedColorIds),
    ),
  );
}

/** Studio and publish lists keep a colour unless its name was unticked on the product type. */
export function coloursStillOffered<T extends { name: string }>(
  colours: readonly T[],
  frameColors: readonly SelectionAxis[],
  selectedColorIds: readonly string[],
): T[] {
  const dropped = new Set(droppedSelectionNames(frameColors, selectedColorIds).map(normName));
  if (!dropped.size) return [...colours];
  return colours.filter((colour) => !dropped.has(normName(colour.name)));
}

export function filterPricesToSizes<T extends {
  sizes: string[];
  pricesBySize: Record<string, string>;
  compareAtBySize: Record<string, string>;
}>(prices: T, offeredNames: readonly string[]): T {
  const wanted = new Set(offeredNames);
  const sizes = prices.sizes.filter((name) => wanted.has(name));
  const pick = (source: Record<string, string>) =>
    Object.fromEntries(Object.entries(source).filter(([name]) => wanted.has(name)));
  return { ...prices, sizes, pricesBySize: pick(prices.pricesBySize), compareAtBySize: pick(prices.compareAtBySize) };
}
