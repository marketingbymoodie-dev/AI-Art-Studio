import { useEffect, useRef, useState } from "react";
import { ChevronDown, Images } from "lucide-react";
import { API_BASE } from "@/lib/urlBase";

type SavedDesign = {
  id: string;
  artworkUrl?: string | null;
  mockupUrls?: string[] | null;
  baseTitle?: string | null;
  pageHandle?: string | null;
  productTypeId?: string | number | null;
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
  const mockup = Array.isArray(d.mockupUrls) ? d.mockupUrls[0] : "";
  return String(mockup || d.artworkUrl || "");
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

  function hrefFor(d: SavedDesign): string | null {
    const typeId = d.productTypeId != null ? Number(d.productTypeId) : null;
    const handle =
      (d.pageHandle && String(d.pageHandle)) ||
      pages.find((p) => typeId && p.productTypeId === typeId)?.handle ||
      "";
    if (!handle) return null;
    return designerHrefFor({
      handle,
      productTypeId: typeId,
      title: d.baseTitle,
      loadDesignId: d.id,
    });
  }

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="true"
      >
        <Images className="h-4 w-4" />
        Saved Designs
        {designs.length > 0 ? ` (${designs.length})` : ""}
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
      {open ? (
        <div className="absolute right-0 z-40 mt-2 w-72 rounded-lg border bg-background p-3 shadow-lg">
          <div className="mb-2 text-sm font-semibold">Saved Designs</div>
          {!customerId ? (
            <p className="text-xs text-muted-foreground">
              Sign in on a product page to see the designs you have saved in this shop.
            </p>
          ) : loading ? (
            <p className="text-xs text-muted-foreground">Loading…</p>
          ) : designs.length === 0 ? (
            <p className="text-xs text-muted-foreground">No saved designs yet.</p>
          ) : (
            <ul className="max-h-80 space-y-2 overflow-auto">
              {designs.map((d) => {
                const href = hrefFor(d);
                const img = thumbUrl(d);
                const body = (
                  <>
                    {img ? (
                      <img src={img} alt="" className="h-12 w-12 rounded-md object-cover bg-muted" />
                    ) : (
                      <div className="h-12 w-12 rounded-md bg-muted" />
                    )}
                    <span className="min-w-0 truncate text-sm">
                      {d.baseTitle || "Saved design"}
                    </span>
                  </>
                );
                return (
                  <li key={d.id}>
                    {href ? (
                      <a
                        href={href}
                        className="flex items-center gap-2 rounded-md p-1 hover:bg-muted"
                        onClick={() => setOpen(false)}
                      >
                        {body}
                      </a>
                    ) : (
                      <div className="flex items-center gap-2 rounded-md p-1 opacity-50">
                        {body}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
