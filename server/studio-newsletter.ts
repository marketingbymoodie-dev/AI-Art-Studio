/**
 * Studio Art Class newsletter — platform-owned list + optional platform-funded credit.
 */
import { desc, eq } from "drizzle-orm";
import { studioNewsletterSubscribers } from "@shared/schema";
import { db } from "./db";
import {
  normalizeEmail,
  isDisposableEmail,
  tryGrantEmailSignup,
} from "./reward-ladder";

export const NEWSLETTER_SOURCES = ["merchant", "creator", "store_user"] as const;
export type NewsletterSource = (typeof NEWSLETTER_SOURCES)[number];

export const NEWSLETTER_SOURCE_LABELS: Record<NewsletterSource, string> = {
  merchant: "Merchant",
  creator: "Creator",
  store_user: "Store user",
};

export function isNewsletterSource(value: string): value is NewsletterSource {
  return (NEWSLETTER_SOURCES as readonly string[]).includes(value);
}

export type SubscribeNewsletterInput = {
  email: string;
  source: NewsletterSource;
  shopDomain?: string | null;
  creatorUsername?: string | null;
  customerId?: string | null;
};

export type SubscribeNewsletterResult = {
  ok: true;
  alreadySubscribed: boolean;
  creditGranted: boolean;
  creditAmount: number;
};

export async function subscribeToStudioNewsletter(
  input: SubscribeNewsletterInput,
): Promise<SubscribeNewsletterResult | { ok: false; reason: string }> {
  const email = normalizeEmail(input.email);
  if (!email) return { ok: false, reason: "Enter a valid email address." };
  if (isDisposableEmail(email)) {
    return { ok: false, reason: "Please use a lasting email address." };
  }

  const shopDomain = input.shopDomain?.trim() || null;
  const creatorUsername = input.creatorUsername?.trim() || null;
  const customerId = input.customerId?.trim() || null;

  const existing = await db
    .select()
    .from(studioNewsletterSubscribers)
    .where(eq(studioNewsletterSubscribers.email, email))
    .limit(1);

  let row = existing[0] ?? null;
  if (!row) {
    const inserted = await db
      .insert(studioNewsletterSubscribers)
      .values({
        email,
        source: input.source,
        shopDomain,
        creatorUsername,
        customerId,
        creditGranted: false,
      })
      .onConflictDoNothing()
      .returning();
    row = inserted[0] ?? null;
    if (!row) {
      const again = await db
        .select()
        .from(studioNewsletterSubscribers)
        .where(eq(studioNewsletterSubscribers.email, email))
        .limit(1);
      row = again[0] ?? null;
    }
  } else {
    await db
      .update(studioNewsletterSubscribers)
      .set({
        shopDomain: shopDomain || row.shopDomain,
        creatorUsername: creatorUsername || row.creatorUsername,
        customerId: customerId || row.customerId,
        updatedAt: new Date(),
      })
      .where(eq(studioNewsletterSubscribers.id, row.id));
  }

  if (!row) return { ok: false, reason: "Could not save your email." };

  const alreadySubscribed = existing.length > 0;

  // Already on the list: return immediately so the UI can flag the duplicate.
  // Do not block this request on a credit grant (that path was hanging the spinner).
  if (alreadySubscribed) {
    return {
      ok: true,
      alreadySubscribed: true,
      creditGranted: !!row.creditGranted,
      creditAmount: 0,
    };
  }

  const grantShop = shopDomain || row.shopDomain;
  const grantCustomer = customerId || row.customerId;
  let creditGranted = row.creditGranted;
  let creditAmount = 0;

  if (!creditGranted && grantShop && grantCustomer) {
    const granted = await tryGrantEmailSignup(grantShop, grantCustomer, email);
    if (granted.granted) {
      creditGranted = true;
      creditAmount = granted.amount;
      await db
        .update(studioNewsletterSubscribers)
        .set({
          creditGranted: true,
          customerId: grantCustomer,
          shopDomain: grantShop,
          updatedAt: new Date(),
        })
        .where(eq(studioNewsletterSubscribers.id, row.id));
    } else if (granted.duplicate) {
      creditGranted = true;
      await db
        .update(studioNewsletterSubscribers)
        .set({ creditGranted: true, updatedAt: new Date() })
        .where(eq(studioNewsletterSubscribers.id, row.id));
    }
  }

  return {
    ok: true,
    alreadySubscribed: false,
    creditGranted,
    creditAmount,
  };
}

/** After storefront sign-in, grant the newsletter credit if they already joined the list. */
export async function tryGrantNewsletterCreditAfterAuth(
  shop: string,
  customerId: string,
  email: string | null | undefined,
): Promise<void> {
  const norm = normalizeEmail(email);
  if (!norm || !shop || !customerId) return;
  const [row] = await db
    .select()
    .from(studioNewsletterSubscribers)
    .where(eq(studioNewsletterSubscribers.email, norm))
    .limit(1);
  if (!row || row.creditGranted) return;
  const granted = await tryGrantEmailSignup(shop, customerId, norm);
  if (granted.granted || granted.duplicate) {
    await db
      .update(studioNewsletterSubscribers)
      .set({
        creditGranted: true,
        customerId,
        shopDomain: shop,
        updatedAt: new Date(),
      })
      .where(eq(studioNewsletterSubscribers.id, row.id));
  }
}

export async function listStudioNewsletterSubscribers(limit = 500) {
  const rows = await db
    .select()
    .from(studioNewsletterSubscribers)
    .orderBy(desc(studioNewsletterSubscribers.createdAt))
    .limit(Math.min(1000, Math.max(1, limit)));
  return rows.map((row) => ({
    id: row.id,
    email: row.email,
    source: row.source,
    sourceLabel: NEWSLETTER_SOURCE_LABELS[row.source as NewsletterSource] || row.source,
    shopDomain: row.shopDomain,
    creatorUsername: row.creatorUsername,
    customerId: row.customerId,
    creditGranted: row.creditGranted,
    createdAt: row.createdAt,
  }));
}
