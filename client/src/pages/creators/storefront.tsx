import { useEffect, useState, type ReactNode } from "react";
import { Link, useParams, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ExternalLink, Palette, ShoppingCart } from "lucide-react";
import {
  ensureCreatorAnalyticsSession,
  trackCreatorEvent,
} from "@/lib/creator-analytics";
import { clearCreatorCart, readCreatorCart, writeCreatorCart } from "@/lib/creatorCart";
import { API_BASE } from "@/lib/urlBase";
import {
  CREATOR_HEADING_FONTS_STYLESHEET,
  creatorBrandingImageUrl,
  creatorPublicName,
  formatSocialHandle,
  parseCreatorSocials,
  resolveCreatorHeadingFont,
  socialPlatformLabel,
} from "@shared/creatorMarketplace";

export type CreatorBoot = {
  id: string;
  username: string;
  subdomain: string;
  publicName: string;
  niche: string | null;
  bio: string | null;
  profileImageUrl: string | null;
  socialPlatform: string | null;
  socialUsername: string | null;
  socialUrl: string | null;
  socials?: Array<{ platform: string; username: string; url?: string | null }>;
  status: string;
  branding: Record<string, unknown> | null;
  storefrontUrlPath: string;
  paused: boolean;
};

function storeName(creator: CreatorBoot): string {
  return (
    creator.publicName ||
    creatorPublicName({ username: creator.username, branding: creator.branding })
  );
}

function homeBackgroundUrl(creator: CreatorBoot): string | null {
  return creatorBrandingImageUrl(creator.branding, "backgroundImageUrl");
}

function creatorSocials(creator: CreatorBoot) {
  return parseCreatorSocials(creator.socials, {
    platform: creator.socialPlatform,
    username: creator.socialUsername,
    url: creator.socialUrl,
  });
}

function useCreatorHeadingStylesheet() {
  useEffect(() => {
    const id = "creator-heading-fonts";
    if (document.getElementById(id)) return;
    const link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href = CREATOR_HEADING_FONTS_STYLESHEET;
    document.head.appendChild(link);
  }, []);
}

type StorefrontPage = {
  id: number;
  customizerPageId: string;
  handle: string;
  title: string;
  description: string | null;
  baseProductTitle: string | null;
  baseProductPrice: string | null;
  productTypeId: number | null;
  imageUrl: string | null;
  sortOrder: number;
};

function readBootFromWindow(): CreatorBoot | null {
  if (typeof window === "undefined") return null;
  return ((window as any).__CREATOR__ as CreatorBoot | undefined) ?? null;
}

function designerHref(opts: {
  handle: string;
  platformShop: string | null;
  creator: CreatorBoot;
  productTypeId?: number | null;
  title?: string | null;
}): string {
  const params = new URLSearchParams();
  if (opts.platformShop) params.set("shop", opts.platformShop);
  params.set("page", opts.handle);
  params.set("pageHandle", opts.handle);
  if (opts.productTypeId != null && opts.productTypeId > 0) {
    params.set("productTypeId", String(opts.productTypeId));
  }
  if (opts.title) params.set("productTitle", opts.title);
  params.set("creatorUsername", opts.creator.username);
  params.set("creatorId", opts.creator.id);
  params.set("storefront", "true");
  return `/s/designer?${params.toString()}`;
}

function StoreShell({
  creator,
  basePath,
  children,
}: {
  creator: CreatorBoot;
  basePath: string;
  children: ReactNode;
}) {
  const branding = creator.branding || {};
  const headline = storeName(creator);
  const headingFont = resolveCreatorHeadingFont(branding);
  const headingStyle = headingFont.cssFamily
    ? { fontFamily: headingFont.cssFamily }
    : undefined;
  const accent =
    (typeof branding.accentColor === "string" && branding.accentColor) || undefined;
  useCreatorHeadingStylesheet();

  return (
    <div className="min-h-screen bg-background text-foreground" style={accent ? { ["--primary" as string]: accent } : undefined}>
      <header className="border-b bg-background/90 backdrop-blur-sm">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-4">
          <Link href={basePath || "/"} className="flex items-center gap-2 min-w-0">
            {creator.profileImageUrl ? (
              <img
                src={creator.profileImageUrl}
                alt=""
                className="h-9 w-9 rounded-full object-cover"
              />
            ) : (
              <Palette className="h-6 w-6 text-primary shrink-0" />
            )}
            <div className="min-w-0">
              <div className="truncate font-semibold" style={headingStyle}>
                {headline}
              </div>
              {creator.niche ? (
                <div className="truncate text-xs text-muted-foreground">{creator.niche}</div>
              ) : null}
            </div>
          </Link>
          <nav className="flex items-center gap-3 text-sm">
            <Link href={basePath || "/"} className="text-muted-foreground hover:text-foreground">
              Home
            </Link>
            <Link
              href={`${basePath}/products`}
              className="text-muted-foreground hover:text-foreground"
            >
              Products
            </Link>
            <Link
              href={`${basePath}/about`}
              className="text-muted-foreground hover:text-foreground"
            >
              About
            </Link>
            <Link
              href={`${basePath}/cart`}
              className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
            >
              <ShoppingCart className="h-4 w-4" />
              Cart
              {readCreatorCart(creator.username)?.itemCount
                ? ` (${readCreatorCart(creator.username)?.itemCount})`
                : ""}
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-10">{children}</main>
      <footer className="border-t mt-16">
        <div className="mx-auto max-w-5xl px-4 py-6 text-center text-xs text-muted-foreground">
          Powered by AI Art Studio · Personalized merch for {storeName(creator)}
        </div>
      </footer>
    </div>
  );
}

function useCreatorPages(username: string) {
  return useQuery<{
    platformShopDomain: string | null;
    pages: StorefrontPage[];
  }>({
    queryKey: [`/api/creators/storefront/${username}/pages`],
    enabled: !!username,
  });
}


function HomeView({ creator, basePath }: { creator: CreatorBoot; basePath: string }) {
  const branding = creator.branding || {};
  const name = storeName(creator);
  const headingFont = resolveCreatorHeadingFont(branding);
  const headingStyle = headingFont.cssFamily
    ? { fontFamily: headingFont.cssFamily }
    : undefined;
  const backgroundUrl = homeBackgroundUrl(creator);
  const description =
    (typeof branding.description === "string" && branding.description) ||
    creator.bio ||
    `Generate one-of-a-kind designs and put them on premium products — curated by ${name}.`;
  const { data } = useCreatorPages(creator.username);
  const pages = data?.pages ?? [];
  const platformShop = data?.platformShopDomain ?? null;

  useEffect(() => {
    for (const p of pages.slice(0, 4)) {
      if (!p.imageUrl) continue;
      const img = new Image();
      img.src = p.imageUrl;
    }
  }, [pages]);

  const heroCopy = (
    <>
      {creator.profileImageUrl ? (
        <img
          src={creator.profileImageUrl}
          alt=""
          className={`mb-5 h-20 w-20 rounded-full object-cover ${
            backgroundUrl ? "ring-2 ring-white/80" : "border"
          }`}
        />
      ) : null}
      <p
        className={`text-sm font-medium uppercase tracking-wide ${
          backgroundUrl ? "text-white/80" : "text-primary"
        }`}
      >
        {creator.niche || "Creator store"}
      </p>
      <h1
        className={`mt-2 text-4xl font-bold tracking-tight ${
          backgroundUrl ? "text-white" : ""
        }`}
        style={headingStyle}
      >
        {name}
      </h1>
      <p
        className={`mt-4 text-lg ${
          backgroundUrl ? "text-white/85" : "text-muted-foreground"
        }`}
      >
        {description}
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        {pages.length > 0 ? (
          <Button asChild variant={backgroundUrl ? "secondary" : "default"}>
            <Link href={`${basePath}/products`}>
              {pages.length > 3 ? "Shop All Products" : "Shop Products"}
            </Link>
          </Button>
        ) : null}
        {creatorSocials(creator).map((s) =>
          s.url ? (
            <Button
              key={`${s.platform}:${s.username}`}
              asChild
              variant="outline"
              className={
                backgroundUrl
                  ? "bg-white/10 text-white border-white/40 hover:bg-white/20"
                  : undefined
              }
            >
              <a href={s.url} target="_blank" rel="noopener noreferrer">
                Follow on {socialPlatformLabel(s.platform)}
                <ExternalLink className="ml-2 h-3.5 w-3.5" />
              </a>
            </Button>
          ) : null,
        )}
      </div>
    </>
  );

  return (
    <div className="space-y-10">
      {backgroundUrl ? (
        <section className="relative -mt-10 ml-[calc(50%-50vw)] w-screen overflow-hidden">
          <img
            src={backgroundUrl}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
          />
          <div className="absolute inset-0 bg-black/50" />
          <div className="relative mx-auto max-w-2xl px-4 py-16 sm:py-20">{heroCopy}</div>
        </section>
      ) : (
        <section className="max-w-2xl">{heroCopy}</section>
      )}
      {pages.length > 0 ? (
        <section className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {pages.slice(0, 3).map((p) => (
              <ProductCard
                key={p.id}
                page={p}
                href={
                  platformShop
                    ? designerHref({
                        handle: p.handle,
                        platformShop,
                        creator,
                        productTypeId: p.productTypeId,
                        title: p.title,
                      })
                    : `${basePath}/customize/${p.handle}`
                }
              />
            ))}
          </div>
          {pages.length > 3 ? (
            <div className="text-center">
              <Button asChild variant="outline">
                <Link href={`${basePath}/products`}>Shop All Products</Link>
              </Button>
            </div>
          ) : null}
        </section>
      ) : (
        <section className="rounded-lg border bg-muted/30 p-6">
          <h2 className="font-semibold">Products coming soon</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            This creator is still onboarding. Customizer products will appear here once assigned
            in Creator Marketplace admin.
          </p>
        </section>
      )}
    </div>
  );
}

function ProductCard({
  page,
  href,
}: {
  page: StorefrontPage;
  href: string;
}) {
  return (
    <a
      href={href}
      className="block overflow-hidden rounded-lg border transition-colors hover:border-foreground/40 hover:bg-muted/20"
    >
      {page.imageUrl ? (
        <div className="relative aspect-square w-full bg-muted overflow-hidden">
          <img
            src={page.imageUrl}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
          />
        </div>
      ) : null}
      <div className="p-5">
      <div className="font-semibold">{page.title}</div>
      {page.baseProductTitle ? (
        <div className="mt-1 text-sm text-muted-foreground">{page.baseProductTitle}</div>
      ) : null}
      {page.baseProductPrice ? (
        <div className="mt-2 text-sm font-medium">From {page.baseProductPrice}</div>
      ) : null}
      {page.description ? (
        <p className="mt-2 text-sm text-muted-foreground line-clamp-2">{page.description}</p>
      ) : null}
      <div className="mt-4 text-sm font-medium text-primary">Customize →</div>
      </div>
    </a>
  );
}

function ProductsView({
  creator,
  basePath,
}: {
  creator: CreatorBoot;
  basePath: string;
}) {
  const { data, isLoading } = useCreatorPages(creator.username);
  const pages = data?.pages ?? [];
  const platformShop = data?.platformShopDomain ?? null;
  const backgroundUrl = homeBackgroundUrl(creator);

  useEffect(() => {
    for (const p of pages.slice(0, 6)) {
      if (!p.imageUrl) continue;
      const img = new Image();
      img.src = p.imageUrl;
    }
  }, [pages]);

  const heading = (
    <>
      <h1 className={`text-2xl font-bold ${backgroundUrl ? "text-white" : ""}`}>Products</h1>
      <p className={backgroundUrl ? "text-white/80" : "text-muted-foreground"}>
        Pick a product and generate a design curated by {storeName(creator)}.
      </p>
    </>
  );

  return (
    <div className="space-y-6">
      {backgroundUrl ? (
        <section className="relative -mt-10 ml-[calc(50%-50vw)] w-screen overflow-hidden">
          <img
            src={backgroundUrl}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
          />
          <div className="absolute inset-0 bg-black/50" />
          <div className="relative mx-auto max-w-5xl px-4 py-12">{heading}</div>
        </section>
      ) : (
        <div>{heading}</div>
      )}
      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      ) : pages.length === 0 ? (
        <p className="text-muted-foreground">No products assigned yet.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {pages.map((p) => (
            <ProductCard
              key={p.id}
              page={p}
              href={
                platformShop
                  ? designerHref({
                      handle: p.handle,
                      platformShop,
                      creator,
                      productTypeId: p.productTypeId,
                      title: p.title,
                    })
                  : `${basePath}/customize/${p.handle}`
              }
            />
          ))}
        </div>
      )}
      <Button asChild variant="outline">
        <Link href={basePath || "/"}>Back home</Link>
      </Button>
    </div>
  );
}

function AboutView({ creator }: { creator: CreatorBoot }) {
  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-2xl font-bold">About {storeName(creator)}</h1>
      <p className="text-muted-foreground whitespace-pre-wrap">
        {creator.bio || "This creator is part of the AI Art Studio Creator Beta."}
      </p>
      {creatorSocials(creator).length > 0 ? (
        <ul className="space-y-1 text-sm">
          {creatorSocials(creator).map((s) => (
            <li key={`${s.platform}:${s.username}`}>
              {s.url ? (
                <a href={s.url} target="_blank" rel="noopener noreferrer" className="underline">
                  {socialPlatformLabel(s.platform)} {formatSocialHandle(s.username)}
                </a>
              ) : (
                <span>
                  {socialPlatformLabel(s.platform)} {formatSocialHandle(s.username)}
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function PausedView({ creator }: { creator: CreatorBoot }) {
  return (
    <div className="mx-auto max-w-lg py-24 text-center">
      <h1 className="text-3xl font-bold">{storeName(creator)}&apos;s shop is paused</h1>
      <p className="mt-4 text-muted-foreground">
        This storefront is temporarily unavailable. Check back soon.
      </p>
    </div>
  );
}

function storefrontSection(
  location: string,
  basePath: string,
): "products" | "about" | "customize" | "cart" | "home" {
  const rest = (basePath ? location.slice(basePath.length) : location) || "/";
  const path = rest.startsWith("/") ? rest : `/${rest}`;
  if (path === "/products" || path.startsWith("/products/")) return "products";
  if (path === "/about" || path.startsWith("/about/")) return "about";
  if (path === "/cart" || path.startsWith("/cart/")) return "cart";
  if (path.startsWith("/customize/")) return "customize";
  return "home";
}

function CartView({ creator, basePath }: { creator: CreatorBoot; basePath: string }) {
  const snap = readCreatorCart(creator.username);
  const { data, isLoading, error } = useQuery<{
    checkoutUrl: string;
    itemCount: number;
    lines: Array<{ id: string; quantity: number; title: string; imageUrl: string | null }>;
  }>({
    queryKey: ["/api/creators/cart", creator.username, snap?.cartId],
    enabled: !!snap?.cartId,
    queryFn: async () => {
      const params = new URLSearchParams({
        creatorUsername: creator.username,
        cartId: snap!.cartId,
      });
      const res = await fetch(`${API_BASE}/api/creators/cart?${params.toString()}`);
      const json = await res.json().catch(() => ({}));
      if (res.status === 404) {
        clearCreatorCart();
        throw new Error("Cart expired");
      }
      if (!res.ok) throw new Error(json?.error || "Could not load cart");
      writeCreatorCart({
        cartId: String(json.cartId || snap!.cartId),
        checkoutUrl: String(json.checkoutUrl || snap!.checkoutUrl || ""),
        itemCount: Number(json.itemCount) || 0,
        username: creator.username,
      });
      return json;
    },
  });

  const lines = data?.lines || [];
  const checkoutUrl = data?.checkoutUrl || snap?.checkoutUrl || "";
  const itemCount = data?.itemCount ?? snap?.itemCount ?? 0;

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Your cart</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Add more products from the shop, then checkout when you’re ready.
        </p>
      </div>
      {!snap?.cartId ? (
        <p className="text-muted-foreground">Your cart is empty.</p>
      ) : isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : error ? (
        <p className="text-muted-foreground">Your cart is empty or expired.</p>
      ) : lines.length === 0 ? (
        <p className="text-muted-foreground">Your cart is empty.</p>
      ) : (
        <ul className="space-y-3">
          {lines.map((line) => (
            <li key={line.id} className="flex items-center gap-3 rounded-lg border p-3">
              {line.imageUrl ? (
                <img
                  src={line.imageUrl}
                  alt=""
                  className="h-16 w-16 rounded-md object-cover bg-muted"
                />
              ) : (
                <div className="h-16 w-16 rounded-md bg-muted" />
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{line.title}</div>
                <div className="text-sm text-muted-foreground">Qty {line.quantity}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button asChild variant="outline" className="flex-1">
          <Link href={`${basePath}/products`}>Continue shopping</Link>
        </Button>
        <Button
          className="flex-1"
          disabled={!checkoutUrl || itemCount < 1}
          onClick={() => {
            if (!checkoutUrl) return;
            trackCreatorEvent({
              creatorId: creator.id,
              creatorUsername: creator.username,
              eventType: "checkout_started",
              path: `${basePath}/cart`,
              metadata: { itemCount },
            });
            window.location.assign(checkoutUrl);
          }}
        >
          Checkout{itemCount > 0 ? ` (${itemCount})` : ""}
        </Button>
      </div>
    </div>
  );
}

function CustomizeRedirect({
  creator,
  handle,
}: {
  creator: CreatorBoot;
  handle: string;
}) {
  const { data } = useCreatorPages(creator.username);
  const platformShop = data?.platformShopDomain ?? null;
  const page = (data?.pages || []).find((p) => p.handle === handle);

  useEffect(() => {
    if (!handle || !platformShop) return;
    window.location.replace(
      designerHref({
        handle,
        platformShop,
        creator,
        productTypeId: page?.productTypeId,
        title: page?.title,
      }),
    );
  }, [handle, platformShop, creator, page?.productTypeId, page?.title]);

  return (
    <div className="space-y-3 py-10 text-center">
      <Skeleton className="mx-auto h-8 w-48" />
      <p className="text-sm text-muted-foreground">Opening customizer…</p>
    </div>
  );
}

function CreatorStoreRoutes({
  creator,
  basePath,
}: {
  creator: CreatorBoot;
  basePath: string;
}) {
  const [location] = useLocation();

  useEffect(() => {
    if (creator.paused) return;
    let cancelled = false;
    (async () => {
      await ensureCreatorAnalyticsSession({
        creatorId: creator.id,
        creatorUsername: creator.username,
      });
      if (cancelled) return;
      trackCreatorEvent({
        creatorId: creator.id,
        creatorUsername: creator.username,
        eventType: "page_view",
        path: location || "/",
        metadata: { surface: "creator_storefront" },
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [creator.id, creator.username, creator.paused, location]);

  if (creator.paused) {
    return (
      <StoreShell creator={creator} basePath={basePath}>
        <PausedView creator={creator} />
      </StoreShell>
    );
  }

  const section = storefrontSection(location, basePath);
  const customizeHandle =
    section === "customize"
      ? decodeURIComponent(location.split("/customize/")[1]?.split("/")[0] || "")
      : "";

  return (
    <StoreShell creator={creator} basePath={basePath}>
      {section === "products" ? (
        <ProductsView creator={creator} basePath={basePath} />
      ) : section === "about" ? (
        <AboutView creator={creator} />
      ) : section === "cart" ? (
        <CartView creator={creator} basePath={basePath} />
      ) : section === "customize" ? (
        <CustomizeRedirect creator={creator} handle={customizeHandle} />
      ) : (
        <HomeView creator={creator} basePath={basePath} />
      )}
    </StoreShell>
  );
}

/** Path-based storefront: /c/:username/... */
export default function CreatorPathStorefrontPage() {
  const params = useParams<{ username?: string }>();
  const username = params.username || "";
  const basePath = `/c/${username}`;

  const { data, isLoading, error } = useQuery<{ creator: CreatorBoot }>({
    queryKey: [`/api/creators/storefront/${username}`],
    enabled: !!username,
  });

  if (isLoading) {
    return (
      <div className="mx-auto max-w-5xl space-y-4 px-4 py-16">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (error || !data?.creator) {
    return (
      <div className="mx-auto max-w-lg px-4 py-24 text-center">
        <h1 className="text-2xl font-bold">Store not found</h1>
        <p className="mt-3 text-muted-foreground">This creator storefront is unavailable.</p>
        <Button asChild className="mt-6">
          <Link href="/creators">Back to Creators</Link>
        </Button>
      </div>
    );
  }

  return <CreatorStoreRoutes creator={data.creator} basePath={basePath} />;
}

/** Subdomain boot: window.__CREATOR__ set by server HTML injection. */
export function CreatorBootStorefrontPage() {
  const [creator] = useState(() => readBootFromWindow());
  const [location] = useLocation();

  useEffect(() => {
    document.title = creator
      ? `${storeName(creator)} · AI Art Studio`
      : "AI Art Studio";
  }, [creator]);

  if (!creator) {
    return (
      <div className="mx-auto max-w-lg px-4 py-24 text-center">
        <h1 className="text-2xl font-bold">Store not found</h1>
      </div>
    );
  }

  // On subdomain, routes are at /, /products, /about
  void location;
  return <CreatorStoreRoutes creator={creator} basePath="" />;
}

export function hasCreatorBootPayload(): boolean {
  return !!readBootFromWindow();
}
