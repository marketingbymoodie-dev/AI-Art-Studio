import { eq } from "drizzle-orm";
import { creators } from "@shared/schema";
import {
  STOREFRONT_FREE_GENERATION_DEFAULT,
  clampStorefrontFreeGens,
} from "@shared/storefront-credits";
import { db } from "./db";
import { storage } from "./storage";

export type StorefrontWalletView = {
  /** Spendable paid credits: creatorEarned + pack (never the unbucketed total). */
  credits: number;
  earnedCredits: number;
  packCredits: number;
  freeGenerationsUsed: number;
  shopFreeRemaining: number;
  freeGenerationLimit: number;
};

/** JSON shape every storefront credit response must use (login, status, redeem, generate). */
export function walletJson(wallet: StorefrontWalletView) {
  return {
    credits: wallet.credits,
    earnedCredits: wallet.earnedCredits,
    packCredits: wallet.packCredits,
    freeGenerationsUsed: wallet.freeGenerationsUsed,
    shopFreeRemaining: wallet.shopFreeRemaining,
    freeGenerationLimit: wallet.freeGenerationLimit,
  };
}

function creatorIdsFromUnknown(source: Record<string, unknown> | null | undefined): {
  creatorUsername?: string;
  creatorId?: string;
} {
  if (!source) return {};
  const creatorUsername =
    typeof source.creatorUsername === "string" ? source.creatorUsername.trim() : "";
  const creatorId = typeof source.creatorId === "string" ? source.creatorId.trim() : "";
  return {
    ...(creatorUsername ? { creatorUsername } : {}),
    ...(creatorId ? { creatorId } : {}),
  };
}

export function creatorContextFromRequest(req: {
  body?: unknown;
  query?: unknown;
}): { creatorUsername?: string; creatorId?: string } {
  const body = creatorIdsFromUnknown(
    req.body && typeof req.body === "object" ? (req.body as Record<string, unknown>) : null,
  );
  const query = creatorIdsFromUnknown(
    req.query && typeof req.query === "object" ? (req.query as Record<string, unknown>) : null,
  );
  return {
    creatorUsername: body.creatorUsername || query.creatorUsername,
    creatorId: body.creatorId || query.creatorId,
  };
}

/**
 * Customer-facing wallet: paid buckets plus this-shop free remaining.
 * Creator storefronts use the per-creator free-gen table, not merchant visitor free gens.
 */
export async function resolveStorefrontWalletView(params: {
  shop: string;
  customerId: string;
  merchantFreeLimit?: number;
  creatorUsername?: string | null;
  creatorId?: string | null;
  /** Already-attributed creator row id (generate/status). */
  knownCreatorId?: string | null;
}): Promise<StorefrontWalletView> {
  const merchantLimit = clampStorefrontFreeGens(
    params.merchantFreeLimit ?? STOREFRONT_FREE_GENERATION_DEFAULT,
  );
  const balance = await storage.ensureCustomerBalance(params.customerId);
  let freeGenerationsUsed = balance.freeGenerationsUsed || 0;
  let freeGenerationLimit = merchantLimit;
  let shopFreeRemaining = Math.max(0, freeGenerationLimit - freeGenerationsUsed);

  const packCredits = balance.packCredits ?? 0;
  const onCreatorShop = !!(params.knownCreatorId || params.creatorId || params.creatorUsername);
  let earnedCredits = onCreatorShop ? 0 : (balance.earnedCredits ?? 0);

  const applyCreatorPeek = async (creatorId: string, freeGensPerCustomer: number) => {
    const { peekCreatorCustomerFreeGens } = await import("./creator-quota");
    const { peekCreatorEarned } = await import("./creator-earned");
    const peek = await peekCreatorCustomerFreeGens({
      creatorId,
      customerId: params.customerId,
      freeGensPerCustomer,
    });
    freeGenerationsUsed = peek.used;
    freeGenerationLimit = peek.limit;
    shopFreeRemaining = peek.remaining;
    earnedCredits = await peekCreatorEarned({
      creatorId,
      customerId: params.customerId,
    });
  };

  if (params.knownCreatorId) {
    const [creator] = await db
      .select()
      .from(creators)
      .where(eq(creators.id, params.knownCreatorId))
      .limit(1);
    if (creator) {
      await applyCreatorPeek(creator.id, creator.freeGensPerCustomer);
    }
  } else if (params.creatorUsername || params.creatorId) {
    try {
      const { assertPublicCreatorApiContext } = await import("./creator-host");
      const asserted = await assertPublicCreatorApiContext({
        shop: params.shop,
        creatorId: params.creatorId || null,
        creatorUsername: params.creatorUsername || null,
        requirePlatformShop: true,
      });
      if (asserted.ok) {
        await applyCreatorPeek(asserted.creator.id, asserted.creator.freeGensPerCustomer);
      }
    } catch {
      /* keep merchant free remaining */
    }
  }

  return {
    credits: earnedCredits + packCredits,
    earnedCredits,
    packCredits,
    freeGenerationsUsed,
    shopFreeRemaining,
    freeGenerationLimit,
  };
}
