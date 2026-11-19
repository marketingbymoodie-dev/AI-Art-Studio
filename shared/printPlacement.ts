/**
 * Where a design sits in the front print area.
 * "top" puts the art's top edge on the top of the print area (chest height).
 * "center" puts it in the middle of that area. Both stay horizontally centred.
 * Scale 1 is contain: the art grows until it touches the print area's limiting side.
 *
 * Only types 56 and 58 use the chest placement. Every other type, including
 * the staging demo (54), keeps the centred 85% mockup.
 */
export type VerticalPrintAnchor = "top" | "center";

const CHEST_PLACEMENT_TYPE_IDS = new Set([56, 58]);

export function verticalPrintAnchorOf(raw: unknown): VerticalPrintAnchor {
  return raw === "top" ? "top" : "center";
}

export function placementForProductType(productTypeId: number): {
  anchor: VerticalPrintAnchor;
  mockupScale: number;
} {
  if (CHEST_PLACEMENT_TYPE_IDS.has(productTypeId)) return { anchor: "top", mockupScale: 1 };
  return { anchor: "center", mockupScale: 0.85 };
}

export function inkOrigin(args: {
  areaLeft: number;
  areaTop: number;
  areaWidth: number;
  areaHeight: number;
  inkWidth: number;
  inkHeight: number;
  anchor: VerticalPrintAnchor;
}): { left: number; top: number } {
  const left = Math.round(args.areaLeft + (args.areaWidth - args.inkWidth) / 2);
  const top = args.anchor === "top"
    ? Math.round(args.areaTop)
    : Math.round(args.areaTop + (args.areaHeight - args.inkHeight) / 2);
  return { left: Math.max(0, left), top: Math.max(0, top) };
}

/** Maximum design size inside the print area. Null on a type means no cap. */
export type ChestPrintZone = { maxWidthIn: number; maxHeightIn: number };

/**
 * Approved chest zones. Comfort Colors is 14 × 14 in. Gildan's print area is
 * only 12.84 in wide, so the width stays 11 in and the height is 14 in.
 * Every other type has no zone and keeps its existing placement.
 */
export const CHEST_ZONES: Record<number, ChestPrintZone> = {
  56: { maxWidthIn: 11, maxHeightIn: 14 },
  58: { maxWidthIn: 14, maxHeightIn: 14 },
};

/** Stored inches win. Empty values fall back to the approved zone for that type. */
export function chestZoneForProductType(
  productTypeId: number,
  storedWidth?: unknown,
  storedHeight?: unknown,
): ChestPrintZone | null {
  const width = Number(storedWidth);
  const height = Number(storedHeight);
  if (width > 0 && height > 0) return { maxWidthIn: width, maxHeightIn: height };
  return CHEST_ZONES[productTypeId] ?? null;
}

/** Top of the print area, horizontally centred, never larger than the print area. */
export function chestZoneRect(args: {
  areaLeft: number;
  areaTop: number;
  areaWidth: number;
  areaHeight: number;
  printWidthIn: number;
  printHeightIn: number;
  zone: ChestPrintZone;
}): { left: number; top: number; width: number; height: number } {
  const widthFrac = args.printWidthIn > 0 ? Math.min(1, args.zone.maxWidthIn / args.printWidthIn) : 1;
  const heightFrac = args.printHeightIn > 0 ? Math.min(1, args.zone.maxHeightIn / args.printHeightIn) : 1;
  const width = Math.max(1, Math.round(args.areaWidth * widthFrac));
  const height = Math.max(1, Math.round(args.areaHeight * heightFrac));
  const left = Math.round(args.areaLeft + (args.areaWidth - width) / 2);
  return { left, top: Math.round(args.areaTop), width, height };
}
