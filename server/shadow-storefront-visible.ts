/**
 * Real storefront readiness: Ajax GET /variants/{id}.js, the same catalog
 * /cart/add.js reads. Admin publish 200 is not this.
 *
 * Degrade: 5xx / 429 / network on an Admin-live (UNLISTED/ACTIVE) variant
 * is a flaky probe, not "unpublished". Those fall through to success.
 * 404 / empty JSON is a real miss and stays still_preparing.
 */
export const SHADOW_STOREFRONT_VISIBLE_WAITS_MS = [
  800, 1200, 1600, 2000, 2500, 3000,
] as const;

export class ShadowStorefrontNotReadyError extends Error {
  readonly code = "still_preparing" as const;
  constructor(
    message: string,
    readonly variantId: string,
    readonly probe: string,
  ) {
    super(message);
    this.name = "ShadowStorefrontNotReadyError";
  }
}

export function parseAjaxVariantJson(text: string, variantId: string): boolean {
  const trimmed = String(text || "").trim();
  if (!trimmed.startsWith("{")) return false;
  try {
    const json = JSON.parse(trimmed) as { id?: unknown };
    return String(json.id || "").replace(/\D/g, "") === String(variantId).replace(/\D/g, "");
  } catch {
    return false;
  }
}

export function isStorefrontPasswordHtml(text: string, contentType: string): boolean {
  const ct = String(contentType || "").toLowerCase();
  if (ct.includes("application/json")) return false;
  const head = String(text || "").slice(0, 2500);
  return /storefront_password|name="password"|\/password/i.test(head);
}

export type AjaxVariantProbe = "visible" | "missing" | "password" | "error";

/** Classify an Ajax probe HTTP outcome. 429/5xx are flakes, not unpublished. */
export function classifyAjaxVariantResponse(opts: {
  status: number;
  text: string;
  contentType: string;
  variantId: string;
}): AjaxVariantProbe {
  if (parseAjaxVariantJson(opts.text, opts.variantId)) return "visible";
  if (opts.status === 429 || opts.status >= 500) return "error";
  if (opts.status === 404) return "missing";
  if (isStorefrontPasswordHtml(opts.text, opts.contentType) || /<html/i.test(opts.text)) {
    return "password";
  }
  return "missing";
}

export function storefrontPasswordConfigured(): boolean {
  return !!(process.env.SHOPIFY_STOREFRONT_PASSWORD || process.env.STOREFRONT_PASSWORD);
}

export async function probeAjaxVariantVisible(
  shop: string,
  variantId: string,
  cookie?: string,
): Promise<AjaxVariantProbe> {
  const numeric = String(variantId || "").replace(/\D/g, "");
  if (!numeric || !shop) return "missing";
  try {
    const res = await fetch(`https://${shop}/variants/${numeric}.js`, {
      headers: {
        Accept: "application/json",
        ...(cookie ? { Cookie: cookie } : {}),
      },
    });
    const text = await res.text();
    return classifyAjaxVariantResponse({
      status: res.status,
      text,
      contentType: res.headers.get("content-type") || "",
      variantId: numeric,
    });
  } catch (e: any) {
    console.warn(
      `[ShadowProduct] Ajax /variants/${numeric}.js probe error:`,
      e?.message || e,
    );
    return "error";
  }
}

async function storefrontPasswordCookie(shop: string): Promise<string | undefined> {
  const pw = process.env.SHOPIFY_STOREFRONT_PASSWORD || process.env.STOREFRONT_PASSWORD;
  if (!pw) return undefined;
  const pwRes = await fetch(`https://${shop}/password`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    redirect: "manual",
    body: `form_type=storefront_password&utf8=%E2%9C%93&password=${encodeURIComponent(pw)}`,
  });
  const raw = typeof pwRes.headers.getSetCookie === "function"
    ? pwRes.headers.getSetCookie()
    : pwRes.headers.get("set-cookie")
      ? [pwRes.headers.get("set-cookie")!]
      : [];
  const cookie = raw.map((c) => String(c).split(";")[0]).filter(Boolean).join("; ");
  return cookie || undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function awaitAjaxVariantVisible(opts: {
  shop: string;
  variantId: string | number;
  adminLive?: boolean;
}): Promise<{ visible: boolean; probe: AjaxVariantProbe | "timeout"; degraded?: boolean }> {
  const shop = String(opts.shop || "").trim();
  const variantId = String(opts.variantId || "").replace(/\D/g, "");
  const adminLive = opts.adminLive !== false;
  console.log(
    `[ShadowProduct] Ajax probe unlock configured=${storefrontPasswordConfigured()} variant=${variantId}`,
  );
  let cookie: string | undefined;
  try {
    cookie = await storefrontPasswordCookie(shop);
  } catch (e: any) {
    console.warn(`[ShadowProduct] storefront password unlock failed:`, e?.message || e);
  }
  if (storefrontPasswordConfigured() && !cookie) {
    console.warn(`[ShadowProduct] password env is set but unlock did not return a cookie`);
  }

  let last: AjaxVariantProbe = "missing";
  for (let i = 0; i <= SHADOW_STOREFRONT_VISIBLE_WAITS_MS.length; i++) {
    last = await probeAjaxVariantVisible(shop, variantId, cookie);
    if (last === "visible") {
      console.log(`[ShadowProduct] variant ${variantId} storefront-visible via /variants/{id}.js`);
      return { visible: true, probe: "visible" };
    }
    if (last === "password" && !cookie) {
      console.warn(
        `[ShadowProduct] variant ${variantId} Ajax probe password-gated — set SHOPIFY_STOREFRONT_PASSWORD for a real gate`,
      );
      return { visible: false, probe: "password" };
    }
    if (last === "error" && adminLive) {
      console.warn(
        `[ShadowProduct] variant ${variantId} Ajax probe flaked (5xx/429/network) on Admin-live shadow — degrading to success`,
      );
      return { visible: true, probe: "error", degraded: true };
    }
    const wait = SHADOW_STOREFRONT_VISIBLE_WAITS_MS[i];
    if (wait == null) break;
    await sleep(wait);
  }
  if (last === "error" && adminLive) {
    console.warn(
      `[ShadowProduct] variant ${variantId} Ajax probe still flaking after poll — degrading to Admin live`,
    );
    return { visible: true, probe: "error", degraded: true };
  }
  console.warn(`[ShadowProduct] variant ${variantId} not Ajax-visible after poll (last=${last})`);
  return { visible: false, probe: last === "missing" ? "timeout" : last };
}

export async function assertAjaxVariantVisible(opts: {
  shop: string;
  variantId: string | number;
  adminLive?: boolean;
}): Promise<void> {
  const variantId = String(opts.variantId || "").replace(/\D/g, "");
  const result = await awaitAjaxVariantVisible(opts);
  if (result.visible) return;
  throw new ShadowStorefrontNotReadyError(
    `Shadow variant ${variantId} is not yet queryable on the storefront (probe=${result.probe})`,
    variantId,
    String(result.probe),
  );
}
