import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiFetch } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useSetupStatus } from "@/hooks/use-setup-status";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import ConfettiBurst from "@/components/admin/ConfettiBurst";
import { ExternalLink, Loader2, PartyPopper, Store } from "lucide-react";

interface CatalogEntry {
  blueprintId: number;
  label: string;
  brand: string | null;
  category: string | null;
  kind: "printify" | "flat" | "aop" | "blocked";
}

interface ActivateResult {
  page: { id: number; handle: string; title: string };
  productTypeId: number;
  previewUrl: string;
  storefrontUrl: string;
}

/**
 * Setup-style platform catalog: Activate with platform Printify token,
 * preview before merchant connects their own Printify shop.
 */
export default function CatalogActivateSection({
  title = "Choose a Customizer product",
  description = "Pick from our ready-to-go catalog — activated instantly. No Printify account needed until you want customers to see the page.",
}: {
  title?: string;
  description?: string;
}) {
  const { toast } = useToast();
  const { data: status } = useSetupStatus();
  const [activatedBlueprintId, setActivatedBlueprintId] = useState<number | null>(null);
  const [lastResult, setLastResult] = useState<ActivateResult | null>(null);

  const { data: catalogData, isLoading: catalogLoading } = useQuery<{ entries: CatalogEntry[] }>({
    queryKey: ["/api/appai/setup/catalog"],
  });

  const activateMutation = useMutation({
    mutationFn: async (blueprintId: number) => {
      const res = await apiFetch("/api/appai/setup/activate-product", {
        method: "POST",
        body: JSON.stringify({ blueprintId }),
      });
      const body = await res.json().catch(() => ({} as Record<string, unknown>));
      if (!res.ok) {
        const code = String(body.error || "");
        if (code === "SHOP_NOT_ACTIVE" || code === "REAUTH_REQUIRED" || code === "SHOP_NOT_CONNECTED") {
          throw new Error(
            "This shop needs a fresh app connection. Open AI Art Studio again from Shopify Admin → Apps, then retry Activate.",
          );
        }
        throw new Error(
          (typeof body.error === "string" && body.error) || "Failed to activate this product.",
        );
      }
      return body as ActivateResult;
    },
    onMutate: (blueprintId) => setActivatedBlueprintId(blueprintId),
    onSuccess: (data) => {
      setLastResult(data);
      queryClient.invalidateQueries({ queryKey: ["/api/appai/setup/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/appai/customizer-pages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/product-types"] });
      toast({
        title: "Product activated",
        description: `"${data.page.title}" is ready to preview.`,
      });
    },
    onError: (err: Error) => {
      setActivatedBlueprintId(null);
      toast({ title: "Couldn't activate that product", description: err.message, variant: "destructive" });
    },
  });

  const printifyDone = !!status?.printifyConnected;
  const hasPage = (status?.pagesCount ?? 0) > 0 || !!lastResult;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {lastResult && (
            <div className="relative rounded-md border border-green-200 bg-green-50 dark:bg-green-950/30 dark:border-green-900 p-4 overflow-hidden">
              <ConfettiBurst />
              <div className="flex items-center gap-2 mb-2">
                <PartyPopper className="h-5 w-5 text-green-600" />
                <p className="font-medium">"{lastResult.page.title}" is ready to preview!</p>
              </div>
              <Button
                className="shimmer-btn"
                onClick={() => window.open(lastResult.previewUrl, "_blank")}
                data-testid="button-see-your-page-products"
              >
                <span className="relative z-10 flex items-center">
                  <ExternalLink className="h-4 w-4 mr-2" />
                  See your page
                </span>
              </Button>
            </div>
          )}

          {catalogLoading ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : (catalogData?.entries ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No published catalog products yet. An operator needs to publish items in Platform Catalog.
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {(catalogData?.entries ?? []).map((entry) => {
                const isActivating = activateMutation.isPending && activatedBlueprintId === entry.blueprintId;
                const justActivated = lastResult && activatedBlueprintId === entry.blueprintId;
                return (
                  <div
                    key={entry.blueprintId}
                    className="rounded-md border p-3 flex flex-col gap-2"
                    data-testid={`card-catalog-products-${entry.blueprintId}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-medium text-sm">{entry.label}</p>
                      <Badge variant="outline" className="shrink-0">
                        {entry.kind}
                      </Badge>
                    </div>
                    {(entry.brand || entry.category) && (
                      <p className="text-xs text-muted-foreground">
                        {[entry.brand, entry.category].filter(Boolean).join(" · ")}
                      </p>
                    )}
                    <Button
                      size="sm"
                      variant={justActivated ? "outline" : "default"}
                      disabled={isActivating}
                      onClick={() => activateMutation.mutate(entry.blueprintId)}
                      data-testid={`button-activate-products-${entry.blueprintId}`}
                    >
                      {isActivating && <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />}
                      {justActivated ? "Activated" : "Activate"}
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {hasPage && !printifyDone && (
        <Card className="border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800">
          <CardContent className="pt-4 flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex-1 space-y-1">
              <p className="text-sm font-medium">Connect Printify to go live</p>
              <p className="text-sm text-muted-foreground">
                Your pages work in preview. Add your Printify shop in Settings so customers can use them and
                orders can be fulfilled.
              </p>
            </div>
            <Button asChild variant="default" data-testid="button-connect-printify-products">
              <a href="/admin/settings">
                <Store className="h-4 w-4 mr-2" />
                Connect Printify
              </a>
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
