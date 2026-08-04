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
import { ChevronDown, ExternalLink, Loader2, PartyPopper } from "lucide-react";

interface ExistingPage {
  id: string;
  handle: string;
  title: string;
  status: string;
  previewUrl: string;
  productTypeId: number | null;
}

interface CatalogEntry {
  blueprintId: number;
  label: string;
  brand: string | null;
  category: string | null;
  kind: "printify" | "flat" | "aop" | "blocked";
  existingPage?: ExistingPage | null;
}

interface PreviewResult {
  page: { id: string | number; handle: string; title: string; status?: string };
  productTypeId: number;
  previewUrl: string;
  storefrontUrl: string;
  reused?: boolean;
}

type Mode = "preview" | "catalogue";

type ShippingMeta = { shipsFrom?: string[]; shipsTo?: string[] };

/**
 * Platform catalog cards.
 * - preview mode (Setup): Preview many products; per-card Preview Your Page.
 * - catalogue mode (Products Catalogue): same preview CTA + Create Page / Add to store.
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
      ? "Browse ready-to-go products. Preview once per product — reopen anytime. Create Page / Add to store after connecting Printify."
      : "Preview a product from our ready-to-go catalog. Preview once per product; reopen the same page anytime. No Printify account needed until you go Live.";

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
      queryClient.invalidateQueries({ queryKey: ["/api/appai/setup/catalog"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/product-types"] });
      if (result.previewUrl) {
        window.open(result.previewUrl, "_blank");
      }
    },
    onError: (err: Error) => {
      setPendingBlueprintId(null);
      toast({ title: "Couldn't preview that product", description: err.message, variant: "destructive" });
    },
  });

  const printifyDone = !!status?.printifyConnected;

  function resolvePreview(entry: CatalogEntry): PreviewResult | null {
    const local = previewsByBlueprint[entry.blueprintId];
    if (local) return local;
    if (entry.existingPage) {
      return {
        page: {
          id: entry.existingPage.id,
          handle: entry.existingPage.handle,
          title: entry.existingPage.title,
          status: entry.existingPage.status,
        },
        productTypeId: entry.existingPage.productTypeId ?? 0,
        previewUrl: entry.existingPage.previewUrl,
        storefrontUrl: `/pages/${entry.existingPage.handle}`,
        reused: true,
      };
    }
    return null;
  }

  function handleCreatePage(entry: CatalogEntry, existing?: PreviewResult | null) {
    if (!printifyDone) {
      toast({
        title: "Connect Printify first",
        description: "Open Customizer Pages and connect Printify before setting a page Live.",
      });
      navigate("/admin/customizer-pages");
      return;
    }
    if (existing?.page?.id) {
      navigate(`/admin/customizer-pages?promote=${existing.page.id}`);
      return;
    }
    navigate(`/admin/customizer-pages?createFromBlueprint=${entry.blueprintId}`);
  }

  function handleCreateAnother(entry: CatalogEntry) {
    if (!printifyDone) {
      toast({
        title: "Connect Printify first",
        description: "A second page for the same product needs your Printify token and a unique title.",
      });
      navigate("/admin/customizer-pages");
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
                          <Badge variant={preview.page.status === "active" ? "default" : "secondary"}>
                            {preview.page.status === "active"
                              ? "Live"
                              : preview.page.status === "disabled"
                                ? "Disabled"
                                : "Preview available"}
                          </Badge>
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
                          {preview && (
                            <p>
                              Page: /pages/{preview.page.handle} ({preview.page.status || "preview"})
                            </p>
                          )}
                        </CollapsibleContent>
                      </Collapsible>
                    )}

                    {preview ? (
                      <div className="space-y-2 mt-auto">
                        <div className="flex items-center gap-1.5 text-sm text-green-700 dark:text-green-400">
                          <PartyPopper className="h-4 w-4" />
                          {preview.page.status === "active" ? "Live page ready" : "Ready to preview"}
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
                        {preview.page.status !== "active" ? (
                          <Button
                            size="sm"
                            variant="outline"
                            className="w-full"
                            onClick={() => handleCreatePage(entry, preview)}
                          >
                            Add to store
                          </Button>
                        ) : printifyDone ? (
                          <Button
                            size="sm"
                            variant="outline"
                            className="w-full"
                            onClick={() => handleCreateAnother(entry)}
                          >
                            Create another page
                          </Button>
                        ) : null}
                      </div>
                    ) : (
                      <div className="flex flex-col gap-2 mt-auto">
                        <Button
                          size="sm"
                          disabled={isPending}
                          onClick={() => previewMutation.mutate(entry.blueprintId)}
                          data-testid={`button-preview-${entry.blueprintId}`}
                        >
                          {isPending && <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />}
                          Preview
                        </Button>
                        {mode === "catalogue" && (
                          <Button size="sm" variant="outline" onClick={() => handleCreatePage(entry, null)}>
                            Create Page
                          </Button>
                        )}
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
