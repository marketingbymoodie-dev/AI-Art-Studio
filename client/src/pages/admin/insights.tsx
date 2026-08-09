import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueries, useQuery } from "@tanstack/react-query";
import AdminLayout from "@/components/admin-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  collapseToPriceDriverVariants,
  mergePriceDriverSources,
  priceDriversFromCostsPayload,
  stripProviderSuffix,
  type PriceDriverVariant,
} from "@shared/planEstimator";
import {
  OVERAGE_PRICE_USD,
  PAID_PLAN_DEFINITIONS,
  PLAN_DISPLAY_NAMES,
  type PlanDefinition,
} from "@shared/customizerPlans";
import {
  cheapestFittingPlan,
  computePageMetrics,
  computeStoreProfit,
  evaluatePlans,
  headlineNetProfitUsd,
  rescalePageOrders,
  retailAtMarginUsd,
  totalOrdersFromFunnel,
  visitorsFromOrders,
  type ModelledPage,
  type ProfitInsightsGrants,
} from "@shared/profitInsightsModel";
import { usePlanGenerationQuota } from "@/components/admin/GenerationQuotaUsage";
import { Link } from "wouter";
import { ChevronDown, ChevronUp, Loader2, Plus, Trash2 } from "lucide-react";

/** Illustrative funnel seeds — not trailing store telemetry (see docs/profit-insights-model.md). */
const SEED_VISITORS = 1000;
const SEED_ENGAGEMENT_PCT = 30;
const SEED_CONVERSION_PCT = 5;

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

type PageRow = {
  id: string;
  blueprintId: string;
  productTypeId: string;
  variantKey: string;
  unitsPerOrder: number;
  orders: number;
  crossSellPct: number;
};

type PickerProduct = {
  blueprintId: number;
  label: string;
  productTypeId: number | null;
};

function newPageRow(orders: number): PageRow {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    blueprintId: "",
    productTypeId: "",
    variantKey: "",
    unitsPerOrder: 1,
    orders,
    crossSellPct: 0,
  };
}

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
  const byLabel = new Map<string, PickerProduct>();
  for (const p of Array.from(byBlueprint.values())) {
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
  return Array.from(byLabel.values()).sort((a, b) => a.label.localeCompare(b.label));
}

function money0(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

function money2(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fitBadge(status: string) {
  if (status === "ok") return <Badge className="bg-emerald-600 hover:bg-emerald-600">Fits</Badge>;
  if (status === "short") return <Badge variant="secondary">Short on gens</Badge>;
  if (status === "cap") return <Badge variant="destructive">Over cap</Badge>;
  if (status === "pages") return <Badge variant="destructive">Pages</Badge>;
  return <Badge variant="outline">{status}</Badge>;
}

export default function AdminInsightsPage() {
  const { toast } = useToast();
  const { data: planData } = usePlanGenerationQuota();
  const { data: planCatalog } = useQuery<{
    overagePriceUsd: number;
    plans: PlanDefinition[];
  }>({
    queryKey: ["/api/appai/billing/plan-catalog"],
  });
  const offerPlans = planCatalog?.plans?.length ? planCatalog.plans : PAID_PLAN_DEFINITIONS;
  const overagePriceUsd = planCatalog?.overagePriceUsd ?? OVERAGE_PRICE_USD;
  const seedOrders = totalOrdersFromFunnel({
    visitors: SEED_VISITORS,
    engagementPct: SEED_ENGAGEMENT_PCT,
    conversionPct: SEED_CONVERSION_PCT,
  });

  const [tab, setTab] = useState("profit");
  const [visitors, setVisitors] = useState(SEED_VISITORS);
  const [engagementPct, setEngagementPct] = useState(SEED_ENGAGEMENT_PCT);
  const [conversionPct, setConversionPct] = useState(SEED_CONVERSION_PCT);
  const [marginTarget, setMarginTarget] = useState(65);
  const [pages, setPages] = useState<PageRow[]>(() => [newPageRow(seedOrders)]);
  const [openPageId, setOpenPageId] = useState<string | null>(null);
  const [previewOverage, setPreviewOverage] = useState(false);
  const [overageSeeded, setOverageSeeded] = useState(false);
  const [planName, setPlanName] = useState("starter");
  const [autoFollow, setAutoFollow] = useState(true);
  const [syncingKey, setSyncingKey] = useState<string | null>(null);
  const prevOverage = useRef(previewOverage);

  const currentPlanName = planData?.planName || "starter";

  useEffect(() => {
    if (!overageSeeded && planData) {
      setPreviewOverage(
        !!(planData.overage?.optInEnabled || planData.generationQuota?.overageOptInEnabled),
      );
      setOverageSeeded(true);
    }
  }, [planData, overageSeeded]);

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
      const costCount = Object.keys(data.costs || {}).length;
      const bothCount = Object.keys(data.costsBoth || {}).length;
      const needsBothFallback =
        costCount > 0 && bothCount === 0 && data.supportsBothSides === true;
      if ((costCount === 0 || needsBothFallback) && ptId) {
        const legacy = await apiRequest(
          "GET",
          `/api/admin/printify/costs/${ptId}?refresh=1&legacy=1`,
        );
        if (legacy.ok) data = await legacy.json();
      }
      const drivers = priceDriversFromCostsPayload({
        costs: data.costs,
        costsBoth: data.costsBoth,
        printifyVariantLabels: data.printifyVariantLabels,
        supportsBothSides: data.supportsBothSides,
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
        hasCogs: drivers.some((d) => d.cogsCents != null),
      };
    },
    onSuccess: ({ key, productTypeId, rowId, data, hasCogs }) => {
      queryClient.setQueryData(
        ["/api/admin/printify/blueprint-costs", key, "insights", productTypeId || ""],
        data,
      );
      queryClient.setQueryData(
        ["/api/admin/printify/blueprint-costs", key, "insights", ""],
        data,
      );
      if (productTypeId) {
        setPages((prev) =>
          prev.map((r) => (r.id === rowId ? { ...r, productTypeId } : r)),
        );
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

  const { data: catalogData, isLoading: catalogLoading } = useQuery<{ entries: CatalogEntry[] }>({
    queryKey: ["/api/appai/setup/catalog"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/appai/setup/catalog");
      if (!res.ok) return { entries: [] };
      return res.json();
    },
  });

  const { data: storefrontSettings } = useQuery<{
    storefrontFreeGensPerVisitor: number;
  }>({
    queryKey: ["/api/admin/storefront-settings"],
  });

  type RewardLadderRung = {
    rungKey: "free_anonymous" | "email_signup" | "share_design" | "purchase_threshold";
    enabled: boolean;
    creditAmount: number;
  };
  const { data: rewardLadder } = useQuery<{
    purchaseRewardsEnabled: boolean;
    rungs: RewardLadderRung[];
  }>({
    queryKey: ["/api/admin/reward-ladder"],
  });

  const pickerProducts = useMemo(
    () => buildPickerProducts(catalogData?.entries),
    [catalogData?.entries],
  );

  const selectedBlueprintIds = useMemo(
    () => Array.from(new Set(pages.map((r) => r.blueprintId).filter(Boolean))),
    [pages],
  );

  const costsQueries = useQueries({
    queries: selectedBlueprintIds.map((blueprintId) => {
      const row = pages.find((r) => r.blueprintId === blueprintId);
      const productTypeId = row?.productTypeId || "";
      return {
        queryKey: ["/api/admin/printify/blueprint-costs", blueprintId, "insights", productTypeId],
        queryFn: async (): Promise<CostsPayload | null> => {
          const res = await apiRequest(
            "GET",
            `/api/admin/printify/blueprint-costs/${blueprintId}`,
          );
          if (!res.ok) return null;
          const data = (await res.json()) as CostsPayload & { productTypeId?: number | null };
          if (data.productTypeId != null && row && !row.productTypeId) {
            const pt = String(data.productTypeId);
            const rowId = row.id;
            setPages((prev) =>
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
      const row = pages.find((r) => r.blueprintId === blueprintId);
      const productTypeId = row?.productTypeId || "";
      return {
        queryKey: ["/api/admin/product-intelligence", productTypeId],
        queryFn: async () => {
          const res = await apiRequest("GET", `/api/admin/product-intelligence/${productTypeId}`);
          if (!res.ok) return { variants: [] as PiVariant[] };
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

  const variantsForBlueprint = (blueprintId: string): PriceDriverVariant[] => {
    if (!blueprintId) return [];
    const costs = costsByBlueprint.get(blueprintId);
    const fromCosts = priceDriversFromCostsPayload({
      costs: costs?.costs,
      costsBoth: costs?.costsBoth,
      printifyVariantLabels: costs?.printifyVariantLabels,
      supportsBothSides: costs?.supportsBothSides,
    });
    const fromPi = collapseToPriceDriverVariants(piByBlueprint.get(blueprintId) ?? []);
    return mergePriceDriverSources({ fromCosts, fromPi, fromBlanks: [] });
  };

  const grants: ProfitInsightsGrants = useMemo(() => {
    const rungs = rewardLadder?.rungs ?? [];
    const email = rungs.find((r) => r.rungKey === "email_signup");
    const share = rungs.find((r) => r.rungKey === "share_design");
    const purchase = rungs.find((r) => r.rungKey === "purchase_threshold");
    return {
      freeGensPerVisitor: storefrontSettings?.storefrontFreeGensPerVisitor ?? 2,
      emailCredits: email?.creditAmount ?? 1,
      shareCredits: share?.creditAmount ?? 1,
      purchaseCredits: purchase?.creditAmount ?? 3,
      emailEnabled: email?.enabled ?? true,
      shareEnabled: share?.enabled ?? true,
      purchaseEnabled: !!(rewardLadder?.purchaseRewardsEnabled && purchase?.enabled),
    };
  }, [rewardLadder, storefrontSettings]);

  const modelledPages: ModelledPage[] = useMemo(() => {
    return pages.map((p) => {
      const picker = pickerProducts.find((x) => String(x.blueprintId) === p.blueprintId);
      const variant = variantsForBlueprint(p.blueprintId).find((v) => v.key === p.variantKey);
      const cogsUsd =
        variant?.cogsCents != null
          ? (variant.cogsCents +
              (variant.shippingCents != null && variant.shippingCents > 0
                ? variant.shippingCents
                : 0)) /
            100
          : 0;
      return {
        id: p.id,
        label: picker?.label || "Select a product",
        cogsUsd,
        orders: p.orders,
        unitsPerOrder: p.unitsPerOrder,
        crossSellPct: p.crossSellPct,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pages, pickerProducts, costsByBlueprint, piByBlueprint]);

  const funnel = { visitors, engagementPct, conversionPct };
  const pageMetrics = useMemo(
    () =>
      computePageMetrics({
        pages: modelledPages,
        funnel,
        marginTargetPct: marginTarget,
        grants,
      }),
    [modelledPages, visitors, engagementPct, conversionPct, marginTarget, grants],
  );
  const profit = useMemo(
    () => computeStoreProfit(pageMetrics, marginTarget),
    [pageMetrics, marginTarget],
  );

  const suggested = useMemo(
    () =>
      cheapestFittingPlan({
        gensDemand: profit.gensDemand,
        pagesNeeded: profit.pagesNeeded,
        previewOverage,
        plans: offerPlans,
        overagePriceUsd,
      }) ?? offerPlans[offerPlans.length - 1]!,
    [profit.gensDemand, profit.pagesNeeded, previewOverage, offerPlans, overagePriceUsd],
  );

  useEffect(() => {
    if (prevOverage.current !== previewOverage) {
      prevOverage.current = previewOverage;
      setAutoFollow(true);
      setPlanName(suggested.planName);
      return;
    }
    if (autoFollow && planName !== suggested.planName) {
      setPlanName(suggested.planName);
    }
  }, [previewOverage, suggested.planName, autoFollow, planName]);

  const planRows = useMemo(
    () =>
      evaluatePlans({
        gensDemand: profit.gensDemand,
        pagesNeeded: profit.pagesNeeded,
        previewOverage,
        plans: offerPlans,
        overagePriceUsd,
      }),
    [profit.gensDemand, profit.pagesNeeded, previewOverage, offerPlans, overagePriceUsd],
  );
  const selectedRow = planRows.find((r) => r.plan.planName === planName) ?? planRows[0]!;
  const plan = selectedRow.plan;
  const overageCostUsd = previewOverage ? selectedRow.overageCostUsd : 0;
  const planCostUsd = selectedRow.monthlyCostUsd;
  const netProfit = headlineNetProfitUsd({
    profit,
    planFeeUsd: plan.priceUsd,
    overageCostUsd,
  });
  const gensSpent = profit.gensDemand;
  const pagesShort = profit.pagesNeeded > plan.pageLimit;

  const planCoveringDemand = cheapestFittingPlan({
    gensDemand: profit.gensDemand,
    pagesNeeded: profit.pagesNeeded,
    previewOverage: false,
    plans: offerPlans,
    overagePriceUsd,
  });
  const cheapestWithOverage = cheapestFittingPlan({
    gensDemand: profit.gensDemand,
    pagesNeeded: profit.pagesNeeded,
    previewOverage: true,
    plans: offerPlans,
    overagePriceUsd,
  });
  const overageUnlocksCheaper =
    !previewOverage &&
    !!cheapestWithOverage &&
    !!planCoveringDemand &&
    cheapestWithOverage.priceUsd < planCoveringDemand.priceUsd;

  const applyFunnel = (nextVisitors: number, nextEng: number, nextConv: number) => {
    setVisitors(nextVisitors);
    setEngagementPct(nextEng);
    setConversionPct(nextConv);
    const target = totalOrdersFromFunnel({
      visitors: nextVisitors,
      engagementPct: nextEng,
      conversionPct: nextConv,
    });
    setPages((ps) => rescalePageOrders(ps, target));
  };

  const setPageOrders = (id: string, orders: number) => {
    setPages((ps) => {
      const next = ps.map((p) => (p.id === id ? { ...p, orders: Math.max(0, orders) } : p));
      const newTotal = next.reduce((s, p) => s + p.orders, 0);
      setVisitors(visitorsFromOrders(newTotal, engagementPct, conversionPct));
      return next;
    });
  };

  const updatePage = (id: string, patch: Partial<PageRow>) => {
    setPages((ps) => ps.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  };

  const addPage = () => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setPages((ps) => {
      const next = [...ps, { ...newPageRow(3), id }];
      const total = next.reduce((s, p) => s + p.orders, 0);
      setVisitors(visitorsFromOrders(total, engagementPct, conversionPct));
      return next;
    });
    setOpenPageId(id);
  };

  const removePage = (id: string) => {
    setPages((ps) => {
      if (ps.length <= 1) return ps;
      const next = ps.filter((p) => p.id !== id);
      const total = next.reduce((s, p) => s + p.orders, 0);
      setVisitors(visitorsFromOrders(total, engagementPct, conversionPct));
      return next;
    });
  };

  const ordersToCover =
    profit.totalOrders > 0 && netProfit < 0
      ? Math.ceil(
          (planCostUsd /
            Math.max(
              0.01,
              (profit.aovChanged ? profit.simMonthlyProfitUsd : profit.baseMonthlyProfitUsd) /
                Math.max(1, profit.totalOrders),
            )) ,
        )
      : profit.totalOrders > 0
        ? Math.ceil(
            planCostUsd /
              Math.max(
                0.01,
                (profit.aovChanged ? profit.simMonthlyProfitUsd : profit.baseMonthlyProfitUsd) /
                  profit.totalOrders,
              ),
          )
        : null;

  const livePlanLabel =
    PLAN_DISPLAY_NAMES[currentPlanName] || currentPlanName.replace("_", " ");

  return (
    <AdminLayout>
      <div className="max-w-5xl mx-auto space-y-4 pb-10">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Profit Insights</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Model monthly profit across customizer pages and see how raising average order value
            moves it. Example traffic — edit to match your store.{" "}
            <span className="text-muted-foreground/80">
              Page count is modelled here (not live Customizer Pages yet).
            </span>
          </p>
        </div>

        {/* Sticky results bar */}
        <div className="sticky top-0 z-30 -mx-1 border-y bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <div className="grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-5 lg:items-center">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Net profit / month
              </div>
              <div className="text-2xl font-bold tabular-nums">{money0(netProfit)}</div>
            </div>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Plan
              </div>
              <div className="text-lg font-semibold">
                {plan.displayName}{" "}
                <span className="text-sm font-normal text-muted-foreground">
                  {money0(planCostUsd)}/mo
                </span>
              </div>
            </div>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Gens · pages
              </div>
              <div className="text-lg font-semibold tabular-nums">
                {gensSpent.toLocaleString()}/{plan.generationQuota.toLocaleString()} ·{" "}
                {profit.pagesNeeded}/{plan.pageLimit}
              </div>
            </div>
            <div className="flex items-center gap-2">{fitBadge(selectedRow.status)}</div>
            <div className="flex flex-col gap-1 sm:items-end">
              <div className="flex items-center gap-2">
                <Switch
                  id="preview-overage"
                  checked={previewOverage}
                  onCheckedChange={setPreviewOverage}
                />
                <Label htmlFor="preview-overage" className="text-sm cursor-pointer">
                  Preview: overage
                </Label>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Preview only — enable in{" "}
                <Link href="/admin/settings" className="underline underline-offset-2">
                  Settings
                </Link>
              </p>
            </div>
          </div>
          {!previewOverage && selectedRow.status === "short" && (
            <Alert className="rounded-none border-x-0 border-b-0 border-amber-200 bg-amber-50 text-amber-950">
              <AlertTitle className="text-sm">Generation demand exceeds included allotment</AlertTitle>
              <AlertDescription className="text-xs">
                {overageUnlocksCheaper && cheapestWithOverage ? (
                  <>
                    Preview overage on to see {cheapestWithOverage.displayName} cover it for ~
                    {money0(
                      evaluatePlans({
                        gensDemand: profit.gensDemand,
                        pagesNeeded: profit.pagesNeeded,
                        previewOverage: true,
                        plans: offerPlans,
                        overagePriceUsd,
                      }).find((r) => r.plan.planName === cheapestWithOverage.planName)
                        ?.monthlyCostUsd ?? cheapestWithOverage.priceUsd,
                    )}
                    /mo — enable it in Settings when ready.
                  </>
                ) : (
                  <>
                    Try a higher plan for more pages and headroom, or preview overage (
                    <span data-testid="insights-overage-rate">{money2(overagePriceUsd)}</span>/gen) to model pay-as-you-go.
                  </>
                )}
              </AlertDescription>
            </Alert>
          )}
          {pagesShort && (
            <Alert className="rounded-none border-x-0 border-b-0 border-red-200 bg-red-50">
              <AlertDescription className="text-xs">
                Modelled pages ({profit.pagesNeeded}) exceed {plan.displayName}&apos;s allowance (
                {plan.pageLimit}).
              </AlertDescription>
            </Alert>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          Live plan: <span className="font-medium capitalize">{livePlanLabel}</span>. Grant amounts
          come from Settings; traffic figures are illustrative until store telemetry is wired.
        </p>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="profit">Merchant profit</TabsTrigger>
            <TabsTrigger value="planfit">Plan fit</TabsTrigger>
            <TabsTrigger value="roi">Subscription ROI</TabsTrigger>
          </TabsList>

          <TabsContent value="profit" className="space-y-4 mt-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Target margin</CardTitle>
                <CardDescription>
                  Retail is implied from COGS ÷ (1 − margin). Applies to every page in the model.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap items-center gap-2">
                {[60, 65, 70].map((m) => (
                  <Button
                    key={m}
                    type="button"
                    size="sm"
                    variant={marginTarget === m ? "default" : "outline"}
                    onClick={() => setMarginTarget(m)}
                  >
                    {m}%
                  </Button>
                ))}
                <div className="flex items-center gap-2 ml-2">
                  <Input
                    type="number"
                    min={1}
                    max={99}
                    className="w-20"
                    value={marginTarget}
                    onChange={(e) => setMarginTarget(Number(e.target.value) || 65)}
                  />
                  <span className="text-sm text-muted-foreground">%</span>
                </div>
              </CardContent>
            </Card>

            <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
              <div className="space-y-3">
                {pages.map((page) => {
                  const open = openPageId === page.id || (openPageId == null && page.id === pages[0]?.id);
                  const metrics = pageMetrics.find((m) => m.id === page.id);
                  const variants = variantsForBlueprint(page.blueprintId);
                  const busy = syncingKey === page.blueprintId;
                  return (
                    <Card key={page.id} className={open ? "border-primary/30" : undefined}>
                      <button
                        type="button"
                        className="w-full flex items-center justify-between px-4 py-3 text-left"
                        onClick={() => setOpenPageId(open ? null : page.id)}
                      >
                        <div>
                          <div className="font-medium text-sm">
                            {metrics?.label || "Product page"}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {page.orders} orders/mo · {page.unitsPerOrder} units/order
                          </div>
                        </div>
                        {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </button>
                      {open && (
                        <CardContent className="space-y-3 border-t pt-4">
                          <div className="grid gap-3 sm:grid-cols-3">
                            <div className="sm:col-span-2 space-y-1">
                              <Label>Product</Label>
                              <Select
                                value={page.blueprintId || undefined}
                                onValueChange={(v) => {
                                  const picker = pickerProducts.find(
                                    (p) => String(p.blueprintId) === v,
                                  );
                                  updatePage(page.id, {
                                    blueprintId: v,
                                    productTypeId: picker?.productTypeId
                                      ? String(picker.productTypeId)
                                      : "",
                                    variantKey: "",
                                  });
                                  fetchCostsMutation.mutate({
                                    blueprintId: v,
                                    productTypeId: picker?.productTypeId
                                      ? String(picker.productTypeId)
                                      : "",
                                    rowId: page.id,
                                  });
                                }}
                              >
                                <SelectTrigger>
                                  <SelectValue
                                    placeholder={
                                      catalogLoading ? "Loading catalogue…" : "Choose product"
                                    }
                                  />
                                </SelectTrigger>
                                <SelectContent>
                                  {pickerProducts.map((p) => (
                                    <SelectItem key={p.blueprintId} value={String(p.blueprintId)}>
                                      {p.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="space-y-1">
                              <Label>Size / print</Label>
                              <Select
                                value={page.variantKey || undefined}
                                onValueChange={(v) => updatePage(page.id, { variantKey: v })}
                                disabled={!page.blueprintId || variants.length === 0}
                              >
                                <SelectTrigger>
                                  <SelectValue
                                    placeholder={busy ? "Loading…" : "Select variant"}
                                  />
                                </SelectTrigger>
                                <SelectContent>
                                  {variants.map((v) => (
                                    <SelectItem key={v.key} value={v.key}>
                                      {v.label}
                                      {v.cogsCents != null
                                        ? ` — $${(v.cogsCents / 100).toFixed(2)}`
                                        : ""}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                          <div className="grid gap-3 sm:grid-cols-3">
                            <div className="space-y-1">
                              <Label>Orders / month</Label>
                              <Input
                                type="number"
                                min={0}
                                value={page.orders}
                                onChange={(e) =>
                                  setPageOrders(page.id, Math.max(0, parseInt(e.target.value, 10) || 0))
                                }
                              />
                            </div>
                            <div className="space-y-1">
                              <Label>Units / order</Label>
                              <Input
                                type="number"
                                min={1}
                                value={page.unitsPerOrder}
                                onChange={(e) =>
                                  updatePage(page.id, {
                                    unitsPerOrder: Math.max(1, parseInt(e.target.value, 10) || 1),
                                  })
                                }
                              />
                            </div>
                            <div className="space-y-1">
                              <Label>Cross / up-sell %</Label>
                              <Input
                                type="number"
                                min={0}
                                max={100}
                                value={page.crossSellPct}
                                onChange={(e) =>
                                  updatePage(page.id, {
                                    crossSellPct: Math.max(
                                      0,
                                      Math.min(100, parseInt(e.target.value, 10) || 0),
                                    ),
                                  })
                                }
                              />
                            </div>
                          </div>
                          <div className="grid gap-3 sm:grid-cols-2 text-sm">
                            <div className="rounded-md border p-2">
                              <div className="text-muted-foreground text-xs">Retail (from margin)</div>
                              <div className="font-medium">
                                {metrics && metrics.cogsUsd > 0
                                  ? money2(retailAtMarginUsd(metrics.cogsUsd, marginTarget))
                                  : "—"}
                              </div>
                            </div>
                            <div className="rounded-md border p-2">
                              <div className="text-muted-foreground text-xs">COGS (landed)</div>
                              <div className="font-medium">
                                {metrics && metrics.cogsUsd > 0 ? money2(metrics.cogsUsd) : "—"}
                              </div>
                            </div>
                          </div>
                          {pages.length === 1 && page.crossSellPct > 0 && (
                            <p className="text-xs text-amber-700">
                              Cross/up-sell works best with 2+ modelled pages (somewhere to sell onto).
                            </p>
                          )}
                          <div className="flex justify-end">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="text-destructive"
                              disabled={pages.length <= 1}
                              onClick={() => removePage(page.id)}
                            >
                              <Trash2 className="h-4 w-4 mr-1" /> Remove page
                            </Button>
                          </div>
                        </CardContent>
                      )}
                    </Card>
                  );
                })}
                <Button type="button" variant="outline" onClick={addPage}>
                  <Plus className="h-4 w-4 mr-1" /> Add product page
                </Button>
              </div>

              <div className="space-y-3 lg:sticky lg:top-28 self-start">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">AOV lever</CardTitle>
                    <CardDescription>
                      Extra units and cross-sell raise profit without extra generations.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Base AOV</span>
                      <span className="font-medium">{money2(profit.baseAovUsd)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Simulated AOV</span>
                      <span className="font-medium">{money2(profit.simAovUsd)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Monthly profit</span>
                      <span className="font-medium">
                        {money0(
                          profit.aovChanged
                            ? profit.simMonthlyProfitUsd
                            : profit.baseMonthlyProfitUsd,
                        )}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Extra from AOV</span>
                      <span className="font-medium text-emerald-700">
                        {money0(profit.upliftUsd)}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground pt-1">
                      Biggest lever for profit: raise units/order or cross-sell — gens stay flat.
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Per-page contribution</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    {pageMetrics.map((m) => (
                      <div key={m.id} className="flex justify-between gap-2">
                        <span className="truncate text-muted-foreground">{m.label}</span>
                        <span className="font-medium tabular-nums shrink-0">
                          {money0(m.simUnitProfitUsd)}
                        </span>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="planfit" className="space-y-4 mt-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Traffic funnel</CardTitle>
                <CardDescription>
                  Edit visitors or rates to rescale page orders; edit a page&apos;s orders to
                  re-derive visitors. Example values — not live store telemetry yet.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1">
                  <Label>Visitors / month</Label>
                  <Input
                    type="number"
                    min={0}
                    value={visitors}
                    onChange={(e) =>
                      applyFunnel(
                        Math.max(0, parseInt(e.target.value, 10) || 0),
                        engagementPct,
                        conversionPct,
                      )
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label>Engagement %</Label>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    value={engagementPct}
                    onChange={(e) =>
                      applyFunnel(
                        visitors,
                        Math.max(0, Math.min(100, parseFloat(e.target.value) || 0)),
                        conversionPct,
                      )
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label>Conversion %</Label>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    step={0.5}
                    value={conversionPct}
                    onChange={(e) =>
                      applyFunnel(
                        visitors,
                        engagementPct,
                        Math.max(0, Math.min(100, parseFloat(e.target.value) || 0)),
                      )
                    }
                  />
                </div>
              </CardContent>
            </Card>

            <div className="grid gap-3 sm:grid-cols-3">
              <Card>
                <CardContent className="pt-4">
                  <div className="text-xs text-muted-foreground">Total orders</div>
                  <div className="text-xl font-semibold">{profit.totalOrders}</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4">
                  <div className="text-xs text-muted-foreground">Leads captured</div>
                  <div className="text-xl font-semibold">{profit.leadsTotal}</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4">
                  <div className="text-xs text-muted-foreground">Estimated gens / mo</div>
                  <div className="text-xl font-semibold">{profit.gensDemand}</div>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2">
                <div>
                  <CardTitle className="text-base">Plan comparison</CardTitle>
                  <CardDescription>
                    Auto-follows cheapest fit. Manual pick detaches; flipping overage re-arms.
                  </CardDescription>
                </div>
                {!autoFollow && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setAutoFollow(true);
                      setPlanName(suggested.planName);
                    }}
                  >
                    Reset to best fit
                  </Button>
                )}
              </CardHeader>
              <CardContent className="space-y-2">
                {planRows.map((row) => (
                  <button
                    key={row.plan.planName}
                    type="button"
                    onClick={() => {
                      setAutoFollow(false);
                      setPlanName(row.plan.planName);
                    }}
                    className={`w-full flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                      row.plan.planName === planName
                        ? "border-primary bg-primary/5"
                        : "hover:bg-muted/50"
                    }`}
                  >
                    <div>
                      <span className="font-medium">{row.plan.displayName}</span>
                      <span className="text-muted-foreground ml-2">
                        {money0(row.plan.priceUsd)}/mo · {row.plan.generationQuota} gens ·{" "}
                        {row.plan.pageLimit} pages
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {previewOverage && row.overageCostUsd > 0 && (
                        <span className="text-xs text-muted-foreground">
                          +{money2(row.overageCostUsd)} overage
                        </span>
                      )}
                      {fitBadge(row.status)}
                    </div>
                  </button>
                ))}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="roi" className="space-y-4 mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Subscription ROI</CardTitle>
                <CardDescription>
                  Net after plan fee{previewOverage ? " and previewed overage" : ""}.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-md border p-4">
                    <div className="text-xs text-muted-foreground">Net after plan</div>
                    <div className="text-2xl font-bold tabular-nums">{money0(netProfit)}</div>
                  </div>
                  <div className="rounded-md border p-4">
                    <div className="text-xs text-muted-foreground">Orders to cover the plan</div>
                    <div className="text-2xl font-bold tabular-nums">
                      {ordersToCover != null ? ordersToCover : "—"}
                    </div>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground">
                  Plan cost modelled: {money2(planCostUsd)}/mo
                  {previewOverage && overageCostUsd > 0
                    ? ` (includes ${money2(overageCostUsd)} overage at ${money2(overagePriceUsd)}/gen).`
                    : "."}{" "}
                  Raising AOV does not increase generation demand.
                </p>
                {fetchCostsMutation.isPending && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <Loader2 className="h-3 w-3 animate-spin" /> Refreshing catalogue costs…
                  </p>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AdminLayout>
  );
}
