import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import AdminLayout from "@/components/admin-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { usePlanGenerationQuota } from "@/components/admin/GenerationQuotaUsage";

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

const PLAN_PRICES_USD: Record<string, number> = {
  starter: 29,
  dabbler: 49,
  pro: 99,
  pro_plus: 199,
};

const PLAN_DISPLAY_NAMES: Record<string, string> = {
  trial: "Trial",
  starter: "Starter",
  dabbler: "Dabbler",
  pro: "Pro",
  pro_plus: "Pro Plus",
};

export default function AdminInsightsPage() {
  const { data: planData } = usePlanGenerationQuota();
  const [productTypeId, setProductTypeId] = useState<string>("");
  const [variantKey, setVariantKey] = useState<string>("");
  const [retailDollars, setRetailDollars] = useState<string>("");
  const [monthlySales, setMonthlySales] = useState<string>("10");

  const { data: productTypes, isLoading: ptsLoading } = useQuery<ProductTypeRow[]>({
    queryKey: ["/api/admin/product-types"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/admin/product-types");
      const data = await res.json();
      const list = Array.isArray(data) ? data : data.productTypes ?? [];
      return list.filter((pt: ProductTypeRow) => pt.printifyBlueprintId != null);
    },
  });

  const { data: piData, isLoading: piLoading } = useQuery<{
    variants: PiVariant[];
    productType?: ProductTypeRow;
  }>({
    queryKey: ["/api/admin/product-intelligence", productTypeId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/admin/product-intelligence/${productTypeId}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to load Product Intelligence");
      }
      return res.json();
    },
    enabled: !!productTypeId,
  });

  const variants = useMemo(() => {
    const list = piData?.variants ?? [];
    return list.filter((v) => v.printAreaKey === "front" || !v.printAreaKey);
  }, [piData?.variants]);

  const selectedVariant = useMemo(() => {
    if (!variantKey) return null;
    return variants.find((v) => `${v.supplierVariantId}:${v.printAreaKey}` === variantKey) ?? null;
  }, [variantKey, variants]);

  const planName = planData?.planName || "starter";
  const planPrice = PLAN_PRICES_USD[planName] ?? 29;
  const planLabel = PLAN_DISPLAY_NAMES[planName] || planName.replace("_", " ");

  const markup =
    piData?.productType?.defaultMarkupPercent ??
    productTypes?.find((p) => String(p.id) === productTypeId)?.defaultMarkupPercent ??
    DEFAULT_MARKUP_PERCENT;

  const cogsCents = selectedVariant?.baseCogsCents ?? null;
  const shippingCents = selectedVariant?.shippingFirstItemUsCents ?? null;
  const landedCents =
    cogsCents != null ? cogsCents + (shippingCents != null && shippingCents > 0 ? shippingCents : 0) : null;

  const retailCents = (() => {
    const parsed = parseFloat(retailDollars);
    if (Number.isFinite(parsed) && parsed > 0) return Math.round(parsed * 100);
    return suggestedRetailCents(cogsCents, markup ?? DEFAULT_MARKUP_PERCENT);
  })();

  const profitPerSale = merchantProfitCents(retailCents, landedCents ?? cogsCents);
  const salesN = parseInt(monthlySales, 10) || 0;
  const monthlyNet = monthlyNetProfitCents({
    profitPerSaleCents: profitPerSale,
    monthlySales: salesN,
    subscriptionUsd: planPrice,
  });
  const breakEven = subscriptionBreakEvenUnits(planPrice, profitPerSale);

  return (
    <AdminLayout>
      <div className="space-y-6 max-w-3xl">
        <div>
          <h1 className="text-2xl font-bold">Profit Insights</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Estimates from Product Intelligence COGS (plus shipping when known) and your plan fee.
            Not a tax or accounting statement.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Merchant profit calculator</CardTitle>
            <CardDescription>Pick a product and variant, then set retail and monthly volume.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {ptsLoading ? (
              <Skeleton className="h-10 w-full" />
            ) : (
              <div className="space-y-2">
                <Label>Product</Label>
                <Select
                  value={productTypeId}
                  onValueChange={(v) => {
                    setProductTypeId(v);
                    setVariantKey("");
                    setRetailDollars("");
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a product" />
                  </SelectTrigger>
                  <SelectContent>
                    {(productTypes ?? []).map((pt) => (
                      <SelectItem key={pt.id} value={String(pt.id)}>
                        {pt.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {productTypeId && (
              <div className="space-y-2">
                <Label>Variant</Label>
                {piLoading ? (
                  <Skeleton className="h-10 w-full" />
                ) : (
                  <Select value={variantKey} onValueChange={setVariantKey}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a variant" />
                    </SelectTrigger>
                    <SelectContent>
                      {variants.map((v) => {
                        const key = `${v.supplierVariantId}:${v.printAreaKey}`;
                        const label =
                          v.variantName ||
                          [v.size, v.color].filter(Boolean).join(" / ") ||
                          v.supplierVariantId;
                        return (
                          <SelectItem key={key} value={key}>
                            {label}
                            {v.baseCogsCents != null
                              ? ` — $${(v.baseCogsCents / 100).toFixed(2)} COGS`
                              : " — no COGS"}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                )}
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="retail">Retail price (USD)</Label>
                <Input
                  id="retail"
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder={
                    suggestedRetailCents(cogsCents, markup ?? DEFAULT_MARKUP_PERCENT) != null
                      ? (
                          (suggestedRetailCents(cogsCents, markup ?? DEFAULT_MARKUP_PERCENT)! / 100).toFixed(2)
                        )
                      : "29.95"
                  }
                  value={retailDollars}
                  onChange={(e) => setRetailDollars(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Leave blank to use suggested retail at {markup ?? DEFAULT_MARKUP_PERCENT}% markup.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="sales">Monthly sales (units)</Label>
                <Input
                  id="sales"
                  type="number"
                  min="0"
                  value={monthlySales}
                  onChange={(e) => setMonthlySales(e.target.value)}
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 text-sm">
              <div className="rounded-md border p-3 space-y-1">
                <div className="text-muted-foreground">COGS</div>
                <div className="text-lg font-semibold">
                  {cogsCents != null ? `$${(cogsCents / 100).toFixed(2)}` : "—"}
                </div>
              </div>
              <div className="rounded-md border p-3 space-y-1">
                <div className="text-muted-foreground">Shipping (1st item, US snap.)</div>
                <div className="text-lg font-semibold">
                  {shippingCents != null ? `$${(shippingCents / 100).toFixed(2)}` : "—"}
                </div>
              </div>
              <div className="rounded-md border p-3 space-y-1">
                <div className="text-muted-foreground">Profit / sale</div>
                <div className="text-lg font-semibold">
                  {profitPerSale != null ? `$${(profitPerSale / 100).toFixed(2)}` : "—"}
                </div>
              </div>
              <div className="rounded-md border p-3 space-y-1">
                <div className="text-muted-foreground">Monthly product profit</div>
                <div className="text-lg font-semibold">
                  {profitPerSale != null
                    ? `$${((profitPerSale * salesN) / 100).toFixed(2)}`
                    : "—"}
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
              <div className="text-muted-foreground">Units to cover subscription</div>
              <div className="text-2xl font-semibold mt-1">
                {breakEven == null ? "—" : breakEven === 0 ? "0" : breakEven}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {breakEven != null && breakEven > 0
                  ? `Sell ${breakEven} of this variant at the retail above and the ${planLabel} fee is covered.`
                  : "Set a profitable retail price to see break-even."}
              </p>
            </div>
            <div className="rounded-md border p-3">
              <div className="text-muted-foreground">Net monthly (product profit − plan)</div>
              <div className="text-2xl font-semibold mt-1">
                {monthlyNet != null ? `$${(monthlyNet / 100).toFixed(2)}` : "—"}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}
