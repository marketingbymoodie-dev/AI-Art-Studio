import {
  isSafeCreatorReturnUrl,
  normalizeCreatorUsername,
  sanitizeCreatorReturnUrl,
} from "./creatorMarketplace";

export const LAST_CREATOR_STORAGE_KEY = "appai_last_creator";
export const LAST_CREATOR_COOKIE = "appai_last_creator";
export const CREATOR_SHOPS_STORAGE_KEY = "appai_creator_shops";
export const MAX_CREATOR_SHOP_VISITS = 20;

export type LastCreatorVisit = {
  username: string;
  shopName: string;
  returnUrl: string;
  visitedAt: number;
};

export function parseLastCreatorVisit(raw: unknown): LastCreatorVisit | null {
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed !== "object") return null;
    const username = normalizeCreatorUsername(String((parsed as LastCreatorVisit).username || ""));
    const returnUrl = String((parsed as LastCreatorVisit).returnUrl || "").trim();
    if (!username || !returnUrl || returnUrl.indexOf("https://") !== 0) return null;
    if (!isSafeCreatorReturnUrl(returnUrl)) return null;
    const shopName = String((parsed as LastCreatorVisit).shopName || username).trim().slice(0, 120);
    const visitedAt = Number((parsed as LastCreatorVisit).visitedAt) || Date.now();
    return { username, shopName: shopName || username, returnUrl, visitedAt };
  } catch {
    return null;
  }
}

export function serializeLastCreatorVisit(visit: LastCreatorVisit): string {
  return JSON.stringify({
    username: visit.username,
    shopName: visit.shopName.slice(0, 120),
    returnUrl: visit.returnUrl.slice(0, 255),
    visitedAt: visit.visitedAt,
  });
}

export function readLastCreatorVisit(): LastCreatorVisit | null {
  if (typeof window === "undefined") return null;
  try {
    return parseLastCreatorVisit(window.localStorage.getItem(LAST_CREATOR_STORAGE_KEY));
  } catch {
    return null;
  }
}

/** True when the stored label is just the URL handle, not a public shop name. */
export function isHandleLikeShopName(shopName: string, username: string): boolean {
  const raw = String(shopName || "").trim();
  if (!raw) return true;
  if (/\s/.test(raw)) return false;
  const name = raw.toLowerCase().replace(/[_-]+/g, "");
  const handle = String(username || "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, "");
  return !!handle && name === handle;
}

export function writeLastCreatorVisit(input: {
  username: string;
  shopName?: string;
  returnUrl: string;
}): LastCreatorVisit | null {
  const username = normalizeCreatorUsername(String(input.username || ""));
  const returnUrl = sanitizeCreatorReturnUrl(input.returnUrl, "");
  if (!username || !returnUrl) return null;
  const visit: LastCreatorVisit = {
    username,
    shopName: String(input.shopName || username).trim().slice(0, 120) || username,
    returnUrl,
    visitedAt: Date.now(),
  };
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(LAST_CREATOR_STORAGE_KEY, serializeLastCreatorVisit(visit));
    } catch {
      /* ignore quota */
    }
  }
  upsertCreatorShopVisit(visit);
  return visit;
}

export function parseCreatorShopVisits(raw: unknown): LastCreatorVisit[] {
  let list: unknown[] = [];
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) list = parsed;
    } catch {
      return [];
    }
  } else if (Array.isArray(raw)) {
    list = raw;
  }
  const out: LastCreatorVisit[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    const visit = parseLastCreatorVisit(item);
    if (!visit || seen.has(visit.username)) continue;
    seen.add(visit.username);
    out.push(visit);
  }
  return out
    .sort((a, b) => b.visitedAt - a.visitedAt)
    .slice(0, MAX_CREATOR_SHOP_VISITS);
}

export function readCreatorShopVisits(): LastCreatorVisit[] {
  if (typeof window === "undefined") return [];
  try {
    const listed = parseCreatorShopVisits(window.localStorage.getItem(CREATOR_SHOPS_STORAGE_KEY));
    const last = readLastCreatorVisit();
    if (!last) return listed;
    return parseCreatorShopVisits([last, ...listed]);
  } catch {
    return [];
  }
}

export function upsertCreatorShopVisit(visit: LastCreatorVisit): LastCreatorVisit[] {
  const next = parseCreatorShopVisits([visit, ...readCreatorShopVisits()]);
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(
        CREATOR_SHOPS_STORAGE_KEY,
        JSON.stringify(next.map((v) => JSON.parse(serializeLastCreatorVisit(v)))),
      );
    } catch {
      /* ignore quota */
    }
  }
  return next;
}

export function otherCreatorShopVisits(currentUsername: string): LastCreatorVisit[] {
  const current = normalizeCreatorUsername(currentUsername);
  return readCreatorShopVisits().filter((v) => v.username && v.username !== current);
}

/** Same-origin shop home. Open with target=_top from the designer iframe. */
export function creatorShopPath(username: string): string {
  const handle = normalizeCreatorUsername(username);
  return handle ? `/c/${handle}` : "/";
}

/** Bounce through the shop app proxy so a cookie is set on the Shopify origin. */
export function creatorCheckoutRememberUrl(opts: {
  checkoutUrl: string;
  username: string;
  shopName: string;
  returnUrl: string;
}): string {
  try {
    const checkout = new URL(opts.checkoutUrl);
    if (checkout.protocol !== "https:") return opts.checkoutUrl;
    const bounce = new URL("/apps/appai/remember-creator", checkout.origin);
    bounce.searchParams.set("username", opts.username);
    bounce.searchParams.set("name", opts.shopName);
    bounce.searchParams.set("return", opts.returnUrl);
    bounce.searchParams.set("next", opts.checkoutUrl);
    return bounce.toString();
  } catch {
    return opts.checkoutUrl;
  }
}

export function isSafeShopifyCheckoutNext(next: string, shop: string): boolean {
  try {
    const u = new URL(next);
    if (u.protocol !== "https:") return false;
    const host = u.hostname.toLowerCase();
    const shopHost = String(shop || "").toLowerCase().replace(/^https?:\/\//, "").split("/")[0];
    if (!shopHost) return false;
    if (host !== shopHost) return false;
    return u.pathname.startsWith("/checkouts/") || u.pathname.startsWith("/cart") || u.pathname === "/";
  } catch {
    return false;
  }
}
