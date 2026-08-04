import { useEffect, useMemo, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
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
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest } from "@/lib/queryClient";
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
  type MixLine,
  type PriceDriverVariant,
} from "@shared/planEstimator";
import { usePlanGenerationQuota } from "@/components/admin/GenerationQuotaUsage";
import PlanGenerationEstimator from "@/components/admin/PlanGenerationEstimator";
import { Plus, Trash2 } from "lucide-react";

type ProductTypeRow = {
  id: number;
  name: string;
  printifyBlueprintId?: number | null;
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
  variants: Array<{ id: string; title: string }>;
};

type MixRow = {
  id: string;
  productTypeId: string;
  variantKey: string;
  retailDollars: string;
  monthlyUnits: number;
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

export default function AdminInsightsPage() {
  const { data: planData } = usePlanGenerationQuota();
  const [rows, setRows] = useState<MixRow[]>(() => [newMixRow()]);

  const { data: productTypes, isLoading: ptsLoading } = useQuery<ProductTypeRow[]>({
    queryKey: ["/api/admin/product-types"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/admin/product-types");
      const data = await res.json();
      const list = Array.isArray(data) ? data : data.productTypes ?? [];
      return list.filter((pt: ProductTypeRow) => pt.printifyBlueprintId != null);
    },
  });

  const { data: blanksData } = useQuery<{ blanks: Blank[] }>({
    queryKey: ["/api/appai/blanks"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/appai/blanks");
      if (!res.ok) return { blanks: [] };
      return res.json();
    },
  });

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

  const variantsForProduct = (productTypeId: string): PriceDriverVariant[] => {
    if (!productTypeId) return [];
    const pi = piByProductId.get(productTypeId);
    const collapsed = collapseToPriceDriverVariants(pi?.variants ?? []);
    if (collapsed.length > 0) return collapsed;
    const blank = blanksData?.blanks?.find((b) => String(b.productTypeId) === productTypeId);
    if (!blank?.variants?.length) return [];
    return collapseBlankTitlesToSizes(blank.variants);
  };

  // Clear stale variant keys when options change
  useEffect(() => {
    setRows((prev) =>
      prev.map((row) => {
        if (!row.productTypeId || !row.variantKey) return row;
        const opts = variantsForProduct(row.productTypeId);
        if (opts.some((v) => v.key === row.variantKey)) return row;
        return { ...row, variantKey: "" };
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when PI/blanks payloads change
  }, [piByProductId, blanksData]);

  const planName = planData?.planName || "starter";
  const planMeta = ESTIMATOR_PAID_PLANS.find((p) => p.planName === planName);
  const planPrice = planMeta?.priceUsd ?? 29;
  const planLabel = planMeta?.displayName || planName.replace("_", " ");

  const lineCalcs = useMemo(() => {
    return rows.map((row) => {
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
        label: pt?.name || "Product",
        variantLabel: variant?.label || "—",
        cogsCents,
        shippingCents,
        profitPerSale,
        monthlyProfit,
        units,
      };
    });
  }, [rows, productTypes, piByProductId, blanksData]);

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
        const pt = productTypes?.find((p) => String(p.id) === r.productTypeId);
        return {
          id: r.id,
          label: pt?.name || r.productTypeId || "Product",
          monthlyUnits: r.monthlyUnits,
        };
      }),
    [rows, productTypes],
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
            Multi-product profit mix from Product Intelligence (size + print area only). Plan fit uses
            a provisional gens-per-sale guess.
          </p>
        </div>

        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-2">
            <div>
              <CardTitle className="text-base">Merchant profit calculator</CardTitle>
              <CardDescription>
                Add products with a size / print-area pick (colours that share COGS are hidden).
              </CardDescription>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => setRows([...rows, newMixRow()])}>
              <Plus className="h-3.5 w-3.5 mr-1" />
              Add product
            </Button>
          </CardHeader>
          <CardContent className="space-y-5">
            {ptsLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : (
              rows.map((row, idx) => {
                const variants = variantsForProduct(row.productTypeId);
                const piLoading = productIds.includes(row.productTypeId)
                  ? piQueries[productIds.indexOf(row.productTypeId)]?.isLoading
                  : false;
                const calc = lineCalcs[idx];
                const markup =
                  productTypes?.find((p) => String(p.id) === row.productTypeId)?.defaultMarkupPercent ??
                  DEFAULT_MARKUP_PERCENT;

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
                          <SelectContent position="popper" className="z-[100]">
                            {(productTypes ?? []).map((pt) => (
                              <SelectItem key={pt.id} value={String(pt.id)}>
                                {pt.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <Label>Size / print area</Label>
                        {piLoading ? (
                          <Skeleton className="h-10 w-full" />
                        ) : !row.productTypeId ? (
                          <p className="text-xs text-muted-foreground pt-2">Pick a product first</p>
                        ) : variants.length === 0 ? (
                          <p className="text-xs text-muted-foreground rounded-md border p-2">
                            No size options yet — run Product Sync on this product.
                          </p>
                        ) : (
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
              Current plan: <span className="capitalize font-medium">{planLabel}</span> at $
              {planPrice}/mo.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="rounded-md border p-3">
              <div className="text-muted-foreground">Units to cover subscription (blended)</div>
              <div className="text-2xl font-semibold mt-1">
                {breakEven == null ? "—" : breakEven === 0 ? "0" : breakEven}
              </div>
            </div>
          </CardContent>
        </Card>

        <PlanGenerationEstimator
          title="Plan fit for this mix"
          description="Uses your product mix units above. Gens-per-sale is a guess; visitor free gens (10) come off the merchant allotment."
          lines={estimatorLines}
          lockMix
          footerNote={
            <p className="text-xs text-muted-foreground">
              You are on <span className="font-medium capitalize">{planLabel}</span>. Suggested plan
              above is based on pages needed (= products with units) and estimated generations.
            </p>
          }
        />
      </div>
    </AdminLayout>
  );
}
