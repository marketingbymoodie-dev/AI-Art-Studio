import { useEffect, useRef, useState } from "react";
import { ChevronDown, Images, X } from "lucide-react";
import { API_BASE } from "@/lib/urlBase";

type SavedDesign = {
  id: string;
  artworkUrl?: string | null;
  mockupUrls?: string[] | null;
  baseTitle?: string | null;
  pageHandle?: string | null;
  productTypeId?: string | number | null;
  prompt?: string | null;
  designState?: Record<string, unknown> | null;
};

type ShopPage = {
  handle: string;
  title: string;
  productTypeId: number | null;
};

function readLoggedInCustomerId(): string | null {
  try {
    const raw = localStorage.getItem("appai_customer");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.isLoggedIn && parsed?.id) return String(parsed.id);
    }
  } catch {
    /* ignore */
  }
  try {
    return localStorage.getItem("appai_customer_id");
  } catch {
    return null;
  }
}

function thumbUrl(d: SavedDesign): string {
  const ds = d.designState && typeof d.designState === "object" ? d.designState : null;
  const flat =
    ds && ds.flatMockups && typeof ds.flatMockups === "object"
      ? (ds.flatMockups as Record<string, unknown>)
      : null;
  const hoodie =
    ds && ds.hoodieAopMockups && typeof ds.hoodieAopMockups === "object"
      ? (ds.hoodieAopMockups as Record<string, unknown>)
      : null;
  for (const u of [
    flat?.front,
    hoodie?.front,
    Array.isArray(d.mockupUrls) ? d.mockupUrls[0] : "",
    d.artworkUrl,
  ]) {
    if (typeof u === "string" && u.trim()) return u.trim();
  }
  return "";
}

function urlPath(u: unknown): string {
  const raw = typeof u === "string" ? u.trim() : "";
  if (!raw) return "";
  try {
    return new URL(raw, "https://local.invalid").pathname.replace(/\/+$/, "").toLowerCase();
  } catch {
    return raw.split("?")[0].replace(/\/+$/, "").toLowerCase();
  }
}

function urlsMatch(a: unknown, b: unknown): boolean {
  const pa = urlPath(a);
  const pb = urlPath(b);
  return !!pa && pa === pb;
}

function isHoodiePage(p: ShopPage): boolean {
  return /hoodie/i.test(`${p.title} ${p.handle}`);
}

function designStateHandle(d: SavedDesign): string {
  const ds = d.designState;
  return ds && typeof ds.pageHandle === "string" ? ds.pageHandle.trim() : "";
}

/** Resolve this shop's customizer page — never a leftover source-product type name. */
function resolveShopPage(d: SavedDesign, pages: ShopPage[]): ShopPage | null {
  if (pages.length === 0) return null;

  const handles = [d.pageHandle, designStateHandle(d)]
    .map((h) => (h ? String(h).trim() : ""))
    .filter(Boolean);
  for (const handle of handles) {
    const match = pages.find((p) => p.handle === handle);
    if (match) return match;
  }
  if (d.designState && typeof d.designState === "object") {
    const nested: string[] = [];
    const walk = (value: unknown) => {
      if (typeof value === "string") {
        const handle = value.trim();
        if (handle && pages.some((p) => p.handle === handle)) nested.push(handle);
        return;
      }
      if (value && typeof value === "object") {
        for (const child of Object.values(value as Record<string, unknown>)) walk(child);
      }
    };
    walk(d.designState);
    if (nested[0]) {
      const match = pages.find((p) => p.handle === nested[0]);
      if (match) return match;
    }
  }

  const typeId = d.productTypeId != null ? Number(d.productTypeId) : NaN;
  if (Number.isFinite(typeId) && typeId > 0) {
    const typeMatches = pages.filter((p) => p.productTypeId === typeId);
    if (typeMatches.length === 1) return typeMatches[0];
  }

  const ds = d.designState && typeof d.designState === "object" ? d.designState : null;
  const flatMockups =
    ds && ds.flatMockups && typeof ds.flatMockups === "object"
      ? (ds.flatMockups as Record<string, unknown>)
      : null;
  const hoodieMockups =
    ds && ds.hoodieAopMockups && typeof ds.hoodieAopMockups === "object"
      ? (ds.hoodieAopMockups as Record<string, unknown>)
      : null;
  const thumb = thumbUrl(d);
  const hoodiePages = pages.filter(isHoodiePage);
  const otherPages = pages.filter((p) => !isHoodiePage(p));
  const flatish = otherPages.filter((p) =>
    /apron|tote|bag|pillow|mug|case/i.test(`${p.title} ${p.handle}`),
  );

  const thumbIsFlat = !!(
    thumb &&
    (urlsMatch(thumb, flatMockups?.front) || urlsMatch(thumb, flatMockups?.back))
  );
  const thumbIsHoodie = !!(
    thumb &&
    (urlsMatch(thumb, hoodieMockups?.front) || urlsMatch(thumb, hoodieMockups?.back))
  );
  const hasFlat = !!(ds && ds.flatPlacerState && typeof ds.flatPlacerState === "object");
  const hasHoodie = !!(
    ds &&
    ds.hoodieAopPlacerState &&
    typeof ds.hoodieAopPlacerState === "object"
  );

  if (thumbIsFlat || (hasFlat && !hasHoodie)) {
    if (flatish.length === 1) return flatish[0];
    if (otherPages.length === 1) return otherPages[0];
  }
  if (thumbIsHoodie || (hasHoodie && !hasFlat)) {
    if (hoodiePages.length === 1) return hoodiePages[0];
  }

  return null;
}

function labelFor(d: SavedDesign, page: ShopPage | null, pages: ShopPage[]): string {
  if (page?.title) return page.title;
  if (d.baseTitle && pages.some((p) => p.title === d.baseTitle)) return d.baseTitle;
  return "Saved design";
}

export function CreatorSavedDesignsMenu({
  username,
  platformShop,
  designerHrefFor,
}: {
  username: string;
  platformShop: string | null;
  designerHrefFor: (opts: {
    handle: string;
    productTypeId?: number | null;
    title?: string | null;
    loadDesignId: string;
  }) => string | null;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [designs, setDesigns] = useState<SavedDesign[]>([]);
  const [pages, setPages] = useState<ShopPage[]>([]);
  const [galleryLimit, setGalleryLimit] = useState(20);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const customerId = readLoggedInCustomerId();

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  useEffect(() => {
    if (!open || !username) return;
    let cancelled = false;
    setLoading(true);
    const shop = platformShop || "";
    const designsReq = customerId
      ? fetch(`${API_BASE}/api/storefront/customizer/my-designs`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ shop, customerId }),
        }).then((r) => r.json())
      : Promise.resolve({ designs: [] });
    const pagesReq = fetch(
      `${API_BASE}/api/creators/storefront/${encodeURIComponent(username)}/pages`,
    ).then((r) => r.json());
    Promise.all([designsReq, pagesReq])
      .then(([designData, pageData]) => {
        if (cancelled) return;
        setDesigns(Array.isArray(designData?.designs) ? designData.designs : []);
        if (typeof designData?.limit === "number" && designData.limit > 0) {
          setGalleryLimit(designData.limit);
        }
        setPages(Array.isArray(pageData?.pages) ? pageData.pages : []);
      })
      .catch(() => {
        if (!cancelled) {
          setDesigns([]);
          setPages([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, username, platformShop, customerId]);

  async function deleteDesign(d: SavedDesign) {
    if (!customerId || !d.id || deletingId) return;
    if (!confirm("Delete this saved design?")) return;
    setDeletingId(d.id);
    try {
      const params = new URLSearchParams();
      if (platformShop) params.set("shop", platformShop);
      params.set("customerId", customerId);
      const r = await fetch(
        `${API_BASE}/api/storefront/customizer/my-designs/${encodeURIComponent(d.id)}?${params}`,
        { method: "DELETE" },
      );
      if (r.ok) setDesigns((prev) => prev.filter((x) => x.id !== d.id));
    } finally {
      setDeletingId(null);
    }
  }

  function hrefFor(d: SavedDesign, page: ShopPage | null): string | null {
    // Leftover jobs from a product not in this shop still open — reuse the
    // artwork on the first assigned product (same as in-place load in the customizer).
    const target = page || pages[0] || null;
    if (!target?.handle) return null;
    const typeId =
      target.productTypeId != null && target.productTypeId > 0
        ? target.productTypeId
        : d.productTypeId != null
          ? Number(d.productTypeId)
          : null;
    return designerHrefFor({
      handle: target.handle,
      productTypeId: typeId,
      title: target.title,
      loadDesignId: d.id,
    });
  }

  const slotCount = designs.length;

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        className={`inline-flex items-center gap-1 ${
          slotCount >= galleryLimit
            ? "text-red-700 hover:text-red-800"
            : "text-muted-foreground hover:text-foreground"
        }`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="true"
      >
        <Images className="h-4 w-4" />
        Saved Designs
        {designs.length > 0 ? ` (${slotCount}/${galleryLimit})` : ""}
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
      {open ? (
        <div className="absolute right-0 z-50 mt-2 w-[min(32rem,calc(100vw-1.5rem))] rounded-lg border bg-background p-4 shadow-lg">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold">
              Saved Designs ({slotCount}/{galleryLimit})
            </h3>
            <button
              type="button"
              className="p-1 text-muted-foreground hover:text-foreground"
              onClick={() => setOpen(false)}
              aria-label="Close saved designs"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          {slotCount >= galleryLimit - 4 && slotCount < galleryLimit ? (
            <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              You're almost at your {galleryLimit}-design limit. Delete unwanted designs to make room.
            </div>
          ) : null}
          {slotCount >= galleryLimit ? (
            <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
              Gallery full ({galleryLimit}/{galleryLimit}). Delete a design before generating a new one.
            </div>
          ) : null}
          {!customerId ? (
            <p className="text-sm text-muted-foreground">
              Sign in on a product page to see the designs you have saved in this shop.
            </p>
          ) : loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : designs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No saved designs yet.</p>
          ) : (
            <div className="grid max-h-[360px] grid-cols-2 gap-3 overflow-y-auto overscroll-contain pr-1 sm:grid-cols-3">
              {designs.map((d) => {
                const page = resolveShopPage(d, pages);
                const href = hrefFor(d, page);
                const img = thumbUrl(d);
                const title = labelFor(d, page, pages);
                const card = (
                  <>
                    <div className="relative aspect-square bg-muted">
                      {img ? (
                        <img src={img} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
                          No preview
                        </div>
                      )}
                    </div>
                    <div className="px-2 py-1.5">
                      <p className="truncate text-xs font-medium">{title}</p>
                      {d.prompt ? (
                        <p className="truncate text-[10px] text-muted-foreground">{d.prompt}</p>
                      ) : null}
                    </div>
                  </>
                );
                return (
                  <div key={d.id} className="group relative">
                    {href ? (
                      <a
                        href={href}
                        className="block overflow-hidden rounded-md border border-border hover:border-primary"
                        onClick={() => setOpen(false)}
                      >
                        {card}
                      </a>
                    ) : (
                      <div className="overflow-hidden rounded-md border border-border opacity-50">
                        {card}
                      </div>
                    )}
                    <button
                      type="button"
                      className="absolute right-1 top-1 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white opacity-100 transition-opacity hover:bg-red-600 sm:opacity-0 sm:group-hover:opacity-100 sm:focus:opacity-100"
                      title="Delete design"
                      disabled={deletingId === d.id}
                      onClick={() => void deleteDesign(d)}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
