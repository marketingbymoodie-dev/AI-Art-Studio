/**
 * Debit merchant monthly generation allotment when coupon credits are assigned
 * to a customer (on redeem). Each credit = 1 generation unit.
 */
import { storage } from "./storage";
import {
  consumeMerchantGenerationQuota,
  peekMerchantGenerationQuota,
} from "./generation-quota";
import type { ShopifyInstallation } from "@shared/schema";

const TAG = "[merchant-coupon-quota]";

export async function resolveInstallationForMerchant(
  merchantId: string,
): Promise<ShopifyInstallation | null> {
  const installations = await storage.getShopifyInstallationsByMerchant(merchantId);
  if (!installations.length) return null;
  return installations.find((i) => i.status === "active") || installations[0] || null;
}

/** Peek whether the merchant can cover `units` gens from plan + overage. */
export async function merchantCanCoverCouponUnits(
  installation: ShopifyInstallation,
  units: number,
): Promise<{ ok: boolean; remaining: number; message?: string }> {
  const n = Math.max(0, Math.floor(units));
  if (n <= 0) return { ok: true, remaining: 0 };
  const peek = await peekMerchantGenerationQuota(installation);
  if (peek.unlimited) return { ok: true, remaining: Number.POSITIVE_INFINITY };
  if (peek.remaining < n) {
    return {
      ok: false,
      remaining: peek.remaining,
      message: `Not enough generations left this month (need ${n}, have ${peek.remaining}). Lower credits/max uses, enable extra usage, or wait for next period.`,
    };
  }
  return { ok: true, remaining: peek.remaining };
}

/**
 * Consume `units` from the merchant allotment (included then overage).
 * Stops early if a unit is blocked — returns how many were consumed.
 */
export async function consumeMerchantCouponUnits(
  installation: ShopifyInstallation,
  units: number,
): Promise<{ consumed: number; ok: boolean; message?: string }> {
  const n = Math.max(0, Math.floor(units));
  if (n <= 0) return { consumed: 0, ok: true };

  let consumed = 0;
  let lastMessage: string | undefined;
  for (let i = 0; i < n; i++) {
    const fresh = (await storage.getShopifyInstallation(installation.id)) ?? installation;
    const decision = await consumeMerchantGenerationQuota(fresh);
    if (!decision.allowed) {
      lastMessage = decision.message || "Monthly generation allotment exhausted.";
      console.warn(
        `${TAG} stopped after ${consumed}/${n} for ${installation.shopDomain}: ${lastMessage}`,
      );
      break;
    }
    consumed++;
  }
  return {
    consumed,
    ok: consumed === n,
    message: consumed === n ? undefined : lastMessage,
  };
}
