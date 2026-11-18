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
