import { useEffect, useState, type ReactNode } from "react";
import { Link, Route, Switch, useParams, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ExternalLink, Palette } from "lucide-react";

export type CreatorBoot = {
  id: string;
  username: string;
  subdomain: string;
  displayName: string;
  niche: string | null;
  bio: string | null;
  profileImageUrl: string | null;
  socialPlatform: string | null;
  socialUsername: string | null;
  socialUrl: string | null;
  status: string;
  branding: Record<string, unknown> | null;
  storefrontUrlPath: string;
  paused: boolean;
};

type StorefrontPage = {
  id: number;
  customizerPageId: string;
  handle: string;
  title: string;
  description: string | null;
  baseProductTitle: string | null;
  baseProductPrice: string | null;
  productTypeId: number | null;
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
}): string {
  const params = new URLSearchParams();
  if (opts.platformShop) params.set("shop", opts.platformShop);
  params.set("page", opts.handle);
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
  const headline =
    (typeof branding.headline === "string" && branding.headline) ||
    `${creator.displayName}'s AI Shop`;
  const accent =
    (typeof branding.accentColor === "string" && branding.accentColor) || undefined;

  return (
    <div className="min-h-screen bg-background text-foreground" style={accent ? { ["--primary" as string]: accent } : undefined}>
      <header className="border-b">
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
              <div className="truncate font-semibold">{headline}</div>
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
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-10">{children}</main>
      <footer className="border-t mt-16">
        <div className="mx-auto max-w-5xl px-4 py-6 text-center text-xs text-muted-foreground">
          Powered by AI Art Studio · Personalized merch for {creator.displayName}
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
  const description =
    (typeof branding.description === "string" && branding.description) ||
    creator.bio ||
    `Generate one-of-a-kind designs and put them on premium products — curated by ${creator.displayName}.`;
  const { data } = useCreatorPages(creator.username);
  const pages = data?.pages ?? [];
  const platformShop = data?.platformShopDomain ?? null;

  return (
    <div className="space-y-10">
      <section className="max-w-2xl">
        <p className="text-sm font-medium uppercase tracking-wide text-primary">
          {creator.niche || "Creator store"}
        </p>
        <h1 className="mt-2 text-4xl font-bold tracking-tight">
          {(typeof branding.headline === "string" && branding.headline) ||
            `${creator.displayName}'s AI Shop`}
        </h1>
        <p className="mt-4 text-lg text-muted-foreground">{description}</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Button asChild>
            <Link href={`${basePath}/products`}>Shop products</Link>
          </Button>
          {pages[0] && platformShop ? (
            <Button asChild variant="secondary">
              <a href={designerHref({ handle: pages[0].handle, platformShop, creator })}>
                Start designing
              </a>
            </Button>
          ) : null}
          {creator.socialUrl ? (
            <Button asChild variant="outline">
              <a href={creator.socialUrl} target="_blank" rel="noopener noreferrer">
                Follow on {creator.socialPlatform || "social"}
                <ExternalLink className="ml-2 h-3.5 w-3.5" />
              </a>
            </Button>
          ) : null}
        </div>
      </section>
      {pages.length > 0 ? (
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {pages.slice(0, 3).map((p) => (
            <ProductCard
              key={p.id}
              page={p}
              href={
                platformShop
                  ? designerHref({ handle: p.handle, platformShop, creator })
                  : `${basePath}/customize/${p.handle}`
              }
            />
          ))}
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
      className="block rounded-lg border p-5 transition-colors hover:border-foreground/40 hover:bg-muted/20"
    >
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Products</h1>
        <p className="text-muted-foreground">
          Pick a product and generate a design curated by {creator.displayName}.
        </p>
      </div>
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
                  ? designerHref({ handle: p.handle, platformShop, creator })
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
      <h1 className="text-2xl font-bold">About {creator.displayName}</h1>
      <p className="text-muted-foreground whitespace-pre-wrap">
        {creator.bio || "This creator is part of the AI Art Studio Creator Beta."}
      </p>
      {creator.socialUsername ? (
        <p className="text-sm">
          {creator.socialPlatform}: @{creator.socialUsername}
        </p>
      ) : null}
    </div>
  );
}

function PausedView({ creator }: { creator: CreatorBoot }) {
  return (
    <div className="mx-auto max-w-lg py-24 text-center">
      <h1 className="text-3xl font-bold">{creator.displayName}&apos;s shop is paused</h1>
      <p className="mt-4 text-muted-foreground">
        This storefront is temporarily unavailable. Check back soon.
      </p>
    </div>
  );
}

function CustomizeRedirect({ creator }: { creator: CreatorBoot }) {
  const params = useParams<{ handle?: string }>();
  const { data } = useCreatorPages(creator.username);
  const platformShop = data?.platformShopDomain ?? null;
  const handle = params.handle || "";

  useEffect(() => {
    if (!handle || !platformShop) return;
    window.location.replace(
      designerHref({ handle, platformShop, creator }),
    );
  }, [handle, platformShop, creator]);

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
  if (creator.paused) {
    return (
      <StoreShell creator={creator} basePath={basePath}>
        <PausedView creator={creator} />
      </StoreShell>
    );
  }

  return (
    <StoreShell creator={creator} basePath={basePath}>
      <Switch>
        <Route path={`${basePath}/products`}>
          <ProductsView creator={creator} basePath={basePath} />
        </Route>
        <Route path={`${basePath}/about`}>
          <AboutView creator={creator} />
        </Route>
        <Route path={`${basePath}/customize/:handle`}>
          <CustomizeRedirect creator={creator} />
        </Route>
        <Route>
          <HomeView creator={creator} basePath={basePath} />
        </Route>
      </Switch>
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
      ? `${creator.displayName} · AI Art Studio`
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
