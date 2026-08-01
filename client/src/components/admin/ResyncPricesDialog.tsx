import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DollarSign, Loader2, RefreshCw } from "lucide-react";
import { normalizeVariantLabelForCostMatch } from "@shared/printifyCostLabels";

type BlankVariant = { id: string; title: string; price?: string };

type Blank = {
  productTypeId: number;
  productId: string | null;
  title: string;
  printifyBlueprintId?: number | null;
  variants: BlankVariant[];
};

type CostsResponse = {
  costs: Record<string, number>;
  costsBoth?: Record<string, number>;
  shopifyVariantCosts: Record<string, number>;
  shopifyVariantCostsBoth?: Record<string, number>;
  printifyVariantLabels: Record<string, string>;
  costsByNormalizedLabel?: Record<string, number>;
  costsBothByNormalizedLabel?: Record<string, number>;
  supportsBothSides?: boolean;
  cached: boolean;
};

function roundUpTo95(raw: number): number {
  return Math.ceil(raw) - 0.05;
}

function resolveVariantCostCents(
  v: BlankVariant,
  costs: Record<string, number> | undefined,
  shopifyCosts: Record<string, number> | undefined,
  byLabel: Record<string, number> | undefined,
  printifyVariantLabels: Record<string, string> | undefined,
): number | undefined {
  let costCents: number | undefined = shopifyCosts?.[v.id];
  if (costCents == null && v.id.startsWith("printify:")) {
    costCents = costs?.[v.id.slice("printify:".length)];
  }
  if (costCents == null) costCents = costs?.[v.id];
  if (costCents == null && v.title && byLabel) {
    costCents = byLabel[normalizeVariantLabelForCostMatch(v.title)];
  }
  if (costCents == null && v.title && printifyVariantLabels && costs) {
    const labelToCost: Record<string, number> = {};
    for (const [printifyVid, label] of Object.entries(printifyVariantLabels)) {
      const c = costs[printifyVid];
      if (c != null) labelToCost[normalizeVariantLabelForCostMatch(label)] = c;
    }
    const normTitle = normalizeVariantLabelForCostMatch(v.title);
    costCents = labelToCost[normTitle];
    if (costCents == null) {
      for (const [label, cost] of Object.entries(labelToCost)) {
        if (normTitle.includes(label) || label.includes(normTitle)) {
          costCents = cost;
          break;
        }
      }
    }
  }
  return costCents;
}

export type ResyncPricesDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  productTypeId: number;
  /** When set, POST to customizer-pages sync endpoint */
  customizerPageId?: string;
  onSuccess?: () => void;
};

export default function ResyncPricesDialog({
  open,
  onOpenChange,
  title,
  productTypeId,
  customizerPageId,
  onSuccess,
}: ResyncPricesDialogProps) {
  const { toast } = useToast();
  const [pricesMap, setPricesMap] = useState<Record<string, string>>({});
  const [pricesBothMap, setPricesBothMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [markupPercent, setMarkupPercent] = useState(60);

  const { data: blanksData, isLoading: blanksLoading } = useQuery<{ blanks: Blank[] }>({
    queryKey: ["/api/appai/blanks"],
    enabled: open,
  });

  const blank = useMemo(() => {
    if (!open || !blanksData?.blanks) return null;
    return blanksData.blanks.find((b) => b.productTypeId === productTypeId) ?? null;
  }, [open, blanksData, productTypeId]);

  const variants: BlankVariant[] = useMemo(() => {
    const raw = blank?.variants ?? [];
    const seen = new Set<string>();
    const deduped: BlankVariant[] = [];
    for (const v of raw) {
      if (!seen.has(v.title)) {
        seen.add(v.title);
        deduped.push(v);
      }
    }
    return deduped;
  }, [blank?.variants]);

  const { data: costsData, isLoading: costsLoading, refetch: refetchCosts } = useQuery<CostsResponse>({
    queryKey: ["/api/admin/printify/costs", productTypeId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/admin/printify/costs/${productTypeId}`);
      return res.json();
    },
    enabled: open && !!productTypeId,
  });

  /** Existing front+back retail map saved on the product type (if any). */
  const { data: productTypeRow } = useQuery<{
    id: number;
    variantPricesBoth?: string | Record<string, string> | null;
  }>({
    queryKey: ["/api/admin/product-types", productTypeId, "resync-both"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/admin/product-types");
      const data = await res.json();
      const list = Array.isArray(data) ? data : data.productTypes ?? data ?? [];
      return (list as any[]).find((pt) => Number(pt.id) === Number(productTypeId)) ?? null;
    },
    enabled: open && !!productTypeId,
  });

  const existingBothPrices = useMemo(() => {
    const raw = productTypeRow?.variantPricesBoth;
    if (!raw) return {} as Record<string, string>;
    if (typeof raw === "object") return raw as Record<string, string>;
    try {
      return JSON.parse(raw || "{}") as Record<string, string>;
    } catch {
      return {};
    }
  }, [productTypeRow?.variantPricesBoth]);

  const costsAvailable =
    !!costsData?.costs && Object.keys(costsData.costs).length > 0;

  const supportsBothSidePricing = !!(
    costsData?.supportsBothSides &&
    costsData?.costsBoth &&
    Object.keys(costsData.costsBoth).length > 0
  );

  const recommendedPrices = useMemo(() => {
    if (!costsAvailable || variants.length === 0 || !costsData) return {};
    const result: Record<string, string> = {};
    for (const v of variants) {
      const costCents = resolveVariantCostCents(
        v,
        costsData.costs,
        costsData.shopifyVariantCosts,
        costsData.costsByNormalizedLabel,
        costsData.printifyVariantLabels,
      );
      if (costCents == null) continue;
      const raw = (costCents / 100) * (1 + markupPercent / 100);
      result[v.id] = roundUpTo95(raw).toFixed(2);
    }
    return result;
  }, [costsAvailable, costsData, variants, markupPercent]);

  const recommendedPricesBoth = useMemo(() => {
    if (!supportsBothSidePricing || variants.length === 0 || !costsData) return {};
    const result: Record<string, string> = {};
    for (const v of variants) {
      const costCents = resolveVariantCostCents(
        v,
        costsData.costsBoth,
        costsData.shopifyVariantCostsBoth,
        costsData.costsBothByNormalizedLabel,
        costsData.printifyVariantLabels,
      );
      if (costCents == null) continue;
      const raw = (costCents / 100) * (1 + markupPercent / 100);
      result[v.id] = roundUpTo95(raw).toFixed(2);
    }
    return result;
  }, [supportsBothSidePricing, costsData, variants, markupPercent]);

  useEffect(() => {
    if (!open) {
      setPricesMap({});
      setPricesBothMap({});
      setMarkupPercent(60);
      return;
    }
    const prefilled: Record<string, string> = {};
    for (const v of variants) {
      prefilled[v.id] = v.price && v.price !== "0.00" ? v.price : "";
    }
    setPricesMap(prefilled);

    const prefilledBoth: Record<string, string> = {};
    for (const v of variants) {
      const existing =
        existingBothPrices[v.id] ||
        existingBothPrices[v.title] ||
        "";
      prefilledBoth[v.id] = existing && existing !== "0.00" ? String(existing) : "";
    }
    setPricesBothMap(prefilledBoth);
  }, [open, productTypeId, variants, existingBothPrices]);

  useEffect(() => {
    if (!open || Object.keys(recommendedPrices).length === 0) return;
    setPricesMap((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const [id, price] of Object.entries(recommendedPrices)) {
        if (!next[id] || next[id] === "" || next[id] === "0" || next[id] === "0.00") {
          next[id] = price;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [recommendedPrices, open]);

  useEffect(() => {
    if (!open || !supportsBothSidePricing || Object.keys(recommendedPricesBoth).length === 0) return;
    setPricesBothMap((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const [id, price] of Object.entries(recommendedPricesBoth)) {
        if (!next[id] || next[id] === "" || next[id] === "0" || next[id] === "0.00") {
          next[id] = price;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [recommendedPricesBoth, open, supportsBothSidePricing]);

  async function handleRefreshCosts() {
    try {
      // Clear this product type only (works for platform-owned rows too), then force a fresh GET.
      await apiRequest("POST", "/api/admin/printify/costs/clear-cache", { productTypeId });
      queryClient.removeQueries({ queryKey: ["/api/admin/printify/costs", productTypeId] });
      const result = await refetchCosts();
      const data = result.data;
      const bothReady = !!(data?.supportsBothSides && data?.costsBoth && Object.keys(data.costsBoth).length > 0);
      toast({
        title: bothReady ? "Front + front/back costs loaded" : "Costs refreshed",
        description: bothReady
          ? "Front-only and front+back production costs are ready — Apply All Suggested to fill both columns."
          : "Front costs updated. If this product has a back print area and you still see one column, check Printify Shop ID in Settings and try again.",
      });
    } catch (err: any) {
      toast({
        title: "Could not refresh costs",
        description: err?.message ?? "Unknown error",
        variant: "destructive",
      });
    }
  }

  async function handleSubmit() {
    const prices = Object.fromEntries(
      Object.entries(pricesMap).filter(([, v]) => v && parseFloat(v) > 0),
    );
    if (Object.keys(prices).length === 0) {
      toast({
        title: "No prices entered",
        description: "Please enter at least one front-only price.",
        variant: "destructive",
      });
      return;
    }

    let pricesBoth: Record<string, string> | undefined;
    if (supportsBothSidePricing) {
      pricesBoth = Object.fromEntries(
        Object.entries(pricesBothMap).filter(([, v]) => v && parseFloat(v) > 0),
      );
      for (const [id, front] of Object.entries(prices)) {
        const both = pricesBoth[id];
        if (!both) {
          toast({
            title: "Front+back prices required",
            description: `Enter a front+back price for every variant that has a front price (missing: ${variants.find((v) => v.id === id)?.title ?? id}).`,
            variant: "destructive",
          });
          return;
        }
        if (parseFloat(both) < parseFloat(front)) {
          toast({
            title: "Invalid front+back price",
            description: "Front+back should be at least the front-only price.",
            variant: "destructive",
          });
          return;
        }
      }
    }

    setLoading(true);
    try {
      const endpoint = customizerPageId
        ? `/api/appai/customizer-pages/${customizerPageId}/sync-prices`
        : `/api/admin/product-types/${productTypeId}/sync-prices`;
      const res = await apiRequest("POST", endpoint, {
        variantPrices: prices,
        ...(pricesBoth ? { variantPricesBoth: pricesBoth } : {}),
      });
      const data = await res.json();
      if (data.success) {
        queryClient.invalidateQueries({ queryKey: ["/api/appai/customizer-pages"] });
        queryClient.invalidateQueries({ queryKey: ["/api/product-types"] });
        queryClient.invalidateQueries({ queryKey: ["/api/admin/product-types"] });
        queryClient.invalidateQueries({ queryKey: ["/api/appai/blanks"] });
        toast({
          title: "Prices updated",
          description: pricesBoth
            ? `Updated ${data.successCount} of ${data.totalCount} Shopify (front) prices and saved front+back retail for the storefront.`
            : `Updated ${data.successCount} of ${data.totalCount} variants on Shopify.`,
        });
        onOpenChange(false);
        onSuccess?.();
      } else {
        toast({ title: "Resync failed", description: data.error ?? "Unknown error", variant: "destructive" });
      }
    } catch (err: any) {
      toast({ title: "Resync failed", description: err.message ?? "Unknown error", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  const needsShopify = blank?.productId == null && !customizerPageId;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={`${supportsBothSidePricing ? "max-w-lg" : "max-w-md"} max-h-[min(85vh,720px)] flex flex-col overflow-hidden gap-3 p-5`}
      >
        <DialogHeader className="shrink-0 pr-6">
          <DialogTitle className="flex items-center gap-2 text-base">
            <DollarSign className="h-5 w-5 shrink-0" />
            <span className="truncate">Resync Prices — {title}</span>
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3 min-h-0 flex-1 overflow-hidden">
          <p className="text-sm text-muted-foreground shrink-0">
            Prices are calculated from Printify production costs. Adjust markup and apply suggested prices, or edit individually.
            {supportsBothSidePricing
              ? " Front-only syncs to Shopify; front+back is used when customers choose Print Side = Both."
              : ""}
          </p>

          {needsShopify ? (
            <p className="text-sm text-amber-600 shrink-0">
              This product is not on Shopify yet. Send to store first, then resync prices.
            </p>
          ) : (
            <>
              <div className="flex items-end gap-2 p-3 bg-muted/50 rounded-lg border flex-wrap shrink-0">
                <div className="min-w-[100px]">
                  <Label htmlFor="resync-markup" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Markup
                  </Label>
                  <div className="flex items-center gap-2 mt-1">
                    <Input
                      id="resync-markup"
                      type="number"
                      className="w-20 h-9"
                      value={markupPercent}
                      onChange={(e) => setMarkupPercent(Number(e.target.value))}
                    />
                    <span className="text-sm font-medium">%</span>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9"
                  onClick={() => void handleRefreshCosts()}
                  disabled={costsLoading}
                >
                  <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${costsLoading ? "animate-spin" : ""}`} />
                  Refresh Costs
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  className="h-9"
                  disabled={Object.keys(recommendedPrices).length === 0}
                  onClick={() => {
                    const next: Record<string, string> = {};
                    for (const [id, price] of Object.entries(recommendedPrices)) {
                      next[id] = price;
                    }
                    setPricesMap(next);
                    if (supportsBothSidePricing) {
                      const nextBoth: Record<string, string> = {};
                      for (const [id, price] of Object.entries(recommendedPricesBoth)) {
                        nextBoth[id] = price;
                      }
                      setPricesBothMap(nextBoth);
                    }
                  }}
                >
                  Apply All Suggested
                </Button>
              </div>

              {!supportsBothSidePricing && costsAvailable && (
                <p className="text-xs text-muted-foreground shrink-0">
                  No front+back cost tier yet. Click Refresh Costs — this re-probes Printify for a back print area (takes ~15–30s).
                </p>
              )}

              {blanksLoading || costsLoading ? (
                <Skeleton className="h-32 w-full shrink-0" />
              ) : variants.length === 0 ? (
                <p className="text-sm text-amber-600 shrink-0">
                  No variant data available. Refresh variants on the product first.
                </p>
              ) : (
                <div className="space-y-2 overflow-y-auto pr-1 min-h-0 flex-1">
                  {variants.map((v) => (
                    <div key={v.id} className="space-y-1">
                      <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        {v.title}
                      </Label>
                      <div className={supportsBothSidePricing ? "grid grid-cols-2 gap-2" : undefined}>
                        <div className="space-y-1">
                          <div className="flex justify-between items-end gap-2">
                            <span className="text-[10px] text-muted-foreground">
                              {supportsBothSidePricing ? "Front only" : "Retail"}
                            </span>
                            {recommendedPrices[v.id] ? (
                              <span className="text-[10px] text-muted-foreground">
                                Suggested: ${recommendedPrices[v.id]}
                              </span>
                            ) : null}
                          </div>
                          <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                            <Input
                              className="pl-7 text-sm h-9"
                              placeholder="0.00"
                              value={pricesMap[v.id] ?? ""}
                              onChange={(e) => setPricesMap({ ...pricesMap, [v.id]: e.target.value })}
                            />
                          </div>
                        </div>
                        {supportsBothSidePricing && (
                          <div className="space-y-1">
                            <div className="flex justify-between items-end gap-2">
                              <span className="text-[10px] text-muted-foreground">Front + back</span>
                              {recommendedPricesBoth[v.id] ? (
                                <span className="text-[10px] text-muted-foreground">
                                  Suggested: ${recommendedPricesBoth[v.id]}
                                </span>
                              ) : null}
                            </div>
                            <div className="relative">
                              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                              <Input
                                className="pl-7 text-sm h-9"
                                placeholder="0.00"
                                value={pricesBothMap[v.id] ?? ""}
                                onChange={(e) => setPricesBothMap({ ...pricesBothMap, [v.id]: e.target.value })}
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          <div className="flex gap-2 pt-1 shrink-0 border-t">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => onOpenChange(false)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button
              className="flex-1"
              onClick={() => void handleSubmit()}
              disabled={loading || needsShopify || variants.length === 0}
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Syncing…
                </>
              ) : (
                <>
                  <RefreshCw className="h-4 w-4 mr-2" /> Resync Prices
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
