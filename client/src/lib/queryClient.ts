/**
 * API client for all /api/* requests.
 *
 * Auth strategy:
 *   In embedded Shopify Admin, App Bridge v4 exposes `shopify.idToken()`.
 *   Session JWTs expire in about a minute — a long Create Page wizard can
 *   outlive a token that was only injected by the fetch monkey-patch.
 *   We mint a fresh idToken on each request (and retry once on 401).
 *
 *   In non-embedded mode (customer storefront, dev), cookie-based auth is
 *   used via credentials: "include".
 */
import { QueryClient, QueryFunction } from "@tanstack/react-query";

async function getFreshShopifySessionToken(): Promise<string | null> {
  const shopify = (window as { shopify?: { idToken?: () => Promise<string> } }).shopify;
  if (!shopify?.idToken) return null;
  try {
    const token = await shopify.idToken();
    return typeof token === "string" && token.trim() ? token : null;
  } catch {
    return null;
  }
}

export function isSessionAuthError(raw: unknown): boolean {
  const text =
    typeof raw === "string"
      ? raw
      : raw instanceof Error
        ? raw.message
        : raw != null
          ? String(raw)
          : "";
  return /401:|Unauthorized|invalid token|missing session token|REAUTH_REQUIRED/i.test(text);
}

// ─────────────────────────────────────────────────────────────────────────────
// apiFetch — attach a fresh App Bridge session token when available.
// ─────────────────────────────────────────────────────────────────────────────

export async function apiFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const token = await getFreshShopifySessionToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  let res = await fetch(input, { ...init, headers, credentials: "include" });
  if (res.status === 401 && token) {
    const retryToken = await getFreshShopifySessionToken();
    if (retryToken) {
      headers.set("Authorization", `Bearer ${retryToken}`);
      res = await fetch(input, { ...init, headers, credentials: "include" });
    }
  }
  return res;
}

// ─────────────────────────────────────────────────────────────────────────────
// apiRequest — convenience wrapper for mutations
// ─────────────────────────────────────────────────────────────────────────────

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

/** Turn `apiRequest` errors (`"400: {...}"`) into a short user-facing message. */
export function parseApiErrorMessage(raw: unknown): string {
  const text =
    typeof raw === "string"
      ? raw
      : raw instanceof Error
        ? raw.message
        : raw != null
          ? String(raw)
          : "";
  const jsonStart = text.indexOf("{");
  if (jsonStart !== -1) {
    try {
      const parsed = JSON.parse(text.slice(jsonStart)) as { error?: string; message?: string };
      if (typeof parsed.error === "string" && parsed.error.trim()) return parsed.error;
      if (typeof parsed.message === "string" && parsed.message.trim()) return parsed.message;
    } catch {
      /* fall through */
    }
  }
  return text.replace(/^\d{3}:\s*/, "").trim() || text || "Something went wrong";
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown,
): Promise<Response> {
  const res = await apiFetch(url, {
    method,
    body: data !== undefined ? JSON.stringify(data) : undefined,
  });
  await throwIfResNotOk(res);
  return res;
}

// ─────────────────────────────────────────────────────────────────────────────
// React Query helpers
// ─────────────────────────────────────────────────────────────────────────────

type UnauthorizedBehavior = "returnNull" | "throw";

export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const url = queryKey[0] as string;
    const res = await apiFetch(url);

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});

// Invalidate auth-gated queries (called once App Bridge patches fetch)
export function invalidateAuthQueries() {
  queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
  queryClient.invalidateQueries({ queryKey: ["/api/merchant"] });
  queryClient.invalidateQueries({ queryKey: ["/api/appai/customizer-pages"] });
  queryClient.invalidateQueries({ queryKey: ["/api/appai/plan"] });
  // Generator Tester / Products — often fire before App Bridge patches fetch;
  // without these, a 401 leaves an empty product dropdown until a hard remount.
  queryClient.invalidateQueries({ queryKey: ["/api/admin/product-types"] });
  queryClient.invalidateQueries({ queryKey: ["/api/product-types"] });
  queryClient.invalidateQueries({ queryKey: ["/api/appai/design-studio/identity"] });
}

// Legacy no-op kept so existing imports compile without changes
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function setSessionTokenGetter(_getter: () => Promise<string | null>) {
  // no-op: App Bridge v4 patches fetch automatically
}
