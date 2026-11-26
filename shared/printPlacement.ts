/**
 * Where a design sits in the front print area.
 * "top" puts the art's top edge on the top of the print area (chest height).
 * "center" puts it in the middle of that area. Both stay horizontally centred.
 * Scale 1 is contain: the art grows until it touches the print area's limiting side.
 *
 * Softstyle (Printify blueprint 145) and Comfort Colors (blueprint 706), both
 * provider 99, use the chest placement only on the staging demo shop and
 * Petposterous. A null shop, or the same blueprint on any other shop, keeps
 * the centred 85% mockup. Product type ids are not part of this choice.
 */
import { catalogueShopAllowed } from "./operatorCatalogue";

export type VerticalPrintAnchor = "top" | "center";

/** Gildan Softstyle. Chest zone 11 × 14 in. */
export const SOFTSTYLE_BLUEPRINT_ID = 145;
/** Comfort Colors 1717. Chest zone 14 × 14 in. */
export const COMFORT_COLORS_BLUEPRINT_ID = 706;
export const CATALOGUE_SHIRT_PROVIDER_ID = 99;

export type CatalogueGarmentRef = {
  shop?: string | null;
  blueprintId?: unknown;
  providerId?: unknown;
};

export type CatalogueShirtKind = "softstyle" | "comfort";

export function catalogueShirtKind(ref: CatalogueGarmentRef): CatalogueShirtKind | null {
  if (!catalogueShopAllowed(ref.shop)) return null;
  if (Number(ref.providerId) !== CATALOGUE_SHIRT_PROVIDER_ID) return null;
  const blueprint = Number(ref.blueprintId);
  if (blueprint === SOFTSTYLE_BLUEPRINT_ID) return "softstyle";
  if (blueprint === COMFORT_COLORS_BLUEPRINT_ID) return "comfort";
  return null;
}

export function verticalPrintAnchorOf(raw: unknown): VerticalPrintAnchor {
  return raw === "top" ? "top" : "center";
}

export function placementForCatalogueType(ref: CatalogueGarmentRef = {}): {
  anchor: VerticalPrintAnchor;
  mockupScale: number;
} {
  if (catalogueShirtKind(ref)) return { anchor: "top", mockupScale: 1 };
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
 * Every other blueprint has no default zone.
 */
const BLUEPRINT_CHEST_ZONES: Record<CatalogueShirtKind, ChestPrintZone> = {
  softstyle: { maxWidthIn: 11, maxHeightIn: 14 },
  comfort: { maxWidthIn: 14, maxHeightIn: 14 },
};

/**
 * Stored inches win for any type. The blueprint default applies only when this
 * shop and blueprint are a catalogue shirt and both stored inches are empty.
 * A null shop never receives the blueprint default.
 */
export function chestZoneForCatalogueType(ref: CatalogueGarmentRef & {
  storedWidth?: unknown;
  storedHeight?: unknown;
}): ChestPrintZone | null {
  const width = Number(ref.storedWidth);
  const height = Number(ref.storedHeight);
  const stored = width > 0 && height > 0 ? { maxWidthIn: width, maxHeightIn: height } : null;
  const kind = catalogueShirtKind(ref);
  if (kind) return stored ?? BLUEPRINT_CHEST_ZONES[kind];
  return stored;
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
