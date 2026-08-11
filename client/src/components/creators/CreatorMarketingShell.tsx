import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Palette } from "lucide-react";
import type { ReactNode } from "react";

export function CreatorMarketingShell({
  children,
  ctaHref = "/creators/apply",
  ctaLabel = "Apply for beta",
}: {
  children: ReactNode;
  ctaHref?: string;
  ctaLabel?: string;
}) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b">
        <div className="container mx-auto flex items-center justify-between gap-4 px-4 py-4">
          <Link href="/" className="flex items-center gap-2">
            <Palette className="h-6 w-6 text-primary" />
            <span className="text-lg font-semibold">AI Art Studio</span>
          </Link>
          <nav className="flex items-center gap-2 sm:gap-4">
            <Link href="/beta" className="hidden text-sm text-muted-foreground hover:text-foreground sm:inline">
              Beta
            </Link>
            <Link
              href="/creators"
              className="hidden text-sm text-muted-foreground hover:text-foreground sm:inline"
            >
              Creators
            </Link>
            <Link
              href="/shopify-beta"
              className="hidden text-sm text-muted-foreground hover:text-foreground md:inline"
            >
              Shopify merchants
            </Link>
            <Button asChild size="sm">
              <Link href={ctaHref}>{ctaLabel}</Link>
            </Button>
          </nav>
        </div>
      </header>
      <main>{children}</main>
      <footer className="border-t mt-16">
        <div className="container mx-auto px-4 py-8 text-center text-xs text-muted-foreground">
          AI Art Studio Creator Beta — personalized merch powered by AI customizer pages.
        </div>
      </footer>
    </div>
  );
}
