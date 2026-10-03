/**
 * Base-variant checkout guard: installs the `appai-base-variant-guard` cart &
 * checkout validation Function on a shop.
 *
 * Fail-open is a hard requirement: `blockOnFailure` is always false, so a
 * Function runtime failure (timeout, instruction limit) lets checkout proceed
 * instead of blocking every checkout on the store. Validation errors the
 * Function returns on purpose still block. `ensureBaseVariantGuard` forces
 * blockOnFailure back to false if it was ever switched on, but never
 * re-enables a validation the merchant turned off.
 *
 * Needs the write_validations scope (staging TOML only for now).
 */
import { storage } from "./storage";
import { ensureValidOfflineAccessToken } from "./shopify-offline-token";

export const BASE_VARIANT_GUARD_HANDLE = "appai-base-variant-guard";
export const BASE_VARIANT_GUARD_TITLE = "AppAI — design required";
const ADMIN_API = "2026-07";

export type GuardValidation = {
  id: string;
  title: string;
  enabled: boolean;
  blockOnFailure: boolean;
  functionTitle?: string | null;
};

export type GuardStatus = {
  shop: string;
  state: "created" | "fixed-fail-open" | "ok" | "disabled-by-merchant" | "missing-scope" | "error";
  validation?: GuardValidation | null;
  error?: string;
};

async function adminGraphql<T = any>(shop: string, token: string, query: string, variables?: unknown): Promise<T> {
  const res = await fetch(`https://${shop}/admin/api/${ADMIN_API}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(15_000),
  });
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok || body?.errors) {
    throw new Error(`Admin GraphQL ${res.status}: ${JSON.stringify(body?.errors ?? body).slice(0, 300)}`);
  }
  return body.data as T;
}

function userErrorsOf(payload: any): string | null {
  const errs: Array<{ message?: string }> = payload?.userErrors ?? [];
  return errs.length ? errs.map((e) => e.message).join("; ") : null;
}

/** Pick our validation out of the shop's list (by title we set, or our function's title). */
export function findGuardValidation(nodes: GuardValidation[]): GuardValidation | null {
  return (
    nodes.find((n) => n.title === BASE_VARIANT_GUARD_TITLE) ||
    nodes.find((n) => n.functionTitle === "AppAI design required") ||
    null
  );
}

async function shopToken(shop: string): Promise<{ token: string; scopes: string }> {
  const inst = await storage.getShopifyInstallationByShop(shop);
  if (!inst?.accessToken || inst.accessToken === "NEEDS_RECONNECT") throw new Error(`No token for ${shop}`);
  const refreshed = await ensureValidOfflineAccessToken(inst);
  if (!refreshed.ok) throw new Error(`Token unavailable for ${shop}: ${refreshed.error}`);
  return { token: refreshed.accessToken, scopes: String(refreshed.installation.scope ?? inst.scope ?? "") };
}

async function readGuard(shop: string, token: string): Promise<GuardValidation | null> {
  const data = await adminGraphql<any>(
    shop,
    token,
    `{ validations(first: 50) { nodes { id title enabled blockOnFailure shopifyFunction { title } } } }`,
  );
  const nodes: GuardValidation[] = (data?.validations?.nodes ?? []).map((n: any) => ({
    id: n.id,
    title: n.title,
    enabled: !!n.enabled,
    blockOnFailure: !!n.blockOnFailure,
    functionTitle: n.shopifyFunction?.title ?? null,
  }));
  return findGuardValidation(nodes);
}

export async function getBaseVariantGuardStatus(shop: string): Promise<GuardStatus> {
  try {
    const { token } = await shopToken(shop);
    const v = await readGuard(shop, token);
    if (!v) return { shop, state: "error", validation: null, error: "not installed" };
    return { shop, state: v.enabled ? "ok" : "disabled-by-merchant", validation: v };
  } catch (e: any) {
    return { shop, state: "error", error: String(e?.message || e) };
  }
}

export async function ensureBaseVariantGuard(shop: string): Promise<GuardStatus> {
  try {
    const { token, scopes } = await shopToken(shop);
    if (scopes && !scopes.split(",").map((s) => s.trim()).includes("write_validations")) {
      return { shop, state: "missing-scope", error: "write_validations not granted" };
    }
    const existing = await readGuard(shop, token);
    if (!existing) {
      const data = await adminGraphql<any>(
        shop,
        token,
        `mutation($validation: ValidationCreateInput!) {
          validationCreate(validation: $validation) {
            validation { id title enabled blockOnFailure }
            userErrors { field message }
          }
        }`,
        {
          validation: {
            functionHandle: BASE_VARIANT_GUARD_HANDLE,
            title: BASE_VARIANT_GUARD_TITLE,
            enable: true,
            blockOnFailure: false,
          },
        },
      );
      const err = userErrorsOf(data?.validationCreate);
      if (err) return { shop, state: "error", error: err };
      const v = data.validationCreate.validation;
      console.log(`[checkout-guard] ${shop}: created validation ${v.id} enabled=${v.enabled} blockOnFailure=${v.blockOnFailure}`);
      return { shop, state: "created", validation: v };
    }
    if (existing.blockOnFailure) {
      const data = await adminGraphql<any>(
        shop,
        token,
        `mutation($id: ID!, $validation: ValidationUpdateInput!) {
          validationUpdate(id: $id, validation: $validation) {
            validation { id title enabled blockOnFailure }
            userErrors { field message }
          }
        }`,
        { id: existing.id, validation: { blockOnFailure: false, enable: existing.enabled } },
      );
      const err = userErrorsOf(data?.validationUpdate);
      if (err) return { shop, state: "error", validation: existing, error: err };
      console.warn(`[checkout-guard] ${shop}: blockOnFailure was true — forced back to fail-open`);
      return { shop, state: "fixed-fail-open", validation: data.validationUpdate.validation };
    }
    return { shop, state: existing.enabled ? "ok" : "disabled-by-merchant", validation: existing };
  } catch (e: any) {
    return { shop, state: "error", error: String(e?.message || e) };
  }
}

/** Boot sweep: ensure the guard on every active shop whose token carries write_validations. */
export async function ensureBaseVariantGuardAllShops(): Promise<GuardStatus[]> {
  const all = await storage.getAllShopifyInstallations();
  const out: GuardStatus[] = [];
  for (const inst of all) {
    if (inst.status !== "active") continue;
    const scopes = String((inst as any).scope ?? "");
    if (!scopes.includes("write_validations")) continue;
    const status = await ensureBaseVariantGuard(inst.shopDomain);
    if (status.state !== "ok") console.log(`[checkout-guard] ${inst.shopDomain}: ${status.state}${status.error ? ` — ${status.error}` : ""}`);
    out.push(status);
  }
  return out;
}
