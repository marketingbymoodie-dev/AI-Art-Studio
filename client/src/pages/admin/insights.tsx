import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueries, useQuery } from "@tanstack/react-query";
import AdminLayout from "@/components/admin-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  merchantProfitCents,
  monthlyNetProfitCents,
  subscriptionBreakEvenUnits,
  DEFAULT_MARKUP_PERCENT,
  suggestedRetailCents,
} from "@shared/productIntelligence";
import {
  collapseBlankTitlesToSizes,
  collapseToPriceDriverVariants,
  ESTIMATOR_PAID_PLANS,
  mergePriceDriverSources,
  priceDriversFromCostsPayload,
  stripProviderSuffix,
  type MixLine,
  type PriceDriverVariant,
} from "@shared/planEstimator";
import { usePlanGenerationQuota } from "@/components/admin/GenerationQuotaUsage";
import PlanGenerationEstimator from "@/components/admin/PlanGenerationEstimator";
import { Loader2, Plus, Trash2 } from "lucide-react";

type ProductTypeRow = {
  id: number;
  name: string;
  printifyBlueprintId?: number | null;
  printifyProviderId?: number | null;
  defaultMarkupPercent?: number | null;
  pricingStrategy?: string | null;
};

type PiVariant = {
  supplierVariantId: string;
  variantName?: string | null;
  size?: string | null;
  color?: string | null;
  printAreaKey: string;
  baseCogsCents?: number | null;
  shippingFirstItemUsCents?: number | null;
  available: boolean;
};

type Blank = {
  productTypeId: number;
  title: string;
  printifyBlueprintId?: number | null;
  printifyProviderId?: number | null;
  printifyProviderName?: string | null;
  variants: Array<{ id: string; title: string }>;
};

type CostsPayload = {
  costs?: Record<string, number>;
  costsBoth?: Record<string, number>;
  printifyVariantLabels?: Record<string, string>;
  supportsBothSides?: boolean;
};

type MixRow = {
  id: string;
  productTypeId: string;
  variantKey: string;
  retailDollars: string;
  monthlyUnits: number;
};

type PickerProduct = {
  productTypeId: number;
  label: string;
  printifyBlueprintId: number | null;
  printifyProviderId: number | null;
};

function newMixRow(): MixRow {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    productTypeId: "",
    variantKey: "",
    retailDollars: "",
    monthlyUnits: 10,
  };
}

/** One row per blueprint+provider; clean titles; prefer blanks (merchant-scoped). */
function buildPickerProducts(
  blanks: Blank[] | undefined,
  productTypes: ProductTypeRow[] | undefined,
): PickerProduct[] {
  const byKey = new Map<string, PickerProduct>();

  const consider = (args: {
    productTypeId: number;
    name: string;
    blueprintId: number | null;
    providerId: number | null;
    providerName?: string | null;
  }) => {
    const blueprintId = args.blueprintId != null ? Number(args.blueprintId) : null;
    const providerId = args.providerId != null ? Number(args.providerId) : null;
    if (blueprintId == null) return;
    const key = `${blueprintId}:${providerId ?? "x"}`;
    const clean = stripProviderSuffix(args.name) || args.name;
    const label =
      args.providerName && !/printify choice/i.test(args.providerName)
        ? `${clean} (${args.providerName})`
        : clean;
    const existing = byKey.get(key);
    if (!existing || args.productTypeId > existing.productTypeId) {
      byKey.set(key, {
        productTypeId: args.productTypeId,
        label,
        printifyBlueprintId: blueprintId,
        printifyProviderId: providerId,
      });
    }
  };

  for (const b of blanks ?? []) {
    consider({
      productTypeId: b.productTypeId,
      name: b.title,
      blueprintId: b.printifyBlueprintId ?? null,
      providerId: b.printifyProviderId ?? null,
      providerName: b.printifyProviderName,
    });
  }
  for (const pt of productTypes ?? []) {
    consider({
      productTypeId: pt.id,
      name: pt.name,
      blueprintId: pt.printifyBlueprintId ?? null,
      providerId: pt.printifyProviderId ?? null,
    });
  }

  return [...byKey.values()].sort((a, b) => a.label.localeCompare(b.label));
}

export default function AdminInsightsPage() {
  const { toast } = useToast();
  const { data: planData } = usePlanGenerationQuota();
  const [rows, setRows] = useState<MixRow[]>(() => [newMixRow()]);
  const currentPlanName = planData?.planName || "starter";
  const [roiPlanName, setRoiPlanName] = useState(currentPlanName);
  const [syncingPtId, setSyncingPtId] = useState<string | null>(null);

  const fetchCostsMutation = useMutation({
    mutationFn: async (productTypeId: string) => {
      setSyncingPtId(productTypeId);
      try {
        await apiRequest("POST", `/api/admin/product-types/${productTypeId}/product-sync`);
      } catch {
        /* still try costs */
      }
      const res = await apiRequest("GET", `/api/admin/printify/costs/${productTypeId}?legacy=1`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Could not load COGS");
      }
      return { productTypeId, data: await res.json() };
    },
    onSuccess: ({ productTypeId, data }) => {
      queryClient.setQueryData(["/api/admin/printify/costs", productTypeId, "insights"], data);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/product-intelligence", productTypeId] });
      toast({ title: "Costs refreshed", description: "Size / print options updated." });
    },
    onError: (err: Error) => {
      toast({ title: "COGS unavailable", description: err.message, variant: "destructive" });
    },
    onSettled: () => setSyncingPtId(null),
  });

  useEffect(() => {
    setRoiPlanName(currentPlanName);
  }, [currentPlanName]);

  const { data: productTypes, isLoading: ptsLoading } = useQuery<ProductTypeRow[]>({
    queryKey: ["/api/admin/product-types"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/admin/product-types");
      const data = await res.json();
      const list = Array.isArray(data) ? data : data.productTypes ?? [];
      return list.filter((pt: ProductTypeRow) => pt.printifyBlueprintId != null);
    },
  });

  const { data: blanksData, isLoading: blanksLoading } = useQuery<{ blanks: Blank[] }>({
    queryKey: ["/api/appai/blanks"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/appai/blanks");
      if (!res.ok) return { blanks: [] };
      return res.json();
    },
  });

  const pickerProducts = useMemo(
    () => buildPickerProducts(blanksData?.blanks, productTypes),
    [blanksData?.blanks, productTypes],
  );

  const productIds = useMemo(
    () => [...new Set(rows.map((r) => r.productTypeId).filter(Boolean))],
    [rows],
  );

  const piQueries = useQueries({
    queries: productIds.map((id) => ({
      queryKey: ["/api/admin/product-intelligence", id],
      queryFn: async () => {
        const res = await apiRequest("GET", `/api/admin/product-intelligence/${id}`);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || "Failed to load Product Intelligence");
        }
        return res.json() as Promise<{ variants: PiVariant[]; productType?: ProductTypeRow }>;
      },
      enabled: !!id,
      staleTime: 60_000,
    })),
  });

  const costsQueries = useQueries({
    queries: productIds.map((id) => ({
      queryKey: ["/api/admin/printify/costs", id, "insights"],
      queryFn: async () => {
        const res = await apiRequest("GET", `/api/admin/printify/costs/${id}`);
        if (!res.ok) {
          // Soft-fail: UI can still use PI / blanks
          return null as CostsPayload | null;
        }
        return res.json() as Promise<CostsPayload>;
      },
      enabled: !!id,
      staleTime: 60_000,
      retry: 1,
    })),
  });

  const piByProductId = useMemo(() => {
    const map = new Map<string, { variants: PiVariant[]; productType?: ProductTypeRow }>();
    productIds.forEach((id, i) => {
      const data = piQueries[i]?.data;
      if (data) map.set(id, data);
    });
    return map;
  }, [productIds, piQueries]);

  const costsByProductId = useMemo(() => {
    const map = new Map<string, CostsPayload>();
    productIds.forEach((id, i) => {
      const data = costsQueries[i]?.data;
      if (data) map.set(id, data);
    });
    return map;
  }, [productIds, costsQueries]);

  const loadingByProductId = useMemo(() => {
    const map = new Map<string, boolean>();
    productIds.forEach((id, i) => {
      const piBusy = !!(piQueries[i]?.isLoading || piQueries[i]?.isFetching);
      const costsBusy = !!(costsQueries[i]?.isLoading || costsQueries[i]?.isFetching);
      map.set(id, piBusy || costsBusy);
    });
    return map;
  }, [productIds, piQueries, costsQueries]);

  const variantsForProduct = (productTypeId: string): PriceDriverVariant[] => {
    if (!productTypeId) return [];
    const costs = costsByProductId.get(productTypeId);
    const fromCosts = priceDriversFromCostsPayload({
      costs: costs?.costs,
      costsBoth: costs?.costsBoth,
      printifyVariantLabels: costs?.printifyVariantLabels,
    });
    const pi = piByProductId.get(productTypeId);
    const fromPi = collapseToPriceDriverVariants(pi?.variants ?? []);
    const blank = blanksData?.blanks?.find((b) => String(b.productTypeId) === productTypeId);
    const fromBlanks = blank?.variants?.length
      ? collapseBlankTitlesToSizes(blank.variants)
      : [];
    return mergePriceDriverSources({ fromCosts, fromPi, fromBlanks });
  };

  useEffect(() => {
    setRows((prev) =>
      prev.map((row) => {
        if (!row.productTypeId || !row.variantKey) return row;
        const opts = variantsForProduct(row.productTypeId);
        if (opts.some((v) => v.key === row.variantKey)) return row;
        return { ...row, variantKey: "" };
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [piByProductId, costsByProductId, blanksData]);

  const roiPlanMeta = ESTIMATOR_PAID_PLANS.find((p) => p.planName === roiPlanName);
  const planPrice = roiPlanMeta?.priceUsd ?? 29;
  const planLabel = roiPlanMeta?.displayName || roiPlanName.replace("_", " ");
  const livePlanLabel =
    ESTIMATOR_PAID_PLANS.find((p) => p.planName === currentPlanName)?.displayName ||
    currentPlanName.replace("_", " ");

  const lineCalcs = useMemo(() => {
    return rows.map((row) => {
      const picker = pickerProducts.find((p) => String(p.productTypeId) === row.productTypeId);
      const pt = productTypes?.find((p) => String(p.id) === row.productTypeId);
      const markup = pt?.defaultMarkupPercent ?? DEFAULT_MARKUP_PERCENT;
      const variant = variantsForProduct(row.productTypeId).find((v) => v.key === row.variantKey);
      const cogsCents = variant?.cogsCents ?? null;
      const shippingCents = variant?.shippingCents ?? null;
      const landed =
        cogsCents != null
          ? cogsCents + (shippingCents != null && shippingCents > 0 ? shippingCents : 0)
          : null;
      const parsedRetail = parseFloat(row.retailDollars);
      const retailCents =
        Number.isFinite(parsedRetail) && parsedRetail > 0
          ? Math.round(parsedRetail * 100)
          : suggestedRetailCents(cogsCents, markup ?? DEFAULT_MARKUP_PERCENT);
      const profitPerSale = merchantProfitCents(retailCents, landed ?? cogsCents);
      const units = Number.isFinite(row.monthlyUnits) ? Math.max(0, row.monthlyUnits) : 0;
      const monthlyProfit =
        profitPerSale != null ? Math.round(profitPerSale * units) : null;
      return {
        row,
        label: picker?.label || pt?.name || "Product",
        variantLabel: variant?.label || "—",
        cogsCents,
        shippingCents,
        profitPerSale,
        monthlyProfit,
        units,
      };
    });
  }, [rows, productTypes, pickerProducts, piByProductId, costsByProductId, blanksData]);

  const totalMonthlyProfitCents = lineCalcs.reduce(
    (sum, l) => sum + (l.monthlyProfit ?? 0),
    0,
  );
  const hasAnyProfit = lineCalcs.some((l) => l.monthlyProfit != null);
  const totalUnits = lineCalcs.reduce((sum, l) => sum + l.units, 0);
  const blendedProfitPerSale =
    totalUnits > 0 && hasAnyProfit
      ? Math.round(totalMonthlyProfitCents / totalUnits)
      : null;
  const monthlyNet = monthlyNetProfitCents({
    profitPerSaleCents: blendedProfitPerSale,
    monthlySales: totalUnits,
    subscriptionUsd: planPrice,
  });
  const breakEven = subscriptionBreakEvenUnits(planPrice, blendedProfitPerSale);

  const estimatorLines: MixLine[] = useMemo(
    () =>
      rows.map((r) => {
        const picker = pickerProducts.find((p) => String(p.productTypeId) === r.productTypeId);
        return {
          id: r.id,
          label: picker?.label || r.productTypeId || "Product",
          monthlyUnits: r.monthlyUnits,
        };
      }),
    [rows, pickerProducts],
  );

  const updateRow = (id: string, patch: Partial<MixRow>) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  const listLoading = ptsLoading || blanksLoading;

  return (
    <AdminLayout>
      <div className="space-y-6 max-w-4xl">
        <div>
          <h1 className="text-2xl font-bold">Profit Insights</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Multi-product profit mix (size + print area). COGS load from Product Intelligence / Printify
            costs — front+back appears when the supplier supports it.
          </p>
        </div>

        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-2">
            <div>
              <CardTitle className="text-base">Merchant profit calculator</CardTitle>
              <CardDescription>
                {pickerProducts.length} products available (duplicates by supplier removed).
              </CardDescription>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => setRows([...rows, newMixRow()])}>
              <Plus className="h-3.5 w-3.5 mr-1" />
              Add product
            </Button>
          </CardHeader>
          <CardContent className="space-y-5">
            {listLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading your product catalogue…
              </div>
            ) : (
              rows.map((row, idx) => {
                const variants = variantsForProduct(row.productTypeId);
                const busy = row.productTypeId ? !!loadingByProductId.get(row.productTypeId) : false;
                const calc = lineCalcs[idx];
                const markup =
                  productTypes?.find((p) => String(p.id) === row.productTypeId)?.defaultMarkupPercent ??
                  DEFAULT_MARKUP_PERCENT;
                const hasBoth = variants.some((v) => v.printAreaKey === "both");

                return (
                  <div key={row.id} className="rounded-md border p-3 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium">Product {idx + 1}</p>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        disabled={rows.length <= 1}
                        onClick={() => setRows(rows.filter((r) => r.id !== row.id))}
                        aria-label="Remove product"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label>Product</Label>
                        <Select
                          value={row.productTypeId || undefined}
                          onValueChange={(v) =>
                            updateRow(row.id, {
                              productTypeId: v,
                              variantKey: "",
                              retailDollars: "",
                            })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select a product" />
                          </SelectTrigger>
                          <SelectContent position="popper" className="z-[100] max-h-80">
                            {pickerProducts.map((pt) => (
                              <SelectItem key={pt.productTypeId} value={String(pt.productTypeId)}>
                                {pt.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <Label>Size / print area</Label>
                        {busy ? (
                          <div className="flex h-10 items-center gap-2 rounded-md border px-3 text-sm text-muted-foreground">
                            <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                            Loading sizes &amp; COGS…
                          </div>
                        ) : !row.productTypeId ? (
                          <p className="text-xs text-muted-foreground pt-2">Pick a product first</p>
                        ) : variants.length === 0 ? (
                          <p className="text-xs text-muted-foreground rounded-md border p-2">
                            No size options yet. Open Products Catalogue and run{" "}
                            <span className="font-medium">Product Sync</span> on this product.
                          </p>
                        ) : (
                          <>
                            <Select
                              value={row.variantKey || undefined}
                              onValueChange={(v) => updateRow(row.id, { variantKey: v })}
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Select size / print" />
                              </SelectTrigger>
                              <SelectContent position="popper" className="z-[100] max-h-72">
                                {variants.map((v) => (
                                  <SelectItem key={v.key} value={v.key}>
                                    {v.label}
                                    {v.cogsCents != null
                                      ? ` — $${(v.cogsCents / 100).toFixed(2)}`
                                      : " — no COGS"}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            {!hasBoth && !busy && (
                              <p className="text-[11px] text-muted-foreground">
                                Front+back not listed — this supplier/cost cache only has front (or is AOP).
                              </p>
                            )}
                            {!busy &&
                              variants.length > 0 &&
                              variants.every((v) => v.cogsCents == null) && (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="h-8"
                                  disabled={syncingPtId === row.productTypeId}
                                  onClick={() => fetchCostsMutation.mutate(row.productTypeId)}
                                >
                                  {syncingPtId === row.productTypeId ? (
                                    <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                                  ) : null}
                                  Fetch COGS
                                </Button>
                              )}
                          </>
                        )}
                      </div>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-3">
                      <div className="space-y-2">
                        <Label>Retail (USD)</Label>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          placeholder={
                            suggestedRetailCents(calc?.cogsCents, markup) != null
                              ? (suggestedRetailCents(calc!.cogsCents, markup)! / 100).toFixed(2)
                              : "29.95"
                          }
                          value={row.retailDollars}
                          onChange={(e) => updateRow(row.id, { retailDollars: e.target.value })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Monthly units</Label>
                        <Input
                          type="number"
                          min={0}
                          value={row.monthlyUnits}
                          onChange={(e) =>
                            updateRow(row.id, {
                              monthlyUnits: parseInt(e.target.value, 10) || 0,
                            })
                          }
                        />
                      </div>
                      <div className="space-y-1 text-sm pt-6">
                        <div className="text-muted-foreground">Line monthly profit</div>
                        <div className="text-lg font-semibold">
                          {calc?.monthlyProfit != null
                            ? `$${(calc.monthlyProfit / 100).toFixed(2)}`
                            : "—"}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            )}

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
              <div className="rounded-md border p-3 space-y-1">
                <div className="text-muted-foreground">Total units / mo</div>
                <div className="text-lg font-semibold">{totalUnits}</div>
              </div>
              <div className="rounded-md border p-3 space-y-1">
                <div className="text-muted-foreground">Blended profit / sale</div>
                <div className="text-lg font-semibold">
                  {blendedProfitPerSale != null
                    ? `$${(blendedProfitPerSale / 100).toFixed(2)}`
                    : "—"}
                </div>
              </div>
              <div className="rounded-md border p-3 space-y-1">
                <div className="text-muted-foreground">Product profit / mo</div>
                <div className="text-lg font-semibold">
                  {hasAnyProfit ? `$${(totalMonthlyProfitCents / 100).toFixed(2)}` : "—"}
                </div>
              </div>
              <div className="rounded-md border p-3 space-y-1">
                <div className="text-muted-foreground">Net after {planLabel}</div>
                <div className="text-lg font-semibold">
                  {monthlyNet != null ? `$${(monthlyNet / 100).toFixed(2)}` : "—"}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Subscription ROI</CardTitle>
            <CardDescription>
              Your live plan is {livePlanLabel}. Choose any plan below to model net profit / break-even.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="space-y-2 max-w-xs">
              <Label>Plan to model</Label>
              <Select value={roiPlanName} onValueChange={setRoiPlanName}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ESTIMATOR_PAID_PLANS.map((p) => (
                    <SelectItem key={p.planName} value={p.planName}>
                      {p.displayName} — ${p.priceUsd}/mo
                      {p.planName === currentPlanName ? " (current)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-md border p-3">
                <div className="text-muted-foreground">Units to cover {planLabel}</div>
                <div className="text-2xl font-semibold mt-1">
                  {breakEven == null ? "—" : breakEven === 0 ? "0" : breakEven}
                </div>
              </div>
              <div className="rounded-md border p-3">
                <div className="text-muted-foreground">Net monthly after plan fee</div>
                <div className="text-2xl font-semibold mt-1">
                  {monthlyNet != null ? `$${(monthlyNet / 100).toFixed(2)}` : "—"}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <PlanGenerationEstimator
          title="Plan fit for this mix"
          description="Uses your product mix units above. Gens-per-sale is a guess; visitor free gens come off the merchant allotment."
          lines={estimatorLines}
          lockMix
          footerNote={
            <p className="text-xs text-muted-foreground">
              Live plan: <span className="font-medium capitalize">{livePlanLabel}</span>. ROI card above
              can model a different plan without changing your subscription.
            </p>
          }
        />
      </div>
    </AdminLayout>
  );
}
