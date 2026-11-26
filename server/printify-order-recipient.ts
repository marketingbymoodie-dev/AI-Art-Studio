/**
 * Shopify order → Printify address_to, and the manual-approval error codes.
 * Protected customer data is often absent from the webhook. Never invent a
 * recipient ("Customer" / a fake phone) when the street address is missing.
 */
import { shopToken } from "./checkout-guard";
import { normalizeMyshopifyShopDomain } from "./shopDomain";

export type PrintifyRecipient = {
  first_name: string;
  last_name: string;
  email?: string;
  phone?: string;
  country: string;
  region?: string;
  address1: string;
  address2?: string;
  city: string;
  zip: string;
};

const REQUIRED = ["first_name", "last_name", "email", "address1", "city", "zip", "country"] as const;

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function countryCode(shipping: any): string {
  const code = text(shipping?.country_code || shipping?.countryCodeV2);
  if (/^[a-z]{2}$/i.test(code)) return code.toUpperCase();
  const name = text(shipping?.country || shipping?.country_name).toLowerCase();
  if (name === "australia") return "AU";
  if (name === "united states" || name === "united states of america") return "US";
  if (name === "canada") return "CA";
  if (name === "united kingdom" || name === "great britain") return "GB";
  return "";
}

/** Map a Shopify order (webhook or REST) onto Printify's recipient. No placeholders. */
export function printifyAddressFromShopifyOrder(order: any): PrintifyRecipient {
  const shipping = order?.shipping_address || order?.customer?.default_address || {};
  const customer = order?.customer || {};
  return {
    first_name: text(shipping.first_name || shipping.firstName || customer.first_name || customer.firstName),
    last_name: text(shipping.last_name || shipping.lastName || customer.last_name || customer.lastName),
    email: text(order?.email || order?.contact_email || customer.email),
    phone: text(shipping.phone || order?.phone || customer.phone),
    country: countryCode(shipping),
    region: text(shipping.province_code || shipping.provinceCode || shipping.province),
    address1: text(shipping.address1),
    address2: text(shipping.address2),
    city: text(shipping.city),
    zip: text(shipping.zip || shipping.zipCode),
  };
}

/** Drop the old "Customer" / default-US placeholder when the street was never present. */
export function sanitizePrintifyRecipient(address: PrintifyRecipient): PrintifyRecipient {
  const next = { ...address };
  if (next.first_name === "Customer" && !next.address1) next.first_name = "";
  if (!next.address1 && !next.city && !next.zip && next.country === "US" && !next.region) next.country = "";
  return next;
}

export function mergePrintifyRecipient(primary: PrintifyRecipient, fallback: PrintifyRecipient): PrintifyRecipient {
  const out: PrintifyRecipient = { ...primary };
  (Object.keys(fallback) as (keyof PrintifyRecipient)[]).forEach((key) => {
    if (!text(out[key]) && text(fallback[key])) (out as any)[key] = fallback[key];
  });
  return out;
}

export function missingPrintifyRecipientFields(address: PrintifyRecipient): string[] {
  const missing = REQUIRED.filter((key) => !text(address[key]));
  if (text(address.country) && /^(AU|US|CA)$/i.test(address.country) && !text(address.region)) {
    missing.push("region");
  }
  return missing;
}

export type PrintifySubmitError = {
  code: number | null;
  /** Printify already created this order (8503) or included its id on the hold. */
  existingOrderId: string | null;
  /** Shop is on manual approval: send_to_production is refused while status is pending (8502). */
  manualHold: boolean;
};

export function classifyPrintifySubmitError(message: string): PrintifySubmitError {
  const codeMatch = String(message || "").match(/"code"\s*:\s*(\d+)/);
  const code = codeMatch ? Number(codeMatch[1]) : null;
  const orderMatch = String(message || "").match(/"order"\s*:\s*\{[^}]*"id"\s*:\s*"([^"]+)"/);
  const existingOrderId = orderMatch ? orderMatch[1] : null;
  const manualHold =
    code === 8502 ||
    /not allowed to sent order to production with status pending/i.test(String(message || ""));
  return {
    code,
    existingOrderId: existingOrderId || null,
    manualHold,
  };
}

/** Shops whose send_to_production returned 8502. Auto-approve shops never enter this set. */
const manualApprovalShops = new Set<string>();

export function rememberManualApprovalShop(printifyShopId: string): void {
  if (printifyShopId) manualApprovalShops.add(String(printifyShopId));
}

export function shopRequiresManualApproval(printifyShopId: string): boolean {
  return manualApprovalShops.has(String(printifyShopId));
}

function numericId(id: string): string {
  const match = String(id || "").match(/(\d+)\s*$/);
  return match ? match[1] : "";
}

/** Admin REST order. Protected fields stay empty until Shopify approves them. */
export async function fetchShopifyOrderRecipient(shop: string, orderId: string): Promise<PrintifyRecipient | null> {
  const domain = normalizeMyshopifyShopDomain(shop);
  const id = numericId(orderId);
  if (!domain || !id) return null;
  try {
    const token = await shopToken(domain);
    const res = await fetch(
      `https://${domain}/admin/api/2026-07/orders/${id}.json?fields=id,email,phone,shipping_address,customer`,
      { headers: { "X-Shopify-Access-Token": token } },
    );
    if (!res.ok) return null;
    const body = await res.json().catch(() => ({}));
    return body?.order ? printifyAddressFromShopifyOrder(body.order) : null;
  } catch (err: any) {
    console.warn("[flat-order-fulfillment] order address lookup failed:", err?.message || err);
    return null;
  }
}
