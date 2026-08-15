import {
  isContextLikeMockupLabel,
  isPersonMockupLabel,
} from "@shared/printifyMockupLabels";

export type PostGenGalleryNavItem =
  | { kind: "artwork"; label: string }
  | { kind: "mockup"; url: string; label: string }
  | { kind: "catalog"; url: string; label: string };

/** `true` keeps the historic flat-placer skip (catalog stays reachable). */
export type PostGenGalleryPlacerMode = false | true | "flat" | "aop";

export function isPostGenContextLabel(label: string): boolean {
  const l = String(label || "").toLowerCase();
  if (!l) return false;
  if (l.startsWith("printers") || l.startsWith("printify")) return true;
  // AOP Printers Mockup: Front/Side/Back Person (excluded from lifestyle context).
  if (isPersonMockupLabel(label)) return true;
  return isContextLikeMockupLabel(label);
}

function normalizePlacerMode(
  mode: PostGenGalleryPlacerMode,
): false | "flat" | "aop" {
  if (mode === true || mode === "flat") return "flat";
  if (mode === "aop") return "aop";
  return false;
}

/**
 * While a placer is open, skip local Front/Back rasters (they match the live
 * canvas). Flat keeps merchant catalog Views (shown as canvas overrides).
 * Mesh AOP does not paint catalog slides — those still look like Front View,
 * so skip them or Front View → Front Person takes many invisible clicks.
 */
export function isPlacerGalleryReachable(
  item: PostGenGalleryNavItem,
  mode: PostGenGalleryPlacerMode,
): boolean {
  const skip = normalizePlacerMode(mode);
  if (!skip) return true;
  if (item.kind === "artwork") return true;
  if (item.kind === "catalog") return skip === "flat";
  if (item.kind === "mockup") return isPostGenContextLabel(item.label);
  return false;
}

export function isFlatPlacerGalleryReachable(item: PostGenGalleryNavItem): boolean {
  return isPlacerGalleryReachable(item, "flat");
}

export function isAopPlacerGalleryReachable(item: PostGenGalleryNavItem): boolean {
  return isPlacerGalleryReachable(item, "aop");
}

/**
 * Step the post-gen carousel. When a placer is open, skip slides that match
 * the live canvas so Printers/Context (and flat catalog) stay one click away.
 */
export function stepPostGenGalleryIndex(
  current: number,
  delta: 1 | -1,
  items: PostGenGalleryNavItem[],
  placerMode: PostGenGalleryPlacerMode,
): number {
  const len = items.length;
  if (len <= 1) return 0;
  const skip = normalizePlacerMode(placerMode);
  // Out-of-range start (gallery shrank under the pointer) — clamp to the ends
  // so a single click still lands on the expected neighbour.
  let start =
    current >= len ? len - 1 : current < 0 ? 0 : current;
  const startItem = items[start];
  // Hidden Front View stops (local Front/Back, AOP catalog) should step as
  // if the customer is on the live editor slide.
  if (
    skip &&
    startItem &&
    !isPlacerGalleryReachable(startItem, skip)
  ) {
    const artworkIdx = items.findIndex((it) => it.kind === "artwork");
    if (artworkIdx >= 0) start = artworkIdx;
  }
  let next = ((start % len) + len) % len;
  for (let n = 0; n < len; n++) {
    next = (next + delta + len) % len;
    if (!skip) return next;
    const item = items[next];
    if (!item) continue;
    if (isPlacerGalleryReachable(item, skip)) return next;
  }
  return next;
}
