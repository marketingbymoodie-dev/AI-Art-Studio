/**
 * Saved-design reopen target, kept out of URLs. A generation job id in the
 * storefront URL (`?loadDesignId=`) turned every reopened design into a link
 * anyone could open and buy from.
 *
 * Lives in tab-scoped sessionStorage on the storefront origin (the customizer
 * iframe is same-origin via the App Proxy), keyed by customizer page handle so
 * a hard refresh on that page still restores. A pasted URL carries nothing.
 * Legacy `?loadDesignId=` links are moved into storage and stripped on arrival.
 *
 * Mirrored in extensions/theme-extension/assets/appai-art-embed.js
 * (APPAI_REOPEN_KEY) — keep the key and entry shape in sync.
 */
export const REOPEN_DESIGN_KEY = "appai_reopen_design";

/**
 * URL params that carry a job id or its mockup; never left in the address bar.
 * reuseJobId's value is already in the reuse handoff (appai_reuse_handoff).
 */
export const REOPEN_URL_PARAMS = ["loadDesignId", "loadMockup", "loadProductName", "savedDesignId", "reuseJobId"] as const;

export type ReopenDesignEntry = {
  id: string;
  handle: string;
  mockup?: string | null;
  productName?: string | null;
  ts: number;
};

function normHandle(handle: string | null | undefined): string {
  return String(handle ?? "").trim().toLowerCase();
}

/** Customizer page handle for a storefront / phone-shell / creator-designer URL. */
export function pageHandleFromUrl(url: URL): string {
  const m = url.pathname.match(/\/pages\/([^/?#]+)/);
  if (m) {
    try {
      return normHandle(decodeURIComponent(m[1]));
    } catch {
      return normHandle(m[1]);
    }
  }
  return normHandle(url.searchParams.get("pageHandle") || url.searchParams.get("page"));
}

function sessionStores(host: Window | null | undefined): Storage[] {
  const out: Storage[] = [];
  const push = (get: () => Storage | null | undefined) => {
    try {
      const s = get();
      if (s && !out.includes(s)) out.push(s);
    } catch {
      /* cross-origin / private mode */
    }
  };
  push(() => host?.sessionStorage);
  push(() => (typeof window !== "undefined" ? window.sessionStorage : null));
  return out;
}

export function writeReopenDesign(
  host: Window | null | undefined,
  entry: Omit<ReopenDesignEntry, "ts" | "handle"> & { handle: string },
): void {
  const handle = normHandle(entry.handle);
  if (!entry.id || !handle) return;
  const payload = JSON.stringify({
    id: String(entry.id),
    handle,
    mockup: entry.mockup || null,
    productName: entry.productName || null,
    ts: Date.now(),
  } satisfies ReopenDesignEntry);
  for (const s of sessionStores(host)) {
    try {
      s.setItem(REOPEN_DESIGN_KEY, payload);
    } catch {
      /* quota */
    }
  }
}

/** The reopen entry for this page handle only — never revives a design on another page. */
export function readReopenDesign(
  host: Window | null | undefined,
  handle: string | null | undefined,
): ReopenDesignEntry | null {
  const want = normHandle(handle);
  if (!want) return null;
  for (const s of sessionStores(host)) {
    try {
      const raw = s.getItem(REOPEN_DESIGN_KEY);
      if (!raw) continue;
      const e = JSON.parse(raw) as ReopenDesignEntry;
      if (e?.id && normHandle(e.handle) === want) return e;
    } catch {
      /* ignore */
    }
  }
  return null;
}

export function clearReopenDesign(host: Window | null | undefined): void {
  for (const s of sessionStores(host)) {
    try {
      s.removeItem(REOPEN_DESIGN_KEY);
    } catch {
      /* ignore */
    }
  }
}

/** Remove reopen params from `url` in place; returns what they carried (null if none). */
export function stripReopenParams(url: URL): { id: string; mockup: string | null; productName: string | null } | null {
  const id = url.searchParams.get("loadDesignId") || url.searchParams.get("savedDesignId") || "";
  const mockup = url.searchParams.get("loadMockup");
  const productName = url.searchParams.get("loadProductName");
  let changed = false;
  for (const p of REOPEN_URL_PARAMS) {
    if (url.searchParams.has(p)) {
      url.searchParams.delete(p);
      changed = true;
    }
  }
  if (!changed) return null;
  return id ? { id, mockup, productName } : null;
}

/**
 * Legacy `?loadDesignId=` arrival: move it into storage and strip the host
 * address bar. Returns the stored entry (or null when the URL had none).
 */
export function stashReopenFromHostUrl(host: Window | null | undefined): ReopenDesignEntry | null {
  if (!host) return null;
  let url: URL;
  try {
    url = new URL(host.location.href);
  } catch {
    return null;
  }
  const handle = pageHandleFromUrl(url);
  const carried = stripReopenParams(url);
  if (!carried && url.toString() === host.location.href) return null;
  try {
    host.history.replaceState(host.history.state, "", url.toString());
  } catch {
    /* ignore */
  }
  if (!carried || !handle) return null;
  writeReopenDesign(host, { id: carried.id, handle, mockup: carried.mockup, productName: carried.productName });
  return readReopenDesign(host, handle);
}
