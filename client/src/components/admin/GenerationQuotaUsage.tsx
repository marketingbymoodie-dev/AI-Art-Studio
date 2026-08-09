import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, ArrowUpRight } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { OverageOptInForm, planMaxBudgetFromApi } from "./OverageOptInForm";
import { OverageManageForm } from "./OverageManageForm";

export interface PlanGenerationQuota {
  plan: string | null;
  unlimited: boolean;
  freeQuota: number | null;
  overageCap: number;
  planOverageCap?: number;
  limit: number | null;
  used: number;
  remaining: number | null;
  overageUsed: number;
  overagePriceUsd: number;
  isOverage: boolean;
  includedUsed?: number;
  includedLimit?: number | null;
  includedRemaining?: number | null;
  extraUsed?: number;
  extraLimit?: number;
  extraBudgetCents?: number | null;
  extraSpentCents?: number;
  extraRemainingCents?: number | null;
  overageOptInEnabled?: boolean;
  overageRecurring?: boolean;
  showOptInForm?: boolean;
  includedExhausted?: boolean;
  currency?: string;
}

export interface PlanOverageBlock {
  priceCents: number;
  priceUsd: number;
  currency: string;
  optInEnabled: boolean;
  recurring: boolean;
  budgetCents: number | null;
  spentCents: number;
  remainingCents: number | null;
  planMaxBudgetCents: number;
  planMaxUnits: number;
  effectiveUnitCap: number;
  requiresOptIn: boolean;
  showOptInForm: boolean;
}

export interface PlanApiResponse {
  planName: string | null;
  planStatus: string | null;
  isActive: boolean;
  generationQuota: PlanGenerationQuota;
  included?: { used: number; limit: number | null; remaining: number | null; currency: string };
  extra?: {
    used: number;
    unitLimit: number;
    budgetCents: number | null;
    spentCents: number;
    remainingCents: number | null;
    currency: string;
  };
  overage?: PlanOverageBlock;
  usdDisclaimer?: string;
  pendingPlanName?: string | null;
  pendingPlanEffectiveAt?: string | null;
}

const PLAN_DISPLAY: Record<string, string> = {
  trial: "Trial",
  starter: "Starter",
  dabbler: "Dabbler",
  pro: "Pro",
  pro_plus: "Pro Plus",
};

function quotaLabel(quota: PlanGenerationQuota): string {
  if (quota.unlimited) return "Unlimited (owner store)";
  if (quota.plan === "trial") return "trial total";
  return "this month";
}

interface GenerationQuotaUsageProps {
  variant?: "card" | "inline";
  upgradeHref?: string;
  onUpgradeClick?: () => void;
  showManageLink?: boolean;
  /** Master switch for overage UI (default true). */
  showOptInForm?: boolean;
  /**
   * When true, always show enable/manage PAYG controls on paid plans
   * (Plan & Billing). Default false keeps the ≥90%-included opt-in nudge
   * on dashboard/credits so we don't nag early.
   */
  alwaysShowOverageControls?: boolean;
  /**
   * Scroll/navigate to overage caps + agreement. On Plan & Billing pass a
   * scroll handler; elsewhere defaults to `/admin/plan#overage-details`.
   */
  onSeeOverageDetails?: () => void;
  overageDetailsHref?: string;
  /** Show "See details" next to PAYG status (default true on paid plans). */
  showOverageDetailsLink?: boolean;
  className?: string;
}

export function usePlanGenerationQuota(enabled = true) {
  return useQuery<PlanApiResponse>({
    queryKey: ["/api/appai/plan"],
    enabled,
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/appai/plan");
      return res.json();
    },
  });
}

function UsageBar({
  label,
  used,
  limit,
  spentCents,
  budgetCents,
  atLimit,
  nearLimit,
  testId,
}: {
  label: string;
  used: number;
  limit: number | null;
  spentCents?: number;
  budgetCents?: number | null;
  atLimit: boolean;
  nearLimit: boolean;
  testId?: string;
}) {
  const pct = limit && limit > 0 ? Math.min((used / limit) * 100, 100) : 0;
  return (
    <div className="space-y-1" data-testid={testId}>
      <div className="flex justify-between text-xs gap-2 flex-wrap">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground">
          {limit != null ? `${used} / ${limit}` : `${used} used`}
          {spentCents != null && budgetCents != null && budgetCents > 0 && (
            <> · ${(spentCents / 100).toFixed(2)} / ${(budgetCents / 100).toFixed(2)} USD</>
          )}
        </span>
      </div>
      {limit != null && limit > 0 && (
        <div className="h-2 bg-muted rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${
              atLimit ? "bg-red-500" : nearLimit ? "bg-amber-500" : "bg-primary"
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}

export default function GenerationQuotaUsage({
  variant = "card",
  upgradeHref = "/admin/plan",
  onUpgradeClick,
  showManageLink = true,
  showOptInForm = true,
  alwaysShowOverageControls = false,
  onSeeOverageDetails,
  overageDetailsHref = "/admin/plan#overage-details",
  showOverageDetailsLink = true,
  className,
}: GenerationQuotaUsageProps) {
  const { data, isLoading } = usePlanGenerationQuota();
  const quota = data?.generationQuota;
  const planName = data?.planName;
  const planStatus = data?.planStatus;
  const overage = data?.overage;
  const pendingPlanName = data?.pendingPlanName;
  const pendingPlanEffectiveAt = data?.pendingPlanEffectiveAt;

  if (isLoading) {
    if (variant === "inline") {
      return <Skeleton className={`h-10 w-full ${className ?? ""}`} />;
    }
    return (
      <Card className={className}>
        <CardContent className="pt-4 pb-4">
          <Skeleton className="h-16 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!quota) return null;

  // Always derive included from counters (used − overage), never show a conflated total.
  const overageUsedLive = data?.extra?.used ?? quota.extraUsed ?? quota.overageUsed ?? 0;
  const includedUsed =
    data?.included?.used ??
    quota.includedUsed ??
    Math.max(0, (quota.used ?? 0) - overageUsedLive);
  const includedLimit = data?.included?.limit ?? quota.includedLimit ?? quota.freeQuota;
  const extraLimit = data?.extra?.unitLimit ?? quota.extraLimit ?? quota.overageCap;
  const extraBudgetCents = data?.extra?.budgetCents ?? quota.extraBudgetCents ?? null;
  const extraSpentCents = data?.extra?.spentCents ?? quota.extraSpentCents ?? 0;
  const optedIn = !!(overage?.optInEnabled || quota.overageOptInEnabled);

  const includedAtLimit =
    !quota.unlimited && includedLimit != null && includedUsed >= includedLimit;
  const includedNearLimit =
    !quota.unlimited && includedLimit != null && includedUsed >= includedLimit * 0.9;
  const extraAtLimit = extraLimit > 0 && overageUsedLive >= extraLimit;
  const displayPlan = planName ? (PLAN_DISPLAY[planName] ?? planName) : "—";
  const period = quotaLabel(quota);
  const apiWantsOptInNudge = !!(overage?.showOptInForm || quota.showOptInForm);
  const showEnableForm =
    showOptInForm &&
    !optedIn &&
    !quota.unlimited &&
    planName !== "trial" &&
    (alwaysShowOverageControls || apiWantsOptInNudge);
  const showManageForm =
    showOptInForm && optedIn && !quota.unlimited && planName !== "trial";
  /** Paid plans always show both lines; trial is allowance-only. */
  const showOverageLine = !quota.unlimited && planName !== "trial";
  /** Land on Plan & Billing overage section when they need to opt in. */
  const planManageHref =
    !optedIn &&
    planName !== "trial" &&
    (apiWantsOptInNudge || includedAtLimit || includedNearLimit) &&
    !upgradeHref.includes("#")
      ? `${upgradeHref}#overage-details`
      : upgradeHref;

  const bar = (
    <>
      {pendingPlanName && pendingPlanEffectiveAt && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 mb-3">
          Plan change to <strong className="capitalize">{pendingPlanName.replace("_", " ")}</strong> scheduled
          for {new Date(pendingPlanEffectiveAt).toLocaleDateString("en-US", { dateStyle: "long" })}.
          Until then your current plan benefits apply.
        </p>
      )}
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <span className="text-sm font-medium flex items-center gap-2">
          AI generations
          {planName && (
            <Badge variant="secondary" className="capitalize">
              {displayPlan}
            </Badge>
          )}
          {planStatus === "trialing" && (
            <Badge variant="outline" className="text-yellow-600 border-yellow-400">
              Trial
            </Badge>
          )}
        </span>
        <div className="flex items-center gap-3">
          {!quota.unlimited && includedLimit != null && (
            <span className="text-sm text-muted-foreground" data-testid="text-generation-quota">
              {includedUsed} / {includedLimit} plan allowance ({period})
            </span>
          )}
          {quota.unlimited && (
            <span className="text-sm text-muted-foreground">{includedUsed.toLocaleString()} used</span>
          )}
          {showManageLink && (onUpgradeClick || upgradeHref) && (
            onUpgradeClick ? (
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onUpgradeClick}>
                <ArrowUpRight className="h-3 w-3 mr-1" />
                {includedAtLimit ? "Upgrade" : "Manage Plan"}
              </Button>
            ) : (
              <Button size="sm" variant="ghost" className="h-7 text-xs" asChild>
                <Link href={planManageHref}>
                  <ArrowUpRight className="h-3 w-3 mr-1" />
                  {includedAtLimit ? "Upgrade" : "Manage Plan"}
                </Link>
              </Button>
            )
          )}
        </div>
      </div>

      {!quota.unlimited && (
        <div className="space-y-3">
          <UsageBar
            testId="quota-plan-allowance"
            label="Plan allowance"
            used={includedUsed}
            limit={includedLimit}
            atLimit={includedAtLimit}
            nearLimit={includedNearLimit && !includedAtLimit}
          />
          {showOverageLine && (
            <div className="space-y-2" data-testid="quota-overage-used">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-medium">Overage used</span>
                  <Badge
                    variant="outline"
                    data-testid="quota-overage-payg-status"
                    className={
                      optedIn
                        ? "border-emerald-600 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                        : "border-amber-600 bg-amber-100 text-amber-950 dark:bg-amber-950/50 dark:text-amber-200"
                    }
                  >
                    {optedIn ? "Pay-as-you-go ON" : "Pay-as-you-go OFF"}
                  </Badge>
                  {showOverageDetailsLink &&
                    (onSeeOverageDetails ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        data-testid="quota-overage-see-details"
                        onClick={onSeeOverageDetails}
                      >
                        See details
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        data-testid="quota-overage-see-details"
                        asChild
                      >
                        <Link href={overageDetailsHref}>See details</Link>
                      </Button>
                    ))}
                </div>
                <span className="text-xs text-muted-foreground">
                  {optedIn && extraLimit > 0
                    ? `${overageUsedLive} / ${extraLimit}`
                    : `${overageUsedLive} used`}
                  {optedIn &&
                    extraSpentCents != null &&
                    extraBudgetCents != null &&
                    extraBudgetCents > 0 && (
                      <>
                        {" "}
                        · ${(extraSpentCents / 100).toFixed(2)} / $
                        {(extraBudgetCents / 100).toFixed(2)} USD
                      </>
                    )}
                </span>
              </div>
              {optedIn && extraLimit > 0 && (
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      extraAtLimit ? "bg-red-500" : "bg-primary"
                    }`}
                    style={{
                      width: `${Math.min((overageUsedLive / extraLimit) * 100, 100)}%`,
                    }}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {quota.unlimited && (
        <p className="text-xs text-muted-foreground mt-1">Owner store — no plan cap.</p>
      )}

      {includedAtLimit && !optedIn && !quota.unlimited && (
        <p className="text-xs text-red-600 mt-3 flex items-start gap-1">
          <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
          {quota.plan === "trial"
            ? "Trial limit reached. Upgrade to Starter to keep generating."
            : "Included allowance used up. Merchant-billed generations are blocked until next period, you enable extra usage, or upgrade. Customers can still spend pack Studio Credits once packs are enabled."}
        </p>
      )}

      {showEnableForm && (
        <OverageOptInForm
          className="mt-4"
          planMaxBudgetCents={planMaxBudgetFromApi(data)}
        />
      )}

      {showManageForm && (
        <OverageManageForm
          className="mt-4"
          planMaxBudgetCents={planMaxBudgetFromApi(data)}
          spentCents={extraSpentCents}
          overageUsed={overageUsedLive}
          currentBudgetCents={extraBudgetCents ?? planMaxBudgetFromApi(data)}
          recurring={!!(overage?.recurring || quota.overageRecurring)}
        />
      )}

      <p className="text-xs text-muted-foreground mt-3">
        {data?.usdDisclaimer ?? "All prices in USD."} Reward Ladder free gens and earned Studio Credits
        count toward this shop quota when spent; merchant-sold pack credits (coming soon) do not.
        Overage used is your live counter for this period — what you were charged appears in Shopify
        billing history.
      </p>
    </>
  );

  if (variant === "inline") {
    return <div className={className}>{bar}</div>;
  }

  return (
    <Card className={className}>
      <CardContent className="pt-4 pb-4">{bar}</CardContent>
    </Card>
  );
}
