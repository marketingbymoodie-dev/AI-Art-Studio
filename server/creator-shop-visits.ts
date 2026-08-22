import { desc, eq, inArray } from "drizzle-orm";
import { creatorCustomerShopVisits, creators } from "@shared/schema";
import { creatorPublicName, normalizeCreatorUsername } from "@shared/creatorMarketplace";
import { db } from "./db";

export type VisitedCreatorShop = {
  username: string;
  shopName: string;
  href: string;
  visitedAt: number;
};

const MAX_SHOPS = 20;

export async function rememberCreatorShopVisit(params: {
  customerId: string;
  creatorId: string;
  creatorUsername: string;
  shopName?: string | null;
}): Promise<void> {
  const customerId = String(params.customerId || "").trim();
  const creatorId = String(params.creatorId || "").trim();
  const username = normalizeCreatorUsername(params.creatorUsername);
  if (!customerId || !creatorId || !username) return;
  const shopName = String(params.shopName || username).trim().slice(0, 120) || username;
  await db
    .insert(creatorCustomerShopVisits)
    .values({
      customerId,
      creatorId,
      creatorUsername: username,
      shopName,
      lastSeenAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [creatorCustomerShopVisits.customerId, creatorCustomerShopVisits.creatorId],
      set: {
        creatorUsername: username,
        shopName,
        lastSeenAt: new Date(),
      },
    });
}

export async function listCreatorShopVisits(customerId: string): Promise<VisitedCreatorShop[]> {
  const id = String(customerId || "").trim();
  if (!id) return [];
  const rows = await db
    .select()
    .from(creatorCustomerShopVisits)
    .where(eq(creatorCustomerShopVisits.customerId, id))
    .orderBy(desc(creatorCustomerShopVisits.lastSeenAt))
    .limit(MAX_SHOPS);

  const creatorIds = [...new Set(rows.map((r) => r.creatorId).filter(Boolean))];
  const live =
    creatorIds.length > 0
      ? await db
          .select({
            id: creators.id,
            username: creators.username,
            branding: creators.branding,
          })
          .from(creators)
          .where(inArray(creators.id, creatorIds))
      : [];
  const liveById = new Map(live.map((c) => [c.id, c]));

  const out: VisitedCreatorShop[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const liveCreator = liveById.get(row.creatorId);
    const username = normalizeCreatorUsername(liveCreator?.username || row.creatorUsername);
    if (!username || seen.has(username)) continue;
    seen.add(username);
    const shopName =
      (liveCreator
        ? creatorPublicName({
            username: liveCreator.username,
            branding: (liveCreator.branding as Record<string, unknown> | null) ?? null,
          })
        : "") ||
      String(row.shopName || username).trim() ||
      username;
    out.push({
      username,
      shopName,
      href: `/c/${username}`,
      visitedAt: row.lastSeenAt ? new Date(row.lastSeenAt).getTime() : Date.now(),
    });
  }
  return out;
}
