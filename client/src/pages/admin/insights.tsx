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

type BlankVariant = { id: string; title: string };
type Blank = {
  productTypeId: number;
  variants: BlankVariant[];
};

type CalcVariant = {
  key: string;
  label: string;
  cogsCents: number | null;
  shippingCents: number | null;
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

/** Prefer front-area COGS; otherwise first row per supplier variant (AOP may not use "front"). */
function pickPiVariantsForCalculator(list: PiVariant[]): CalcVariant[] {
  const bySupplier = new Map<string, PiVariant[]>();
  for (const v of list) {
    const id = String(v.supplierVariantId || "");
    if (!id) continue;
    const arr = bySupplier.get(id) ?? [];
    arr.push(v);
    bySupplier.set(id, arr);
  }
  const out: CalcVariant[] = [];
  for (const [id, rows] of bySupplier) {
    const preferred =
      rows.find((r) => r.printAreaKey === "front") ||
      rows.find((r) => r.printAreaKey !== "both") ||
      rows[0];
    if (!preferred) continue;
    const label =
      preferred.variantName ||
      [preferred.size, preferred.color].filter(Boolean).join(" / ") ||
      id;
    out.push({
      key: `${id}:${preferred.printAreaKey || "front"}`,
      label,
      cogsCents: preferred.baseCogsCents ?? null,
      shippingCents: preferred.shippingFirstItemUsCents ?? null,
    });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

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

  const {
    data: piData,
    isLoading: piLoading,
    error: piError,
  } = useQuery<{
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

  const { data: blanksData } = useQuery<{ blanks: Blank[] }>({
    queryKey: ["/api/appai/blanks"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/appai/blanks");
      if (!res.ok) return { blanks: [] };
      return res.json();
    },
    enabled: !!productTypeId,
  });

  const variants = useMemo((): CalcVariant[] => {
    const fromPi = pickPiVariantsForCalculator(piData?.variants ?? []);
    if (fromPi.length > 0) return fromPi;

    // Fallback: catalog blank titles when Product Sync has not written PI rows yet.
    const blank = blanksData?.blanks?.find((b) => String(b.productTypeId) === productTypeId);
    if (!blank?.variants?.length) return [];
    return blank.variants.map((v) => ({
      key: v.id,
      label: v.title,
      cogsCents: null,
      shippingCents: null,
    }));
  }, [piData?.variants, blanksData?.blanks, productTypeId]);

  const selectedVariant = useMemo(() => {
    if (!variantKey) return null;
    return variants.find((v) => v.key === variantKey) ?? null;
  }, [variantKey, variants]);

  const planName = planData?.planName || "starter";
  const planPrice = PLAN_PRICES_USD[planName] ?? 29;
  const planLabel = PLAN_DISPLAY_NAMES[planName] || planName.replace("_", " ");

  const markup =
    piData?.productType?.defaultMarkupPercent ??
    productTypes?.find((p) => String(p.id) === productTypeId)?.defaultMarkupPercent ??
    DEFAULT_MARKUP_PERCENT;

  const cogsCents = selectedVariant?.cogsCents ?? null;
  const shippingCents = selectedVariant?.shippingCents ?? null;
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

  const piHasCosts = (piData?.variants ?? []).some(
    (v) => v.baseCogsCents != null && Number.isFinite(v.baseCogsCents),
  );

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
                  value={productTypeId || undefined}
                  onValueChange={(v) => {
                    setProductTypeId(v);
                    setVariantKey("");
                    setRetailDollars("");
                  }}
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
            )}

            {productTypeId && (
              <div className="space-y-2">
                <Label>Variant</Label>
                {piLoading ? (
                  <Skeleton className="h-10 w-full" />
                ) : piError ? (
                  <p className="text-sm text-destructive">{(piError as Error).message}</p>
                ) : variants.length === 0 ? (
                  <p className="text-sm text-muted-foreground rounded-md border p-3">
                    No variants available yet. Open{" "}
                    <span className="font-medium">Products Catalogue</span>, run{" "}
                    <span className="font-medium">Product Sync</span> on this product, then return here.
                  </p>
                ) : (
                  <Select
                    value={variantKey || undefined}
                    onValueChange={setVariantKey}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select a variant" />
                    </SelectTrigger>
                    <SelectContent position="popper" className="z-[100] max-h-72">
                      {variants.map((v) => (
                        <SelectItem key={v.key} value={v.key}>
                          {v.label}
                          {v.cogsCents != null
                            ? ` — $${(v.cogsCents / 100).toFixed(2)} COGS`
                            : " — no COGS yet"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                {variants.length > 0 && !piHasCosts && (
                  <p className="text-xs text-amber-800">
                    COGS not in Product Intelligence yet — run Product Sync on this product to fill costs.
                  </p>
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
