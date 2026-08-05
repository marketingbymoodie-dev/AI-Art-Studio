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

type CatalogEntry = {
  blueprintId: number;
  label: string;
  brand: string | null;
  category: string | null;
  kind: string;
  existingProductType?: {
    id: number;
    name: string;
    printifyProviderId: number | null;
  } | null;
  /** Platform PI reference — COGS/shipping for Insights when not imported. */
  platformProductTypeId?: number | null;
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

type CostsPayload = {
  costs?: Record<string, number>;
  costsBoth?: Record<string, number>;
  printifyVariantLabels?: Record<string, string>;
  supportsBothSides?: boolean;
  productTypeId?: number | null;
};

type MixRow = {
  id: string;
  /** Platform catalogue blueprint id (string for Select). */
  blueprintId: string;
  productTypeId: string;
  variantKey: string;
  retailDollars: string;
  monthlyUnits: number;
};

type PickerProduct = {
  blueprintId: number;
  label: string;
  /** Merchant import if present, else platform catalogue PI reference. */
  productTypeId: number | null;
};

function newMixRow(): MixRow {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    blueprintId: "",
    productTypeId: "",
    variantKey: "",
    retailDollars: "",
    monthlyUnits: 10,
  };
}

/** One row per catalogue product — dedupe by blueprint, then by cleaned title. */
function buildPickerProducts(entries: CatalogEntry[] | undefined): PickerProduct[] {
  const byBlueprint = new Map<number, PickerProduct>();
  for (const e of entries ?? []) {
    const blueprintId = Number(e.blueprintId);
    if (!Number.isFinite(blueprintId) || blueprintId <= 0) continue;
    const label = stripProviderSuffix(e.label) || e.label;
    const productTypeId = e.existingProductType?.id ?? e.platformProductTypeId ?? null;
    const existing = byBlueprint.get(blueprintId);
    if (!existing || (productTypeId != null && existing.productTypeId == null)) {
      byBlueprint.set(blueprintId, { blueprintId, label, productTypeId });
    }
  }

  // Same display name from different blueprints → keep one (prefer one with PI id).
  const byLabel = new Map<string, PickerProduct>();
  for (const p of byBlueprint.values()) {
    const key = p.label.trim().toLowerCase();
    const existing = byLabel.get(key);
    if (!existing) {
      byLabel.set(key, p);
      continue;
    }
    if (existing.productTypeId == null && p.productTypeId != null) {
      byLabel.set(key, p);
    }
  }

  return [...byLabel.values()].sort((a, b) => a.label.localeCompare(b.label));
}

export default function AdminInsightsPage() {
  const { toast } = useToast();
  const { data: planData } = usePlanGenerationQuota();
  const [rows, setRows] = useState<MixRow[]>(() => [newMixRow()]);
  const currentPlanName = planData?.planName || "starter";
  const [roiPlanName, setRoiPlanName] = useState(currentPlanName);
  const [syncingKey, setSyncingKey] = useState<string | null>(null);

  const fetchCostsMutation = useMutation({
    mutationFn: async (args: { blueprintId: string; productTypeId: string; rowId: string }) => {
      setSyncingKey(args.blueprintId);
      const res = await apiRequest(
        "GET",
        `/api/admin/printify/blueprint-costs/${args.blueprintId}?refresh=1`,
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Could not load COGS");
      }
      let data = (await res.json()) as CostsPayload & { productTypeId?: number | null };
      const ptId = data.productTypeId != null ? String(data.productTypeId) : args.productTypeId;

      // If blueprint path still has no COGS, force the Printify waterfall on the product type.
      const costCount = Object.keys(data.costs || {}).length;
      if (costCount === 0 && ptId) {
        const legacy = await apiRequest(
          "GET",
          `/api/admin/printify/costs/${ptId}?refresh=1&legacy=1`,
        );
        if (legacy.ok) {
          data = await legacy.json();
        }
      }

      const drivers = priceDriversFromCostsPayload({
        costs: data.costs,
        costsBoth: data.costsBoth,
        printifyVariantLabels: data.printifyVariantLabels,
      });
      if (drivers.length === 0) {
        throw new Error(
          "Printify returned no size/COGS for this product. Try again in a minute, or check the supplier is in stock.",
        );
      }
      return {
        key: args.blueprintId,
        productTypeId: ptId,
        rowId: args.rowId,
        data,
        driverCount: drivers.length,
        hasCogs: drivers.some((d) => d.cogsCents != null),
      };
    },
    onSuccess: ({ key, productTypeId, rowId, data, hasCogs }) => {
      // Keep query key aligned with useQueries (productTypeId may have been empty before ensure).
      queryClient.setQueryData(
        ["/api/admin/printify/blueprint-costs", key, "insights", productTypeId || ""],
        data,
      );
      queryClient.setQueryData(
        ["/api/admin/printify/blueprint-costs", key, "insights", ""],
        data,
      );
      if (productTypeId) {
        setRows((prev) =>
          prev.map((r) => (r.id === rowId ? { ...r, productTypeId } : r)),
        );
        // Also write under the new productTypeId key once the row updates.
        queryClient.setQueryData(
          ["/api/admin/printify/blueprint-costs", key, "insights", productTypeId],
          data,
        );
        queryClient.invalidateQueries({
          queryKey: ["/api/admin/product-intelligence", productTypeId],
        });
      }
      toast({
        title: hasCogs ? "Costs refreshed" : "Sizes loaded",
        description: hasCogs
          ? "Size / print options updated."
          : "Sizes loaded but COGS are still missing from Printify — try Fetch again shortly.",
      });
    },
    onError: (err: Error) => {
      toast({ title: "COGS unavailable", description: err.message, variant: "destructive" });
    },
    onSettled: () => setSyncingKey(null),
  });

  useEffect(() => {
    setRoiPlanName(currentPlanName);
  }, [currentPlanName]);

  const { data: catalogData, isLoading: catalogLoading } = useQuery<{ entries: CatalogEntry[] }>({
    queryKey: ["/api/appai/setup/catalog"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/appai/setup/catalog");
      if (!res.ok) return { entries: [] };
      return res.json();
    },
  });

  const pickerProducts = useMemo(
    () => buildPickerProducts(catalogData?.entries),
    [catalogData?.entries],
  );

  const selectedBlueprintIds = useMemo(
    () => [...new Set(rows.map((r) => r.blueprintId).filter(Boolean))],
    [rows],
  );

  const costsQueries = useQueries({
    queries: selectedBlueprintIds.map((blueprintId) => {
      const row = rows.find((r) => r.blueprintId === blueprintId);
      const productTypeId = row?.productTypeId || "";
      return {
        // Always blueprint-costs (ensures platform ref + waterfall when needed).
        queryKey: ["/api/admin/printify/blueprint-costs", blueprintId, "insights", productTypeId],
        queryFn: async (): Promise<CostsPayload | null> => {
          const res = await apiRequest(
            "GET",
            `/api/admin/printify/blueprint-costs/${blueprintId}`,
          );
          if (!res.ok) return null;
          const data = (await res.json()) as CostsPayload & { productTypeId?: number | null };
          // Persist discovered platform/merchant productTypeId onto the mix row.
          if (data.productTypeId != null && row && !row.productTypeId) {
            const pt = String(data.productTypeId);
            const rowId = row.id;
            setRows((prev) =>
              prev.map((r) => (r.id === rowId && !r.productTypeId ? { ...r, productTypeId: pt } : r)),
            );
          }
          return data;
        },
        enabled: !!blueprintId,
        staleTime: 60_000,
        retry: 1,
      };
    }),
  });

  const piQueries = useQueries({
    queries: selectedBlueprintIds.map((blueprintId) => {
      const row = rows.find((r) => r.blueprintId === blueprintId);
      const productTypeId = row?.productTypeId || "";
      return {
        queryKey: ["/api/admin/product-intelligence", productTypeId],
        queryFn: async () => {
          const res = await apiRequest("GET", `/api/admin/product-intelligence/${productTypeId}`);
          if (!res.ok) {
            return { variants: [] as PiVariant[] };
          }
          return res.json() as Promise<{ variants: PiVariant[] }>;
        },
        enabled: !!productTypeId,
        staleTime: 60_000,
      };
    }),
  });

  const costsByBlueprint = useMemo(() => {
    const map = new Map<string, CostsPayload>();
    selectedBlueprintIds.forEach((id, i) => {
      const data = costsQueries[i]?.data;
      if (data) map.set(id, data);
    });
    return map;
  }, [selectedBlueprintIds, costsQueries]);

  const piByBlueprint = useMemo(() => {
    const map = new Map<string, PiVariant[]>();
    selectedBlueprintIds.forEach((id, i) => {
      const data = piQueries[i]?.data;
      if (data?.variants) map.set(id, data.variants);
    });
    return map;
  }, [selectedBlueprintIds, piQueries]);

  const loadingByBlueprint = useMemo(() => {
    const map = new Map<string, boolean>();
    selectedBlueprintIds.forEach((id, i) => {
      const costsBusy = !!(costsQueries[i]?.isLoading || costsQueries[i]?.isFetching);
      const piBusy = !!(piQueries[i]?.isLoading || piQueries[i]?.isFetching);
      map.set(id, costsBusy || piBusy);
    });
    return map;
  }, [selectedBlueprintIds, costsQueries, piQueries]);

  const variantsForBlueprint = (blueprintId: string): PriceDriverVariant[] => {
    if (!blueprintId) return [];
    const costs = costsByBlueprint.get(blueprintId);
    const fromCosts = priceDriversFromCostsPayload({
      costs: costs?.costs,
      costsBoth: costs?.costsBoth,
      printifyVariantLabels: costs?.printifyVariantLabels,
    });
    const fromPi = collapseToPriceDriverVariants(piByBlueprint.get(blueprintId) ?? []);
    return mergePriceDriverSources({ fromCosts, fromPi, fromBlanks: [] });
  };

  useEffect(() => {
    setRows((prev) =>
      prev.map((row) => {
        if (!row.blueprintId || !row.variantKey) return row;
        const opts = variantsForBlueprint(row.blueprintId);
        if (opts.some((v) => v.key === row.variantKey)) return row;
        return { ...row, variantKey: "" };
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [costsByBlueprint, piByBlueprint]);

  const roiPlanMeta = ESTIMATOR_PAID_PLANS.find((p) => p.planName === roiPlanName);
  const planPrice = roiPlanMeta?.priceUsd ?? 29;
  const planLabel = roiPlanMeta?.displayName || roiPlanName.replace("_", " ");
  const livePlanLabel =
    ESTIMATOR_PAID_PLANS.find((p) => p.planName === currentPlanName)?.displayName ||
    currentPlanName.replace("_", " ");

  const lineCalcs = useMemo(() => {
    return rows.map((row) => {
      const picker = pickerProducts.find((p) => String(p.blueprintId) === row.blueprintId);
      const markup = DEFAULT_MARKUP_PERCENT;
      const variant = variantsForBlueprint(row.blueprintId).find((v) => v.key === row.variantKey);
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
          : suggestedRetailCents(cogsCents, markup);
      const profitPerSale = merchantProfitCents(retailCents, landed ?? cogsCents);
      const units = Number.isFinite(row.monthlyUnits) ? Math.max(0, row.monthlyUnits) : 0;
      const monthlyProfit =
        profitPerSale != null ? Math.round(profitPerSale * units) : null;
      return {
        row,
        label: picker?.label || "Product",
        variantLabel: variant?.label || "—",
        cogsCents,
        shippingCents,
        profitPerSale,
        monthlyProfit,
        units,
      };
    });
  }, [rows, pickerProducts, costsByBlueprint, piByBlueprint]);

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
        const picker = pickerProducts.find((p) => String(p.blueprintId) === r.blueprintId);
        return {
          id: r.id,
          label: picker?.label || r.blueprintId || "Product",
          monthlyUnits: r.monthlyUnits,
        };
      }),
    [rows, pickerProducts],
  );

  const updateRow = (id: string, patch: Partial<MixRow>) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  return (
    <AdminLayout>
      <div className="space-y-6 max-w-4xl">
        <div>
          <h1 className="text-2xl font-bold">Profit Insights</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Estimate profit across the platform catalogue. Pick size and print area (COGS exclude
            shipping), set retail and monthly units, then compare subscription plans.
          </p>
        </div>

        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-2">
            <div>
              <CardTitle className="text-base">Merchant profit calculator</CardTitle>
              <CardDescription>
                {catalogLoading
                  ? "Loading catalogue…"
                  : `${pickerProducts.length} products in the platform catalogue`}
              </CardDescription>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => setRows([...rows, newMixRow()])}>
              <Plus className="h-3.5 w-3.5 mr-1" />
              Add product
            </Button>
          </CardHeader>
          <CardContent className="space-y-5">
            {catalogLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading platform catalogue…
              </div>
            ) : (
              rows.map((row, idx) => {
                const variants = variantsForBlueprint(row.blueprintId);
                const busy = row.blueprintId ? !!loadingByBlueprint.get(row.blueprintId) : false;
                const calc = lineCalcs[idx];
                const markup = DEFAULT_MARKUP_PERCENT;
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
                          value={row.blueprintId || undefined}
                          onValueChange={(v) => {
                            const picker = pickerProducts.find((p) => String(p.blueprintId) === v);
                            updateRow(row.id, {
                              blueprintId: v,
                              productTypeId: picker?.productTypeId
                                ? String(picker.productTypeId)
                                : "",
                              variantKey: "",
                              retailDollars: "",
                            });
                          }}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select a product" />
                          </SelectTrigger>
                          <SelectContent position="popper" className="z-[100] max-h-80">
                            {pickerProducts.map((pt) => (
                              <SelectItem key={pt.blueprintId} value={String(pt.blueprintId)}>
                                {pt.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <Label>
                          Size / print areas{" "}
                          <span className="font-normal text-muted-foreground">
                            — COGS (ex. shipping)
                          </span>
                        </Label>
                        {busy ? (
                          <div className="flex h-10 items-center gap-2 rounded-md border px-3 text-sm text-muted-foreground">
                            <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                            Loading sizes &amp; COGS…
                          </div>
                        ) : !row.blueprintId ? (
                          <p className="text-xs text-muted-foreground pt-2">Pick a product first</p>
                        ) : variants.length === 0 ? (
                          <div className="space-y-2">
                            <p className="text-xs text-muted-foreground rounded-md border p-2">
                              No size / COGS options yet for this product.
                            </p>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-8"
                              disabled={syncingKey === row.blueprintId}
                              onClick={() =>
                                fetchCostsMutation.mutate({
                                  blueprintId: row.blueprintId,
                                  productTypeId: row.productTypeId,
                                  rowId: row.id,
                                })
                              }
                            >
                              {syncingKey === row.blueprintId ? (
                                <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                              ) : null}
                              Fetch COGS
                            </Button>
                          </div>
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
                                Front/Back not listed when this supplier only prices a front print
                                (or the product is all-over print).
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
                                  disabled={syncingKey === row.blueprintId}
                                  onClick={() =>
                                    fetchCostsMutation.mutate({
                                      blueprintId: row.blueprintId,
                                      productTypeId: row.productTypeId,
                                      rowId: row.id,
                                    })
                                  }
                                >
                                  {syncingKey === row.blueprintId ? (
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
          description="Plan fit uses unique visitors × free gens. Conversion estimates sales; gens-per-sale stays optional. Free gens come off your merchant allotment."
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
