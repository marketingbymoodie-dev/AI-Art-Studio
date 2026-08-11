/**
 * Last week of the calendar month: email merchants who still have unused
 * included generations, suggesting coupon promos.
 */
import { storage } from "./storage";
import { peekMerchantGenerationQuota } from "./generation-quota";
import { resolveGenerationQuota, getEffectivePlan } from "./customizer-plans";
import type { ShopifyInstallation } from "@shared/schema";

const TAG = "[leftover-gens-reminder]";
const SCAN_GUARD_MS = 20 * 60 * 60 * 1000;

function daysLeftInUtcMonth(now = new Date()): number {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return lastDay - now.getUTCDate();
}

async function shopOwnerEmail(installation: ShopifyInstallation): Promise<string | null> {
  if (!installation.accessToken) return null;
  try {
    const resp = await fetch(`https://${installation.shopDomain}/admin/api/2024-10/shop.json`, {
      headers: {
        "X-Shopify-Access-Token": installation.accessToken,
        "Content-Type": "application/json",
      },
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const email = String(data?.shop?.email || data?.shop?.customer_email || "").trim();
    return email || null;
  } catch {
    return null;
  }
}

async function sendLeftoverEmail(params: {
  to: string;
  shopDomain: string;
  remaining: number;
  includedLimit: number;
  daysLeft: number;
}): Promise<boolean> {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    console.warn(`${TAG} RESEND_API_KEY not set — skipping email`);
    return false;
  }
  const body = [
    `You still have ${params.remaining} of ${params.includedLimit} included AI generations left this month on ${params.shopDomain}.`,
    ``,
    `There ${params.daysLeft === 1 ? "is 1 day" : `are ${params.daysLeft} days`} left in the billing month.`,
    ``,
    `Tip: create a coupon in AppAI → Coupons to gift free generations for a promotion. Coupon credits are taken from your monthly allotment when customers redeem them.`,
    ``,
    `Open Coupons in your AppAI admin to set one up.`,
  ].join("\n");

  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.APP_TRANSACTIONAL_FROM || "AppAI <onboarding@resend.dev>",
        to: [params.to],
        subject: `[AppAI] ${params.remaining} generations left this month — try a coupon promo`,
        text: body,
      }),
    });
    if (!resp.ok) {
      console.error(`${TAG} Resend error ${resp.status}:`, await resp.text());
      return false;
    }
    return true;
  } catch (err: any) {
    console.error(`${TAG} email failed:`, err?.message ?? err);
    return false;
  }
}

let lastRunAt = 0;

export async function runLeftoverGensReminders(opts: { force?: boolean } = {}): Promise<{
  ran: boolean;
  checked: number;
  emailed: number;
}> {
  const now = new Date();
  const daysLeft = daysLeftInUtcMonth(now);
  if (!opts.force && daysLeft > 7) {
    return { ran: false, checked: 0, emailed: 0 };
  }
  if (!opts.force && Date.now() - lastRunAt < SCAN_GUARD_MS) {
    console.log(`${TAG} Skipping — ran recently`);
    return { ran: false, checked: 0, emailed: 0 };
  }
  lastRunAt = Date.now();

  const bucketKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const installations = (await storage.getAllShopifyInstallations()).filter(
    (i) => i.status === "active",
  );

  let checked = 0;
  let emailed = 0;

  for (const installation of installations) {
    if ((installation as any).leftoverGensReminderBucketKey === bucketKey) continue;

    const eff = getEffectivePlan(installation as any, installation.shopDomain);
    if (!eff.isActive || !eff.planName || eff.planName === "trial") continue;

    const quota = resolveGenerationQuota(eff.planName, eff.isActive);
    if (!quota.monthly || quota.freeQuota <= 0) continue;

    checked++;
    const peek = await peekMerchantGenerationQuota(installation);
    if (peek.unlimited || peek.includedRemaining < 20) continue;
    const meaningful =
      peek.includedRemaining >= 20 ||
      peek.includedRemaining / Math.max(1, peek.includedLimit) >= 0.15;
    if (!meaningful) continue;

    const to = await shopOwnerEmail(installation);
    if (!to) {
      console.warn(`${TAG} no shop email for ${installation.shopDomain}`);
      continue;
    }

    const sent = await sendLeftoverEmail({
      to,
      shopDomain: installation.shopDomain,
      remaining: peek.includedRemaining,
      includedLimit: peek.includedLimit,
      daysLeft: Math.max(1, daysLeft),
    });
    if (sent) {
      emailed++;
      await storage.updateShopifyInstallation(installation.id, {
        leftoverGensReminderBucketKey: bucketKey,
      } as any);
    }
  }

  console.log(`${TAG} done checked=${checked} emailed=${emailed} daysLeft=${daysLeft}`);
  return { ran: true, checked, emailed };
}
