/**
 * API client for all /api/* requests.
 *
 * Auth strategy:
 *   In embedded Shopify Admin, App Bridge v4 exposes `shopify.idToken()`.
 *   Session JWTs expire in about a minute — a long Create Page wizard can
 *   outlive a token that was only injected by the fetch monkey-patch.
 *   We mint a fresh idToken on each request (and retry once on 401).
 *
 *   Outside Shopify Admin there is no session cookie. credentials: "include"
 *   is still set; the API accepts the bearer token only.
 */
import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { openedOutsideShopify } from "@/lib/shopifyContext";

const SESSION_RESTORE_MS = 8000;

function shopifyIdToken(): (() => Promise<string>) | null {
  const shopify = (window as { shopify?: { idToken?: () => Promise<string> } }).shopify;
  return typeof shopify?.idToken === "function" ? shopify.idToken : null;
}

/**
 * Admin deep links boot before App Bridge can mint a session token.
 * The first admin requests share one wait: retry until a token mints, or
 * eight seconds pass. Later requests mint a fresh token and do not wait.
 */
let sessionGate: Promise<void> | null = null;
let cachedSessionToken: { value: string; at: number } | null = null;
const TOKEN_WAIT_MS = 8000;
const TOKEN_REUSE_MS = 45_000;

function freshCachedToken(): string | null {
  if (!cachedSessionToken) return null;
  if (Date.now() - cachedSessionToken.at > TOKEN_REUSE_MS) return null;
  return cachedSessionToken.value;
}

export function clearCachedShopifySessionToken(): void {
  cachedSessionToken = null;
}

function rememberToken(token: unknown): string | null {
  if (typeof token !== "string" || !token.trim()) return null;
  cachedSessionToken = { value: token, at: Date.now() };
  return token;
}

async function mintSessionToken(): Promise<string | null> {
  const idToken = shopifyIdToken();
  const cached = freshCachedToken();
  if (!idToken) return cached;
  const pending = idToken()
    .then((token) => rememberToken(token))
    .catch(() => null);
  // A token minted moments ago is still valid. Don't wait on a second
  // idToken() call that never settles — that left the draft row on "Drafting".
  if (cached) {
    void pending;
    return cached;
  }
  try {
    const token = await Promise.race([
      pending,
      new Promise<null>((resolve) => window.setTimeout(() => resolve(null), TOKEN_WAIT_MS)),
    ]);
    return token || freshCachedToken();
  } catch {
    return freshCachedToken();
  }
}

function openSessionGate(): Promise<void> {
  if (!sessionGate) {
    sessionGate = (async () => {
      const deadline = Date.now() + SESSION_RESTORE_MS;
      for (;;) {
        if (await mintSessionToken()) return;
        if (Date.now() >= deadline) return;
        await new Promise((resolve) => window.setTimeout(resolve, 100));
      }
    })();
  }
  return sessionGate;
}

async function getFreshShopifySessionToken(): Promise<string | null> {
  if (
    typeof window !== "undefined" &&
    window.location.pathname.startsWith("/admin") &&
    !openedOutsideShopify()
  ) {
    await openSessionGate();
  }
  return mintSessionToken();
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

const SESSION_401_KEY = "appai-admin-session-401";

function sessionExpiredResponse(): Response {
  return new Response(JSON.stringify({ message: "Unauthorized: missing session token" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}

/** A real 401 makes App Bridge reload the iframe, which fires the same request again. */
function recentNetwork401(): boolean {
  try {
    const at = Number(sessionStorage.getItem(SESSION_401_KEY) || 0);
    return Number.isFinite(at) && Date.now() - at < 20_000;
  } catch {
    return false;
  }
}

function markNetwork401(): void {
  try {
    sessionStorage.setItem(SESSION_401_KEY, String(Date.now()));
  } catch {
    /* private mode */
  }
}

function clearNetwork401(): void {
  try {
    sessionStorage.removeItem(SESSION_401_KEY);
  } catch {
    /* ignore */
  }
}

export type ApiFetchInit = RequestInit & {
  /**
   * XMLHttpRequest instead of fetch. App Bridge patches fetch, and a patched
   * fetch that never settles leaves the caller hanging. XHR is not patched.
   */
  transport?: "xhr";
};

function headerRecord(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

function xhrFetch(url: string, options: RequestInit): Promise<Response> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const succeed = (response: Response) => {
      if (settled) return;
      settled = true;
      resolve(response);
    };
    const xhr = new XMLHttpRequest();
    xhr.open((options.method || "GET").toUpperCase(), url);
    xhr.withCredentials = true;
    xhr.responseType = "arraybuffer";
    const headers = options.headers instanceof Headers ? headerRecord(options.headers) : {};
    for (const [key, value] of Object.entries(headers)) xhr.setRequestHeader(key, value);
    xhr.onload = () => {
      const responseHeaders = new Headers();
      xhr.getAllResponseHeaders().trim().split(/[\r\n]+/).forEach((line) => {
        const parts = line.split(": ");
        if (parts.length >= 2) responseHeaders.append(parts[0], parts.slice(1).join(": "));
      });
      succeed(new Response(xhr.response || new ArrayBuffer(0), {
        status: xhr.status,
        statusText: xhr.statusText,
        headers: responseHeaders,
      }));
    };
    xhr.onerror = () => fail(new TypeError("Network request failed"));
    xhr.ontimeout = () => fail(new DOMException("Request timed out", "AbortError"));
    const signal = options.signal;
    if (signal) {
      if (signal.aborted) {
        fail(new DOMException("Request aborted", "AbortError"));
        return;
      }
      signal.addEventListener("abort", () => {
        xhr.abort();
        fail(new DOMException("Request aborted", "AbortError"));
      }, { once: true });
    }
    xhr.send((options.body as XMLHttpRequestBodyInit | null) ?? null);
  });
}

export async function apiFetch(
  input: RequestInfo | URL,
  init: ApiFetchInit = {},
  attempts = 2,
): Promise<Response> {
  let res!: Response;
  let previousToken: string | null = null;
  const { transport, ...requestInit } = init;
  const adminNeedsToken =
    typeof window !== "undefined" &&
    window.location.pathname.startsWith("/admin") &&
    !openedOutsideShopify() &&
    shopifyIdToken() != null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (attempt > 1) {
      clearCachedShopifySessionToken();
      await new Promise((resolve) => setTimeout(resolve, 400 * (attempt - 1)));
    }
    const token = await getFreshShopifySessionToken();
    // A tokenless request 401s, and App Bridge treats that 401 as a reason to
    // reload the iframe. The reload fires the same request again. Don't send it.
    if (adminNeedsToken && (!token || recentNetwork401())) return sessionExpiredResponse();
    if (attempt > 1 && token === previousToken) {
      if (res?.status === 401) markNetwork401();
      return res;
    }
    previousToken = token;
    const headers = new Headers(requestInit.headers);
    if (requestInit.body !== undefined && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    if (token) headers.set("Authorization", `Bearer ${token}`);
    res = transport === "xhr"
      ? await xhrFetch(String(input), { ...requestInit, headers })
      : await fetch(input, { ...requestInit, headers, credentials: "include" });
    if (res.status !== 401) {
      clearNetwork401();
      return res;
    }
  }
  if (res.status === 401) markNetwork401();
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
