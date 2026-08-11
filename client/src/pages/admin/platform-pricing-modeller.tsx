import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import AdminLayout from "@/components/admin-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  PLATFORM_AI_COST_PER_GEN_USD,
  aiCostAtFullAllowanceUsd,
  marginFromPriceOverAiCost,
  priceFromMarginOverAiCost,
  type CataloguePlanRow,
  type OveragePriceTier,
  type PricingCatalogueSnapshot,
} from "@shared/customizerPlans";
import { Loader2 } from "lucide-react";

type DraftPlan = CataloguePlanRow;

function money(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function defaultMogul(): DraftPlan {
  return {
    planKey: "mogul",
    displayName: "Mogul",
    priceUsd: 0,
    generationQuota: 4500,
    pageLimit: 60,
    designProductLimit: 60,
    overageCapUnits: 2500,
    marginOverAiCostPct: 55,
    selfServe: false,
    sortOrder: 99,
  };
}

function withComputedPrice(p: DraftPlan, aiCost: number): DraftPlan {
  if (p.planKey === "trial") return { ...p, priceUsd: 0 };
  const price = priceFromMarginOverAiCost(p.generationQuota, p.marginOverAiCostPct, aiCost);
  return { ...p, priceUsd: price };
}

/** Panel body — exported for Playwright / component harnesses (no AdminLayout). */
export function PricingModellerPanel() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [draftPlans, setDraftPlans] = useState<DraftPlan[]>([]);
  const [overageRate, setOverageRate] = useState(0.1);
  const [aiCost, setAiCost] = useState(PLATFORM_AI_COST_PER_GEN_USD);
  const [commitLabel, setCommitLabel] = useState("");
  const [realisticUtilPct, setRealisticUtilPct] = useState(40);
  const [activateTarget, setActivateTarget] = useState<{ id: number; label: string } | null>(
    null,
  );

  const { data: platformStatus, isLoading: statusLoading } = useQuery<{ isPlatformAdmin: boolean }>({
    queryKey: ["/api/platform/admin/status"],
  });

  const { data: activeData, isLoading: activeLoading } = useQuery<{ catalogue: PricingCatalogueSnapshot }>({
    queryKey: ["/api/platform/pricing/active"],
    enabled: !!platformStatus?.isPlatformAdmin,
  });

  const { data: listData } = useQuery<{
    catalogues: Array<{
      id: number;
      label: string;
      status: string;
      committedAt: string;
      activatedAt: string | null;
      planCount: number;
    }>;
  }>({
    queryKey: ["/api/platform/pricing/catalogues"],
    enabled: !!platformStatus?.isPlatformAdmin,
  });

  useEffect(() => {
    const cat = activeData?.catalogue;
    if (!cat) return;
    const plans = [...cat.plans].sort((a, b) => a.sortOrder - b.sortOrder);
    if (!plans.some((p) => p.planKey === "mogul")) {
      plans.push(defaultMogul());
    }
    // Preserve committed list prices — do NOT recompute price from margin on
    // load (that turns typed $29 into $28.99). Sync the margin slider from the
    // stored price so the two stay consistent.
    setDraftPlans(
      plans.map((p) => {
        if (p.planKey === "trial") return { ...p, priceUsd: 0 };
        const price = Number(p.priceUsd) || 0;
        return {
          ...p,
          priceUsd: price,
          marginOverAiCostPct: marginFromPriceOverAiCost(
            p.generationQuota,
            price,
            cat.aiCostPerGenUsd || PLATFORM_AI_COST_PER_GEN_USD,
          ),
        };
      }),
    );
    setOverageRate(cat.overageSchedule[0]?.priceUsd ?? 0.1);
    setAiCost(cat.aiCostPerGenUsd || PLATFORM_AI_COST_PER_GEN_USD);
    const d = new Date();
    setCommitLabel(
      `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`,
    );
  }, [activeData?.catalogue]);

  const schedule: OveragePriceTier[] = useMemo(
    () => [{ upToInclusive: null, priceUsd: overageRate }],
    [overageRate],
  );

  const updatePlan = (planKey: string, patch: Partial<DraftPlan>) => {
    setDraftPlans((prev) =>
      prev.map((p) => {
        if (p.planKey !== planKey) return p;
        const next = { ...p, ...patch };
        // Margin slider drives price from the formula.
        if (patch.marginOverAiCostPct != null) {
          return withComputedPrice(next, aiCost);
        }
        // Target price or included-gens edit: keep list price clean, back-solve margin.
        if (
          p.planKey !== "trial" &&
          (patch.priceUsd != null || patch.generationQuota != null)
        ) {
          return {
            ...next,
            marginOverAiCostPct: marginFromPriceOverAiCost(
              next.generationQuota,
              next.priceUsd,
              aiCost,
            ),
          };
        }
        return next;
      }),
    );
  };

  const commitMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/platform/pricing/catalogues/commit", {
        label: commitLabel,
        overageSchedule: schedule,
        aiCostPerGenUsd: aiCost,
        plans: draftPlans,
      });
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Committed",
        description: `Version ${data.catalogue.label} (id ${data.catalogue.id}) saved. Live billing unchanged.`,
      });
      qc.invalidateQueries({ queryKey: ["/api/platform/pricing/catalogues"] });
    },
    onError: (e: Error) => toast({ title: "Commit failed", description: e.message, variant: "destructive" }),
  });

  const activateMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/platform/pricing/catalogues/${id}/activate`, {
        confirm: "ACTIVATE",
      });
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Activated",
        description: `${data.catalogue.label} is now the offer for new subscriptions.`,
      });
      qc.invalidateQueries({ queryKey: ["/api/platform/pricing/active"] });
      qc.invalidateQueries({ queryKey: ["/api/platform/pricing/catalogues"] });
      qc.invalidateQueries({ queryKey: ["/api/appai/billing/plan-catalog"] });
      setActivateTarget(null);
    },
    onError: (e: Error) => toast({ title: "Activate failed", description: e.message, variant: "destructive" }),
  });

  if (statusLoading || activeLoading) {
    return (
      <div className="flex justify-center py-16" data-testid="pricing-modeller-loading">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (!platformStatus?.isPlatformAdmin) {
    return (
      <Alert variant="destructive" data-testid="pricing-modeller-forbidden">
        <AlertTitle>Platform operator only</AlertTitle>
        <AlertDescription>This modeller is not available for merchant admins.</AlertDescription>
      </Alert>
    );
  }

  const active = activeData?.catalogue;

  return (
      <div className="max-w-5xl mx-auto space-y-6 pb-12" data-testid="pricing-modeller-root">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Pricing modeller</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Design plan pricing from AI cost + margin-over-AI-cost. Commit creates a version;
            activate is a separate step that changes new-subscription offers only.
          </p>
        </div>

        <Alert data-testid="pricing-modeller-active-banner">
          <AlertTitle>
            Active offer:{" "}
            <span data-testid="pricing-modeller-active-label">{active?.label ?? "—"}</span>{" "}
            (id <span data-testid="pricing-modeller-active-id">{active?.id ?? "—"}</span>)
          </AlertTitle>
          <AlertDescription className="text-xs">
            Sliders edit an in-memory draft. Commit does not change live billing. Existing shops keep
            their stamped pricingVersion until they re-subscribe.
          </AlertDescription>
        </Alert>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Global overage + AI cost</CardTitle>
            <CardDescription>
              Overage rate wires through resolveOveragePriceUsd (flat schedule for now; tiered-ready).
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1">
              <Label>Overage rate ($/gen)</Label>
              <Input
                type="number"
                step={0.01}
                min={0.01}
                value={overageRate}
                onChange={(e) => setOverageRate(Math.max(0.01, parseFloat(e.target.value) || 0.1))}
              />
            </div>
            <div className="space-y-1">
              <Label>AI cost / gen ($)</Label>
              <Input
                type="number"
                step={0.001}
                min={0.001}
                value={aiCost}
                onChange={(e) => {
                  const v = Math.max(0.001, parseFloat(e.target.value) || PLATFORM_AI_COST_PER_GEN_USD);
                  setAiCost(v);
                  // Keep typed list prices; refresh margin so economics stay coherent.
                  setDraftPlans((prev) =>
                    prev.map((p) => {
                      if (p.planKey === "trial") return p;
                      return {
                        ...p,
                        marginOverAiCostPct: marginFromPriceOverAiCost(
                          p.generationQuota,
                          p.priceUsd,
                          v,
                        ),
                      };
                    }),
                  );
                }}
              />
            </div>
            <div className="space-y-1">
              <Label>Realistic util % (reference only)</Label>
              <Input
                type="number"
                min={1}
                max={100}
                value={realisticUtilPct}
                onChange={(e) =>
                  setRealisticUtilPct(Math.max(1, Math.min(100, parseInt(e.target.value, 10) || 40)))
                }
              />
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          {draftPlans.map((p) => {
            const aiFull = aiCostAtFullAllowanceUsd(p.generationQuota, aiCost);
            const price = p.planKey === "trial" ? 0 : p.priceUsd;
            const marginEcho =
              p.planKey === "trial" || aiFull <= 0
                ? 0
                : Math.round((1 - aiFull / Math.max(price, 0.01)) * 1000) / 10;
            const realisticAi = aiFull * (realisticUtilPct / 100);
            const realisticMargin =
              p.planKey === "trial" || price <= 0
                ? 0
                : Math.round((1 - realisticAi / price) * 1000) / 10;
            const revPerGen = p.generationQuota > 0 ? price / p.generationQuota : 0;
            return (
              <Card key={p.planKey}>
                <CardHeader className="pb-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <CardTitle className="text-base capitalize">{p.planKey}</CardTitle>
                    <div className="flex items-center gap-2">
                      {p.planKey !== "trial" && (
                        <>
                          <Label className="text-xs">Self-serve</Label>
                          <Switch
                            checked={p.selfServe}
                            onCheckedChange={(v) => updatePlan(p.planKey, { selfServe: v })}
                          />
                        </>
                      )}
                      {!p.selfServe && p.planKey !== "trial" && (
                        <Badge variant="secondary">Contact us</Badge>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <div className="space-y-1">
                      <Label>Display name</Label>
                      <Input
                        value={p.displayName}
                        onChange={(e) => updatePlan(p.planKey, { displayName: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>Included gens</Label>
                      <Input
                        type="number"
                        min={0}
                        value={p.generationQuota}
                        onChange={(e) =>
                          updatePlan(p.planKey, {
                            generationQuota: Math.max(0, parseInt(e.target.value, 10) || 0),
                          })
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>Customizer pages</Label>
                      <Input
                        type="number"
                        min={0}
                        value={p.pageLimit}
                        onChange={(e) =>
                          updatePlan(p.planKey, {
                            pageLimit: Math.max(0, parseInt(e.target.value, 10) || 0),
                          })
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>Overage cap (gens)</Label>
                      <Input
                        type="number"
                        min={0}
                        value={p.overageCapUnits}
                        disabled={p.planKey === "trial"}
                        onChange={(e) =>
                          updatePlan(p.planKey, {
                            overageCapUnits: Math.max(0, parseInt(e.target.value, 10) || 0),
                          })
                        }
                      />
                    </div>
                  </div>
                  {p.planKey !== "trial" && (
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <Label>Margin over AI cost (not business margin)</Label>
                        <span className="font-medium tabular-nums">{p.marginOverAiCostPct}%</span>
                      </div>
                      <Slider
                        min={20}
                        max={80}
                        step={0.5}
                        value={[p.marginOverAiCostPct]}
                        onValueChange={([v]) =>
                          updatePlan(p.planKey, { marginOverAiCostPct: v ?? 50 })
                        }
                      />
                    </div>
                  )}
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 text-sm">
                    <div className="rounded-md border p-2">
                      <div className="text-xs text-muted-foreground">AI cost @ 100% util</div>
                      <div className="font-semibold">{money(aiFull)}</div>
                    </div>
                    <div className="rounded-md border p-2 space-y-1">
                      <div className="text-xs text-muted-foreground">
                        {p.planKey === "trial" ? "Price" : "Target price ($/mo)"}
                      </div>
                      {p.planKey === "trial" ? (
                        <div className="font-semibold">{money(price)}/mo</div>
                      ) : (
                        <Input
                          type="number"
                          min={0}
                          step={1}
                          className="h-8"
                          data-testid={`pricing-modeller-price-${p.planKey}`}
                          value={p.priceUsd}
                          onChange={(e) => {
                            const raw = parseFloat(e.target.value);
                            updatePlan(p.planKey, {
                              priceUsd: Number.isFinite(raw) ? Math.max(0, raw) : 0,
                            });
                          }}
                          onBlur={(e) => {
                            const raw = parseFloat(e.target.value);
                            const rounded = Math.max(
                              0,
                              Math.round(Number.isFinite(raw) ? raw : p.priceUsd),
                            );
                            if (rounded !== p.priceUsd) {
                              updatePlan(p.planKey, { priceUsd: rounded });
                            }
                          }}
                        />
                      )}
                    </div>
                    <div className="rounded-md border p-2">
                      <div className="text-xs text-muted-foreground">Margin over AI cost</div>
                      <div className="font-semibold">{marginEcho}%</div>
                    </div>
                    <div className="rounded-md border p-2">
                      <div className="text-xs text-muted-foreground">
                        Realistic margin @ {realisticUtilPct}% (ref)
                      </div>
                      <div className="font-semibold">{realisticMargin}%</div>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Per-gen: cost {money(aiCost)} · revenue at full util {money(revPerGen)} · overage{" "}
                    {money(overageRate)}
                    {overageRate <= aiCost ? " (overage ≤ AI cost — check margin)" : ""}
                  </p>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Operator economics (internal)</CardTitle>
            <CardDescription>
              Grants-vs-burn / breakage belong here — never on merchant Insights. Take/redeem rates
              stay internal defaults until Settings persists them.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-1">
            <p>
              Blended worst-case AI cost across self-serve tiers:{" "}
              <span className="font-medium text-foreground">
                {money(
                  draftPlans
                    .filter((p) => p.selfServe && p.planKey !== "trial")
                    .reduce((s, p) => s + aiCostAtFullAllowanceUsd(p.generationQuota, aiCost), 0),
                )}
              </span>{" "}
              (sum of full-allowance AI costs — not weighted by mix).
            </p>
            <p>
              Purchase redeem / breakage framing is operator-only; do not surface redeem % to merchants.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Commit as new pricing version</CardTitle>
            <CardDescription>Does not activate. Live billing stays on the current active catalogue.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label>Version label</Label>
              <Input
                value={commitLabel}
                onChange={(e) => setCommitLabel(e.target.value)}
                placeholder="2026-08"
                className="w-40"
              />
            </div>
            <Button
              type="button"
              data-testid="pricing-modeller-commit"
              onClick={() => commitMutation.mutate()}
              disabled={commitMutation.isPending || !commitLabel.trim()}
            >
              {commitMutation.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              Commit as new pricing version
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Catalogue versions</CardTitle>
            <CardDescription>
              Activate changes the offer for new subscriptions only. Staging QA before production:
              re-subscribe / cap-change, and mid-cycle quota-counter integrity (used/remaining must
              not reset or jump incorrectly when the offer activates or the shop re-approves).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2" data-testid="pricing-modeller-catalogue-list">
            {(listData?.catalogues ?? []).map((c) => (
              <div
                key={c.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
                data-testid={`pricing-catalogue-row-${c.id}`}
                data-status={c.status}
              >
                <div>
                  <span className="font-medium">
                    {c.label} (id {c.id})
                  </span>
                  <Badge className="ml-2" variant={c.status === "active" ? "default" : "secondary"}>
                    {c.status}
                  </Badge>
                  <span className="text-muted-foreground ml-2">{c.planCount} plans</span>
                </div>
                {c.status !== "active" && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    data-testid={`pricing-modeller-activate-${c.id}`}
                    disabled={activateMutation.isPending}
                    onClick={() => setActivateTarget({ id: c.id, label: c.label })}
                  >
                    Activate
                  </Button>
                )}
              </div>
            ))}
          </CardContent>
        </Card>

        <Dialog
          open={!!activateTarget}
          onOpenChange={(open) => {
            if (!open) setActivateTarget(null);
          }}
        >
          <DialogContent data-testid="pricing-modeller-activate-dialog">
            <DialogHeader>
              <DialogTitle>Activate {activateTarget?.label}?</DialogTitle>
              <DialogDescription>
                New subscriptions will use these numbers. Existing shops keep their stamped
                pricingVersion until they re-subscribe. This does not reset generation counters.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2">
              <Button
                type="button"
                variant="outline"
                data-testid="pricing-modeller-activate-cancel"
                onClick={() => setActivateTarget(null)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                data-testid="pricing-modeller-activate-confirm"
                disabled={activateMutation.isPending}
                onClick={() => {
                  if (!activateTarget) return;
                  activateMutation.mutate(activateTarget.id);
                }}
              >
                {activateMutation.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                Activate
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
  );
}

export default function PlatformPricingModellerPage() {
  return (
    <AdminLayout>
      <PricingModellerPanel />
    </AdminLayout>
  );
}
