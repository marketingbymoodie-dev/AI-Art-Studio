import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { queryClient, apiFetch } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useSetupStatus } from "@/hooks/use-setup-status";
import { anyLocationMatchesRegion, type PrintifyShippingRegionId } from "@shared/printifyShippingRegions";
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
import CatalogFilterBar from "@/components/admin/CatalogFilterBar";
import { ChevronDown, Loader2, PartyPopper, Sparkles } from "lucide-react";

interface ExistingProductType {
  id: number;
  name: string;
  printifyProviderId: number | null;
}

interface CatalogEntry {
  blueprintId: number;
  label: string;
  brand: string | null;
  category: string | null;
  kind: "printify" | "flat" | "aop" | "blocked";
  existingProductType?: ExistingProductType | null;
}

interface PreviewResult {
  productTypeId: number;
  productTypeName?: string;
  openInAppPath: string;
  reused?: boolean;
}

type Mode = "preview" | "catalogue";

type ShippingMeta = { shipsFrom?: string[]; shipsTo?: string[] };

/**
 * Platform catalog cards.
 * Preview → import product_type only, open Preview Studio in-app.
 * Create Page → Customizer Pages wizard (provider + cost-based pricing → Live).
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
  const [search, setSearch] = useState("");
  const [shipsFromFilter, setShipsFromFilter] = useState<PrintifyShippingRegionId>("all");
  const [shipsToFilter, setShipsToFilter] = useState<PrintifyShippingRegionId>("all");
  const [categoryFilter, setCategoryFilter] = useState("all");

  const defaultTitle =
    mode === "catalogue" ? "Products Catalogue" : "Preview a Customizer Product";
  const defaultDescription =
    mode === "catalogue"
      ? "Try products in Preview Studio (in-app). Create Page chooses your Printify supplier and applies suggested retail before going Live."
      : "Preview opens the studio inside the app — no storefront page yet. Connect Printify, then Create Page to pick a supplier and set prices.";

  const { data: catalogData, isLoading: catalogLoading } = useQuery<{ entries: CatalogEntry[] }>({
    queryKey: ["/api/appai/setup/catalog"],
  });

  const catalogIds = useMemo(
    () => (catalogData?.entries ?? []).map((e) => e.blueprintId),
    [catalogData?.entries],
  );

  const shippingFilterActive = shipsFromFilter !== "all" || shipsToFilter !== "all";

  const { data: shippingBatch, isFetching: shippingMetaLoading } = useQuery<
    Record<string, ShippingMeta>
  >({
    queryKey: ["/api/admin/printify/blueprints/batch-providers", "catalog-cards", catalogIds],
    queryFn: async () => {
      if (catalogIds.length === 0) return {};
      const res = await fetch("/api/admin/printify/blueprints/batch-providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ blueprintIds: catalogIds }),
      });
      if (!res.ok) return {};
      return res.json();
    },
    enabled: catalogIds.length > 0,
    staleTime: 10 * 60 * 1000,
  });

  const visibleEntries = useMemo(() => {
    const entries = catalogData?.entries ?? [];
    const q = search.trim().toLowerCase();
    return entries.filter((entry) => {
      if (categoryFilter !== "all" && entry.category !== categoryFilter) return false;
      if (q) {
        const hay = [entry.label, entry.brand, entry.category, String(entry.blueprintId)]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (shippingFilterActive) {
        const meta = shippingBatch?.[String(entry.blueprintId)];
        if (!meta) return false;
        if (
          shipsFromFilter !== "all" &&
          !anyLocationMatchesRegion(meta.shipsFrom || [], shipsFromFilter)
        ) {
          return false;
        }
        if (
          shipsToFilter !== "all" &&
          !anyLocationMatchesRegion(meta.shipsTo || [], shipsToFilter)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [
    catalogData?.entries,
    categoryFilter,
    search,
    shippingFilterActive,
    shippingBatch,
    shipsFromFilter,
    shipsToFilter,
  ]);

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
          (typeof body.error === "string" && body.error) || "Failed to prepare this product for preview.",
        );
      }
      return { blueprintId, result: body as PreviewResult };
    },
    onMutate: (blueprintId) => setPendingBlueprintId(blueprintId),
    onSuccess: ({ blueprintId, result }) => {
      setPreviewsByBlueprint((prev) => ({ ...prev, [blueprintId]: result }));
      setPendingBlueprintId(null);
      queryClient.invalidateQueries({ queryKey: ["/api/appai/setup/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/appai/setup/catalog"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/product-types"] });
      queryClient.invalidateQueries({ queryKey: ["/api/appai/blanks"] });
      navigate(result.openInAppPath || `/admin/create-product?productTypeId=${result.productTypeId}`);
    },
    onError: (err: Error) => {
      setPendingBlueprintId(null);
      toast({ title: "Couldn't open preview", description: err.message, variant: "destructive" });
    },
  });

  const printifyDone = !!status?.printifyConnected;

  function resolvePreview(entry: CatalogEntry): PreviewResult | null {
    const local = previewsByBlueprint[entry.blueprintId];
    if (local) return local;
    if (entry.existingProductType) {
      return {
        productTypeId: entry.existingProductType.id,
        productTypeName: entry.existingProductType.name,
        openInAppPath: `/admin/create-product?productTypeId=${entry.existingProductType.id}`,
        reused: true,
      };
    }
    return null;
  }

  function handleCreatePage(entry: CatalogEntry) {
    if (!printifyDone) {
      toast({
        title: "Connect Printify first",
        description: "Create Page needs your Printify token and Shop ID so we can load suppliers and suggested prices.",
      });
      navigate("/admin/settings");
      return;
    }
    navigate(`/admin/customizer-pages?createFromBlueprint=${entry.blueprintId}`);
  }

  const totalCount = catalogData?.entries?.length ?? 0;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">{title ?? defaultTitle}</CardTitle>
          <CardDescription>{description ?? defaultDescription}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <CatalogFilterBar
            search={search}
            onSearchChange={setSearch}
            shipsFrom={shipsFromFilter}
            onShipsFromChange={setShipsFromFilter}
            shipsTo={shipsToFilter}
            onShipsToChange={setShipsToFilter}
            category={categoryFilter}
            onCategoryChange={setCategoryFilter}
            shippingMetaLoading={shippingMetaLoading}
            shippingFilterActive={shippingFilterActive}
            resultCount={visibleEntries.length}
            totalCount={totalCount}
            searchPlaceholder="Search catalogue..."
          />

          {catalogLoading ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Skeleton className="h-28 w-full" />
              <Skeleton className="h-28 w-full" />
              <Skeleton className="h-28 w-full" />
            </div>
          ) : visibleEntries.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {totalCount === 0
                ? "No published catalog products yet. An operator needs to publish items in Platform Catalog."
                : "No products match these filters."}
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {visibleEntries.map((entry) => {
                const isPending = previewMutation.isPending && pendingBlueprintId === entry.blueprintId;
                const preview = resolvePreview(entry);
                const detailsOpen = !!openDetails[entry.blueprintId];
                const justCreated =
                  !!previewsByBlueprint[entry.blueprintId] &&
                  !previewsByBlueprint[entry.blueprintId].reused;

                return (
                  <div
                    key={entry.blueprintId}
                    className="relative rounded-md border p-3 flex flex-col gap-2 overflow-hidden"
                    data-testid={`card-catalog-${mode}-${entry.blueprintId}`}
                  >
                    {justCreated && <ConfettiBurst />}
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-medium text-sm">{entry.label}</p>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <Badge variant="outline">{entry.kind}</Badge>
                        {preview && (
                          <Badge variant="secondary">Ready in app</Badge>
                        )}
                      </div>
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
                          {preview && <p>Imported product type #{preview.productTypeId}</p>}
                        </CollapsibleContent>
                      </Collapsible>
                    )}

                    <div className="flex flex-col gap-2 mt-auto">
                      {preview ? (
                        <>
                          <div className="flex items-center gap-1.5 text-sm text-green-700 dark:text-green-400">
                            <PartyPopper className="h-4 w-4" />
                            Ready in Preview Studio
                          </div>
                          <Button
                            size="sm"
                            className="w-full shimmer-btn"
                            onClick={() => navigate(preview.openInAppPath)}
                            data-testid={`button-open-preview-${entry.blueprintId}`}
                          >
                            <span className="relative z-10 flex items-center justify-center">
                              <Sparkles className="h-3.5 w-3.5 mr-2" />
                              Open Preview Studio
                            </span>
                          </Button>
                        </>
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
                      )}
                      <Button
                        size="sm"
                        variant={preview ? "outline" : "default"}
                        className="w-full"
                        onClick={() => handleCreatePage(entry)}
                      >
                        Create Page
                      </Button>
                    </div>
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
