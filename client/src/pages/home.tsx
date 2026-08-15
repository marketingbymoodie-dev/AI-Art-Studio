import { useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { Palette, Image, ShoppingCart, Settings } from "lucide-react";
import { CreditDisplay } from "@/components/credit-display";
import { isShopifyEmbedded } from "@/lib/shopify";
import LuxeLandingPage from "@/pages/creators/luxe-landing";
import { LastCreatorReturnButton } from "@/components/creators/LastCreatorReturnButton";
import type { Customer } from "@shared/schema";

export default function Home() {
  const { user, isLoading: authLoading, isAuthenticated } = useAuth();
  const [, navigate] = useLocation();

  // When loaded inside Shopify Admin iframe, always show merchant admin — never the customer landing page.
  // Preserve ?host= and ?shop= so App Bridge CDN script (app-bridge.js) can still read them if it loads later.
  useEffect(() => {
    if (isShopifyEmbedded()) {
      const params = new URLSearchParams(window.location.search);
      const host = params.get("host");
      const shop = params.get("shop");
      const qs = new URLSearchParams();
      if (host) qs.set("host", host);
      if (shop) qs.set("shop", shop);
      const dest = `/admin${qs.toString() ? `?${qs.toString()}` : ""}`;
      navigate(dest);
    }
  }, [navigate]);

  const { data: customer, isLoading: customerLoading } = useQuery<Customer>({
    queryKey: ["/api/customer"],
    enabled: isAuthenticated,
  });


  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Skeleton className="h-32 w-32 rounded-full" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LuxeLandingPage />;
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Palette className="h-6 w-6 text-primary" />
            <h1 className="text-xl font-semibold">AI Art Studio</h1>
          </div>
          <div className="flex items-center gap-4 flex-wrap">
            <CreditDisplay customer={customer} isLoading={customerLoading} />
            <span className="text-sm text-muted-foreground" data-testid="text-username">
              {user?.firstName || user?.email}
            </span>
            <Link href="/admin">
              <Button variant="ghost" size="icon" data-testid="button-admin">
                <Settings className="h-5 w-5" />
              </Button>
            </Link>
            <Button variant="ghost" onClick={() => window.location.href = "/api/logout"} data-testid="button-logout">
              Logout
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <div className="mb-8">
          <h2 className="text-2xl font-bold mb-2">Welcome back, {user?.firstName || "Artist"}!</h2>
          <p className="text-muted-foreground">Create stunning personalized AI artwork printed on premium products.</p>
          <div className="mt-4">
            <LastCreatorReturnButton />
          </div>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <Link href="/designs">
            <Card className="cursor-pointer hover-elevate h-full">
              <CardHeader>
                <Image className="h-8 w-8 text-primary mb-2" />
                <CardTitle>My Designs</CardTitle>
                <CardDescription>
                  View your saved artwork
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  Browse and manage your previously generated designs.
                </p>
              </CardContent>
            </Card>
          </Link>

          <Link href="/orders">
            <Card className="cursor-pointer hover-elevate h-full">
              <CardHeader>
                <ShoppingCart className="h-8 w-8 text-primary mb-2" />
                <CardTitle>My Orders</CardTitle>
                <CardDescription>
                  Track your print orders
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  View order history and track shipments.
                </p>
              </CardContent>
            </Card>
          </Link>
        </div>
      </main>
    </div>
  );
}
