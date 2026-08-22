import { ExternalLink } from "lucide-react";
import {
  creatorShopPath,
  otherCreatorShopVisits,
  type LastCreatorVisit,
} from "@shared/lastCreatorVisit";

export type VisitedShopLink = {
  username: string;
  shopName: string;
  href: string;
  visitedAt?: number;
};

export function mergeVisitedCreatorShops(
  currentUsername: string,
  serverShops?: VisitedShopLink[] | null,
): VisitedShopLink[] {
  const local = otherCreatorShopVisits(currentUsername).map((v: LastCreatorVisit) => ({
    username: v.username,
    shopName: v.shopName || v.username,
    href: creatorShopPath(v.username),
    visitedAt: v.visitedAt,
  }));
  const current = String(currentUsername || "").trim().toLowerCase();
  const merged = new Map<string, VisitedShopLink>();
  for (const shop of [...(serverShops || []), ...local]) {
    const username = String(shop.username || "").trim().toLowerCase();
    if (!username || username === current) continue;
    const prev = merged.get(username);
    const visitedAt = Number(shop.visitedAt) || 0;
    if (!prev || visitedAt >= (Number(prev.visitedAt) || 0)) {
      merged.set(username, {
        username,
        shopName: shop.shopName || username,
        href: shop.href || creatorShopPath(username),
        visitedAt,
      });
    }
  }
  return [...merged.values()].sort((a, b) => (b.visitedAt || 0) - (a.visitedAt || 0));
}

export function CreatorVisitedShops({
  currentUsername,
  shops,
}: {
  currentUsername: string;
  shops?: VisitedShopLink[] | null;
}) {
  const others = mergeVisitedCreatorShops(currentUsername, shops);
  if (others.length === 0) return null;
  return (
    <div className="mb-3 rounded-md border bg-muted/40 px-3 py-2">
      <p className="text-xs font-medium text-foreground">Shops you've used</p>
      <ul className="mt-1 space-y-1">
        {others.map((shop) => (
          <li key={shop.username}>
            <a
              href={shop.href}
              target="_top"
              rel="noreferrer"
              className="inline-flex max-w-full items-center gap-1 text-xs text-primary underline-offset-2 hover:underline"
            >
              <span className="truncate">{shop.shopName}</span>
              <ExternalLink className="h-3 w-3 shrink-0" />
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
