import type { Request, Response } from "express";
import {
  normalizeCreatorUsername,
  sanitizeCreatorReturnUrl,
} from "@shared/creatorMarketplace";
import {
  isSafeShopifyCheckoutNext,
  serializeLastCreatorVisit,
} from "@shared/lastCreatorVisit";

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeJs(s: string): string {
  return String(s)
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/"/g, "\\\"")
    .replace(/</g, "\\u003c")
    .replace(/\n/g, "\\n");
}

/**
 * App-proxy HTML bounce: set last-creator cookie on the Shopify shop origin,
 * then send the shopper on to checkout. Theme JS reads the cookie on the
 * store homepage after Shopify's native "Continue shopping".
 */
export function handleRememberCreatorProxy(req: Request, res: Response): void {
  const shop = String((req as any).proxyShop || req.query.shop || "");
  const username = normalizeCreatorUsername(String(req.query.username || ""));
  const shopName = String(req.query.name || username || "").trim().slice(0, 120);
  const returnUrl = sanitizeCreatorReturnUrl(req.query.return, username ? `https://aiartstudio.app/c/${username}` : "");
  const nextRaw = String(req.query.next || "").trim();
  const next = isSafeShopifyCheckoutNext(nextRaw, shop) ? nextRaw : "";

  if (!username || !returnUrl) {
    res.status(400).type("text/plain").send("Missing creator");
    return;
  }

  const visit = {
    username,
    shopName: shopName || username,
    returnUrl,
    visitedAt: Date.now(),
  };
  const cookieVal = encodeURIComponent(serializeLastCreatorVisit(visit));
  const dest = next || returnUrl;

  res.setHeader(
    "Set-Cookie",
    `appai_last_creator=${cookieVal}; Path=/; Max-Age=2592000; SameSite=Lax`,
  );
  res.setHeader("Cache-Control", "no-store");
  res.status(200).type("text/html").send(`<!doctype html>
<html><head><meta charset="utf-8"><title>Continue to checkout</title></head>
<body>
<script>
(function(){
  try {
    document.cookie = 'appai_last_creator=${escapeJs(cookieVal)}; Path=/; Max-Age=2592000; SameSite=Lax';
  } catch (e) {}
  location.replace('${escapeJs(dest)}');
})();
</script>
<p><a href="${escapeHtml(dest)}">Continue</a></p>
</body></html>`);
}
