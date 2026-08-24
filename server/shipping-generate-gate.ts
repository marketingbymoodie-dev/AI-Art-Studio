/**
 * Phase 4 Slice A/B — storefront generate coverage gate.
 * Returns a 409 body the route must send BEFORE job create / credit spend.
 * Country must be the middleware-resolved req.shipCountry (cookie > IP > US).
 */
import {
  shippingGenerateBlockResponse,
  type ShippingGenerate409,
} from "@shared/shipping-size-coverage";
import { lookupSizeCountryCoverage } from "./shipping-size-coverage";
import {
  DEFAULT_SHIP_COUNTRY,
  SHIP_COUNTRY_COOKIE,
  normalizeShipCountry,
} from "@shared/ship-country";
import { readShipCountryCookie } from "./ship-country-middleware";

export { SHIP_COUNTRY_COOKIE, DEFAULT_SHIP_COUNTRY, normalizeShipCountry };

export type { ShippingGenerate409 };
export { shippingGenerateBlockResponse };

/** Prefer middleware attachment; fall back to cookie then US. Never trust a client body country. */
export function resolveShipCountryFromRequest(req: {
  shipCountry?: string;
  cookies?: Record<string, unknown>;
  headers?: { cookie?: string };
}): string {
  const attached = normalizeShipCountry(req.shipCountry);
  if (attached && attached !== "ROW") return attached;
  const cookie = readShipCountryCookie(req as any);
  if (cookie && cookie !== "ROW") return cookie;
  return DEFAULT_SHIP_COUNTRY;
}

export async function lookupAndBlockStorefrontGenerate(params: {
  productTypeId: unknown;
  size: unknown;
  color?: unknown;
  country: string;
}): Promise<ShippingGenerate409 | null> {
  const productTypeId = Number(params.productTypeId);
  const id = Number.isFinite(productTypeId) && productTypeId > 0 ? productTypeId : 0;
  const verdict = await lookupSizeCountryCoverage({
    productTypeId: id,
    size: params.size != null ? String(params.size) : "",
    color: params.color != null && String(params.color).trim() ? String(params.color) : null,
    country: params.country,
  });
  return shippingGenerateBlockResponse(verdict, id || null);
}
