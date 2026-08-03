import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { queryClient, apiFetch } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useSetupStatus } from "@/hooks/use-setup-status";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import ConfettiBurst from "@/components/admin/ConfettiBurst";
import { ChevronDown, ExternalLink, Loader2, PartyPopper } from "lucide-react";

interface CatalogEntry {
  blueprintId: number;
  label: string;
  brand: string | null;
  category: string | null;
  kind: "printify" | "flat" | "aop" | "blocked";
}

interface PreviewResult {
  page: { id: number; handle: string; title: string; status?: string };
  productTypeId: number;
  previewUrl: string;
  storefrontUrl: string;
}

type Mode = "preview" | "catalogue";

/**
 * Platform catalog cards.
 * - preview mode (Setup): Preview many products; per-card Preview Your Page.
 * - catalogue mode (Products Catalogue): details + Create Page / Add to store.
 */
export default function CatalogActivateSection({
  mode = "preview",
  title,
  description,
}: {
  mode?: Mode;
  title?: string;
  description?: string;
}) {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const { data: status } = useSetupStatus();
  const [pendingBlueprintId, setPendingBlueprintId] = useState<number | null>(null);
  const [previewsByBlueprint, setPreviewsByBlueprint] = useState<Record<number, PreviewResult>>({});
  const [openDetails, setOpenDetails] = useState<Record<number, boolean>>({});

  const defaultTitle =
    mode === "catalogue" ? "Products Catalogue" : "Preview a Customizer Product";
  const defaultDescription =
    mode === "catalogue"
      ? "Browse ready-to-go products. Open a card for details, then Create Page to choose provider, variants, and pricing before going Live."
      : "Preview a product from our ready-to-go catalog — Preview instantly to test on your store. No Printify account needed until customers should see the page.";

  const { data: catalogData, isLoading: catalogLoading } = useQuery<{ entries: CatalogEntry[] }>({
    queryKey: ["/api/appai/setup/catalog"],
  });

  const previewMutation = useMutation({
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
            "This shop needs a fresh app connection. Open AI Art Studio again from Shopify Admin → Apps, then retry Preview.",
          );
        }
        throw new Error(
          (typeof body.error === "string" && body.error) || "Failed to preview this product.",
        );
      }
      return { blueprintId, result: body as PreviewResult };
    },
    onMutate: (blueprintId) => setPendingBlueprintId(blueprintId),
    onSuccess: ({ blueprintId, result }) => {
      setPreviewsByBlueprint((prev) => ({ ...prev, [blueprintId]: result }));
      setPendingBlueprintId(null);
      queryClient.invalidateQueries({ queryKey: ["/api/appai/setup/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/appai/customizer-pages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/product-types"] });
      toast({
        title: "Preview ready",
        description: `"${result.page.title}" is ready to open.`,
      });
    },
    onError: (err: Error) => {
      setPendingBlueprintId(null);
      toast({ title: "Couldn't preview that product", description: err.message, variant: "destructive" });
    },
  });

  const printifyDone = !!status?.printifyConnected;

  function handleCreatePage(entry: CatalogEntry, existingPreview?: PreviewResult) {
    if (!printifyDone) {
      toast({
        title: "Connect Printify first",
        description: "Open Customizer Pages and connect Printify before setting a page Live.",
      });
      navigate("/admin/customizer-pages");
      return;
    }
    if (existingPreview?.page?.id) {
      navigate(`/admin/customizer-pages?promote=${existingPreview.page.id}`);
      return;
    }
    navigate(`/admin/customizer-pages?createFromBlueprint=${entry.blueprintId}`);
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">{title ?? defaultTitle}</CardTitle>
          <CardDescription>{description ?? defaultDescription}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {catalogLoading ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Skeleton className="h-28 w-full" />
              <Skeleton className="h-28 w-full" />
              <Skeleton className="h-28 w-full" />
            </div>
          ) : (catalogData?.entries ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No published catalog products yet. An operator needs to publish items in Platform Catalog.
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {(catalogData?.entries ?? []).map((entry) => {
                const isPending = previewMutation.isPending && pendingBlueprintId === entry.blueprintId;
                const preview = previewsByBlueprint[entry.blueprintId];
                const detailsOpen = !!openDetails[entry.blueprintId];

                return (
                  <div
                    key={entry.blueprintId}
                    className="relative rounded-md border p-3 flex flex-col gap-2 overflow-hidden"
                    data-testid={`card-catalog-${mode}-${entry.blueprintId}`}
                  >
                    {preview && mode === "preview" && <ConfettiBurst />}
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

                    {mode === "catalogue" && (
                      <Collapsible
                        open={detailsOpen}
                        onOpenChange={(open) =>
                          setOpenDetails((prev) => ({ ...prev, [entry.blueprintId]: open }))
                        }
                      >
                        <CollapsibleTrigger asChild>
                          <Button variant="ghost" size="sm" className="justify-start px-0 h-8">
                            <ChevronDown
                              className={`h-4 w-4 mr-1 transition-transform ${detailsOpen ? "rotate-180" : ""}`}
                            />
                            Details
                          </Button>
                        </CollapsibleTrigger>
                        <CollapsibleContent className="text-xs text-muted-foreground space-y-1 pb-1">
                          <p>Printify blueprint {entry.blueprintId}</p>
                          <p>Kind: {entry.kind}</p>
                          {preview && (
                            <p>
                              Preview page: /pages/{preview.page.handle} ({preview.page.status || "preview"})
                            </p>
                          )}
                          {/* Live pages shown after product types resolve via pages list when possible */}
                          <p className="text-[11px] opacity-80">
                            Live Customizer Pages are listed under Customizer Pages. Create Page to configure
                            provider, variants, and pricing before going Live.
                          </p>
                        </CollapsibleContent>
                      </Collapsible>
                    )}

                    {mode === "preview" ? (
                      preview ? (
                        <div className="space-y-2">
                          <div className="flex items-center gap-1.5 text-sm text-green-700 dark:text-green-400">
                            <PartyPopper className="h-4 w-4" />
                            Ready to preview
                          </div>
                          <Button
                            size="sm"
                            className="w-full shimmer-btn"
                            onClick={() => window.open(preview.previewUrl, "_blank")}
                            data-testid={`button-open-preview-${entry.blueprintId}`}
                          >
                            <span className="relative z-10 flex items-center justify-center">
                              <ExternalLink className="h-3.5 w-3.5 mr-2" />
                              Preview Your Page
                            </span>
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="w-full"
                            onClick={() => handleCreatePage(entry, preview)}
                          >
                            Add to store
                          </Button>
                        </div>
                      ) : (
                        <Button
                          size="sm"
                          disabled={isPending}
                          onClick={() => previewMutation.mutate(entry.blueprintId)}
                          data-testid={`button-preview-${entry.blueprintId}`}
                        >
                          {isPending && <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />}
                          Preview
                        </Button>
                      )
                    ) : (
                      <div className="flex flex-col gap-2 mt-auto">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={isPending}
                          onClick={() => previewMutation.mutate(entry.blueprintId)}
                        >
                          {isPending && <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />}
                          {preview ? "New preview" : "Preview"}
                        </Button>
                        <Button size="sm" onClick={() => handleCreatePage(entry, preview)}>
                          {preview ? "Add to store" : "Create Page"}
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
