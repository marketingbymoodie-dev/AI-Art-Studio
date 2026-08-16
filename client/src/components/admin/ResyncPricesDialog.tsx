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
import { resolveVariantCostCents } from "@shared/printifyCostLabels";
import {
  condenseVariantPriceRows,
  unifySameSizeSuggestedPrices,
} from "@shared/condenseVariantPrices";
import {
  DEFAULT_MARKUP_PERCENT,
  isNonPositiveRetailPrice,
  resolveMarkupPercent,
  roundUpTo95,
} from "@shared/productIntelligence";

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

/** True when the field is empty or would sync as $0 / free. */
function isZeroOrEmptyPrice(value: string | undefined | null): boolean {
  return isNonPositiveRetailPrice(value);
}

function lookupVariantCostCents(
  v: BlankVariant,
  costs: Record<string, number> | undefined,
  shopifyCosts: Record<string, number> | undefined,
  byLabel: Record<string, number> | undefined,
  printifyVariantLabels: Record<string, string> | undefined,
): number | undefined {
  return resolveVariantCostCents(v, {
    costs,
    shopifyVariantCosts: shopifyCosts,
    costsByNormalizedLabel: byLabel,
    printifyVariantLabels,
  });
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
  const [markupPercent, setMarkupPercent] = useState(DEFAULT_MARKUP_PERCENT);

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

  const { data: costsData, isLoading: costsLoading } = useQuery<CostsResponse>({
    queryKey: ["/api/admin/printify/costs", productTypeId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/admin/printify/costs/${productTypeId}`);
      return res.json();
    },
    enabled: open && !!productTypeId,
  });

  /** Existing front+back retail map + markup saved on the product type (if any). */
  const { data: productTypeRow } = useQuery<{
    id: number;
    variantPricesBoth?: string | Record<string, string> | null;
    defaultMarkupPercent?: number | null;
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

  useEffect(() => {
    if (!open) return;
    setMarkupPercent(resolveMarkupPercent(productTypeRow?.defaultMarkupPercent));
  }, [open, productTypeRow?.defaultMarkupPercent]);

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
      const costCents = lookupVariantCostCents(
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
    return unifySameSizeSuggestedPrices(variants, result);
  }, [costsAvailable, costsData, variants, markupPercent]);

  const recommendedPricesBoth = useMemo(() => {
    if (!supportsBothSidePricing || variants.length === 0 || !costsData) return {};
    const result: Record<string, string> = {};
    for (const v of variants) {
      const costCents = lookupVariantCostCents(
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
    return unifySameSizeSuggestedPrices(variants, result);
  }, [supportsBothSidePricing, costsData, variants, markupPercent]);

  const condensedPriceRows = useMemo(() => {
    const rows = condenseVariantPriceRows(
      variants,
      pricesMap,
      pricesBothMap,
      supportsBothSidePricing,
    );
    if (!costsAvailable) return rows;
    const matched = rows.filter((row) =>
      row.variantIds.some((id) => {
        const v = variants.find((x) => x.id === id);
        return (
          v != null &&
          lookupVariantCostCents(
            v,
            costsData?.costs,
            costsData?.shopifyVariantCosts,
            costsData?.costsByNormalizedLabel,
            costsData?.printifyVariantLabels,
          ) != null
        );
      }),
    );
    return matched.length > 0 ? matched : rows;
  }, [variants, pricesMap, pricesBothMap, supportsBothSidePricing, costsAvailable, costsData]);

  function setGroupRetailPrice(variantIds: string[], value: string) {
    setPricesMap((prev) => {
      const next = { ...prev };
      for (const id of variantIds) next[id] = value;
      return next;
    });
  }

  function setGroupRetailPriceBoth(variantIds: string[], value: string) {
    setPricesBothMap((prev) => {
      const next = { ...prev };
      for (const id of variantIds) next[id] = value;
      return next;
    });
  }

  // Reset maps only when the dialog opens / product changes — NOT when
  // existingBothPrices arrives later (that used to wipe suggested front prices
  // back to blank/"0.00" while leaving the front+back column filled).
  useEffect(() => {
    if (!open) {
      setPricesMap({});
      setPricesBothMap({});
      setMarkupPercent(DEFAULT_MARKUP_PERCENT);
      return;
    }
    const prefilled: Record<string, string> = {};
    for (const v of variants) {
      // Blanks API hardcodes price "0.00" until Shopify is merged — never treat that as real.
      prefilled[v.id] = v.price && !isZeroOrEmptyPrice(v.price) ? v.price : "";
    }
    setPricesMap(prefilled);
  }, [open, productTypeId, variants]);

  useEffect(() => {
    if (!open) return;
    setPricesBothMap((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const v of variants) {
        if (!isZeroOrEmptyPrice(next[v.id])) continue;
        const existing =
          existingBothPrices[v.id] ||
          existingBothPrices[v.title] ||
          "";
        if (!isZeroOrEmptyPrice(existing)) {
          next[v.id] = String(existing);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [open, productTypeId, variants, existingBothPrices]);

  useEffect(() => {
    if (!open || Object.keys(recommendedPrices).length === 0) return;
    setPricesMap((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const [id, price] of Object.entries(recommendedPrices)) {
        if (isZeroOrEmptyPrice(next[id]) && !isZeroOrEmptyPrice(price)) {
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
        if (isZeroOrEmptyPrice(next[id]) && !isZeroOrEmptyPrice(price)) {
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
      const res = await apiRequest(
        "GET",
        `/api/admin/printify/costs/${productTypeId}?refresh=1`,
      );
      const data = (await res.json()) as CostsResponse;
      queryClient.setQueryData(["/api/admin/printify/costs", productTypeId], data);
      const frontCount = data?.costs ? Object.keys(data.costs).length : 0;
      const bothReady = !!(data?.supportsBothSides && data?.costsBoth && Object.keys(data.costsBoth).length > 0);
      if (frontCount === 0) {
        toast({
          title: "No production costs found",
          description:
            data && (data as any).error
              ? String((data as any).error)
              : "Printify returned no costs. Common causes: Printify Shop ID missing in Settings, or the provider is fully out of stock (temp cost probes can fail). Try again when stock returns, or set prices manually.",
          variant: "destructive",
        });
        return;
      }
      toast({
        title: bothReady ? "Front + front/back costs loaded" : "Costs refreshed",
        description: bothReady
          ? "Front-only and front+back production costs are ready — Apply All Suggested to fill both columns."
          : `Loaded ${frontCount} front costs, but Printify did not return a higher front+back tier. The probe must place art on the back (same as Printify's own quote). Check Printify Shop ID in Settings and try Refresh Costs again.`,
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
    // Hard guard: never sync $0.00 / blank rows (Shopify product create often
    // leaves 0.00 — a partial resync must not leave free variants for sale).
    const missingFront = variants.filter((v) => isZeroOrEmptyPrice(pricesMap[v.id]));
    if (missingFront.length > 0) {
      toast({
        title: "Cannot sync $0.00 prices",
        description: `${missingFront.length} variant(s) still have a blank or $0.00 front price (e.g. ${missingFront[0].title}). Click Apply All Suggested, or enter a positive price for every row.`,
        variant: "destructive",
      });
      return;
    }

    const prices = Object.fromEntries(
      variants.map((v) => [v.id, parseFloat(String(pricesMap[v.id])).toFixed(2)]),
    );

    let pricesBoth: Record<string, string> | undefined;
    if (supportsBothSidePricing) {
      const missingBoth = variants.filter((v) => isZeroOrEmptyPrice(pricesBothMap[v.id]));
      if (missingBoth.length > 0) {
        toast({
          title: "Cannot sync $0.00 front+back prices",
          description: `${missingBoth.length} variant(s) still have a blank or $0.00 front+back price (e.g. ${missingBoth[0].title}). Click Apply All Suggested, or fill every front+back field.`,
          variant: "destructive",
        });
        return;
      }
      pricesBoth = Object.fromEntries(
        variants.map((v) => [v.id, parseFloat(String(pricesBothMap[v.id])).toFixed(2)]),
      );
      for (const v of variants) {
        const front = parseFloat(prices[v.id]!);
        const both = parseFloat(pricesBoth[v.id]!);
        if (both < front) {
          toast({
            title: "Invalid front+back price",
            description: `Front+back must be at least the front-only price (${v.title}).`,
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
        defaultMarkupPercent: markupPercent,
      });
      const data = await res.json();
      if (data.success) {
        queryClient.invalidateQueries({ queryKey: ["/api/appai/customizer-pages"] });
        queryClient.invalidateQueries({ queryKey: ["/api/product-types"] });
        queryClient.invalidateQueries({ queryKey: ["/api/admin/product-types"] });
        queryClient.invalidateQueries({ queryKey: ["/api/appai/blanks"] });
        const partial = data.successCount < data.totalCount;
        const unresolved = Number(data.unresolvedCount || 0);
        if (pricesBoth && !data.bothPricesSaved) {
          toast({
            title: "Front prices updated — front+back not saved",
            description:
              "Shopify front prices synced, but the front+back retail map was not stored. Refresh Costs, Apply All Suggested, and Resync again.",
            variant: "destructive",
          });
        } else if (partial) {
          const failedSample = Array.isArray(data.updated)
            ? (data.updated as Array<{ success?: boolean; error?: string }>)
                .filter((u) => !u.success && u.error)
                .slice(0, 2)
                .map((u) => u.error)
                .join(" · ")
            : "";
          toast({
            title: "Prices partially updated",
            description:
              unresolved > 0
                ? `Updated ${data.successCount} of ${data.totalCount}. ${unresolved} blank rows could not be matched to a Shopify variant (color/size name mismatch or missing on Shopify). Re-send the product to Shopify if colors were changed, then Resync again.`
                : `Updated ${data.successCount} of ${data.totalCount}. Some Shopify price writes failed${failedSample ? ` (${failedSample})` : " — often rate limits; try Resync again"}.`,
            variant: "destructive",
          });
        } else {
          toast({
            title: "Prices updated",
            description: pricesBoth
              ? `Updated ${data.successCount} of ${data.totalCount} Shopify (front) prices and saved front+back retail for the storefront.`
              : `Updated ${data.successCount} of ${data.totalCount} variants on Shopify.`,
          });
        }
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
                    const next: Record<string, string> = { ...pricesMap };
                    let applied = 0;
                    for (const [id, price] of Object.entries(recommendedPrices)) {
                      if (isZeroOrEmptyPrice(price)) continue;
                      next[id] = price;
                      applied += 1;
                    }
                    setPricesMap(next);
                    if (supportsBothSidePricing) {
                      const nextBoth: Record<string, string> = { ...pricesBothMap };
                      for (const [id, price] of Object.entries(recommendedPricesBoth)) {
                        if (isZeroOrEmptyPrice(price)) continue;
                        nextBoth[id] = price;
                      }
                      setPricesBothMap(nextBoth);
                    }
                    if (applied === 0) {
                      toast({
                        title: "No suggested prices to apply",
                        description: "Refresh Costs first, or enter prices manually. $0.00 is never applied.",
                        variant: "destructive",
                      });
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

              {!costsLoading && !costsAvailable && variants.length > 0 && (
                <p className="text-xs text-amber-700 shrink-0">
                  No Printify production costs loaded yet. Click Refresh Costs. If the Printify listing is fully out of stock, suggested prices may stay empty — enter retail manually or retry when stock returns.
                </p>
              )}

              {variants.some((v) => isZeroOrEmptyPrice(pricesMap[v.id]) || (supportsBothSidePricing && isZeroOrEmptyPrice(pricesBothMap[v.id]))) && (
                <p className="text-xs text-red-700 shrink-0 font-medium">
                  Blank or $0.00 prices are blocked from syncing — fill every row (Apply All Suggested) before Resync.
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
                  {condensedPriceRows.length > 6 && (
                    <p className="text-[10px] text-muted-foreground">
                      {condensedPriceRows.length} price groups ({variants.length} variants) — same-price colours share a row
                    </p>
                  )}
                  {condensedPriceRows.map((row) => {
                    const suggestedFront = (() => {
                      const vals = new Set(
                        row.variantIds.map((id) => recommendedPrices[id]).filter(Boolean),
                      );
                      return vals.size === 1 ? Array.from(vals)[0] : undefined;
                    })();
                    const suggestedBoth = (() => {
                      const vals = new Set(
                        row.variantIds.map((id) => recommendedPricesBoth[id]).filter(Boolean),
                      );
                      return vals.size === 1 ? Array.from(vals)[0] : undefined;
                    })();
                    const frontEmpty = row.variantIds.some((id) => isZeroOrEmptyPrice(pricesMap[id]));
                    const bothEmpty =
                      supportsBothSidePricing &&
                      row.variantIds.some((id) => isZeroOrEmptyPrice(pricesBothMap[id]));
                    return (
                      <div key={row.key} className="space-y-1">
                        <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          {row.label}
                        </Label>
                        <div className={supportsBothSidePricing ? "grid grid-cols-2 gap-2" : undefined}>
                          <div className="space-y-1">
                            <div className="flex justify-between items-end gap-2">
                              <span className="text-[10px] text-muted-foreground">
                                {supportsBothSidePricing ? "Front only" : "Retail"}
                              </span>
                              {suggestedFront ? (
                                <span className="text-[10px] text-muted-foreground">
                                  Suggested: ${suggestedFront}
                                </span>
                              ) : null}
                            </div>
                            <div className="relative">
                              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                              <Input
                                className={`pl-7 text-sm h-9 ${frontEmpty ? "border-red-500 focus-visible:ring-red-500" : ""}`}
                                placeholder="enter price"
                                value={row.price}
                                onChange={(e) => setGroupRetailPrice(row.variantIds, e.target.value)}
                              />
                            </div>
                          </div>
                          {supportsBothSidePricing && (
                            <div className="space-y-1">
                              <div className="flex justify-between items-end gap-2">
                                <span className="text-[10px] text-muted-foreground">Front + back</span>
                                {suggestedBoth ? (
                                  <span className="text-[10px] text-muted-foreground">
                                    Suggested: ${suggestedBoth}
                                  </span>
                                ) : null}
                              </div>
                              <div className="relative">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                                <Input
                                  className={`pl-7 text-sm h-9 ${bothEmpty ? "border-red-500 focus-visible:ring-red-500" : ""}`}
                                  placeholder="enter price"
                                  value={row.priceBoth}
                                  onChange={(e) => setGroupRetailPriceBoth(row.variantIds, e.target.value)}
                                />
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
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
