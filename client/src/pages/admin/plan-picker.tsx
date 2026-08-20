import { useEffect, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest, parseApiErrorMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Loader2, Zap, LayoutTemplate, Star, Rocket, Crown, Info } from "lucide-react";
import GenerationQuotaUsage, {
  usePlanGenerationQuota,
} from "@/components/admin/GenerationQuotaUsage";
import { OverageOptInForm, planMaxBudgetFromApi } from "@/components/admin/OverageOptInForm";
import { OverageManageForm } from "@/components/admin/OverageManageForm";
import {
  OVERAGE_PRICE_USD,
  PAID_PLAN_DEFINITIONS,
  PLAN_DISPLAY_NAMES,
  PLAN_GENERATION_QUOTAS,
  PLAN_PAGE_LIMITS,
} from "@shared/customizerPlans";

const PLAN_ROW_META: Record<
  string,
  { descriptionFor: (pageLimit: number) => string; highlight?: boolean; icon: ReactNode }
> = {
  starter: {
    descriptionFor: (n) =>
      `Perfect for shops selling up to ${n} custom product${n === 1 ? "" : "s"}.`,
    icon: <LayoutTemplate className="h-4 w-4 text-blue-500" />,
  },
  dabbler: {
    descriptionFor: (n) => `Try several products with up to ${n} customizer pages.`,
    highlight: true,
    icon: <Star className="h-4 w-4 text-purple-500" />,
  },
  pro: {
    descriptionFor: (n) => `Scale across your full catalog with ${n} pages.`,
    icon: <Rocket className="h-4 w-4 text-green-500" />,
  },
  pro_plus: {
    descriptionFor: (n) => `Maximum scale: ${n} customizer pages for large catalogs.`,
    icon: <Rocket className="h-4 w-4 text-orange-500" />,
  },
  mogul: {
    descriptionFor: (n) => `Enterprise scale: ${n} customizer pages — talk to us to get started.`,
    icon: <Crown className="h-4 w-4 text-red-600" />,
  },
};

function overageNoteForCap(overageCap: number, overagePriceUsd: number): string {
  return `Additional generations can be added at $${overagePriceUsd.toFixed(2)} per generation, capped at an extra ${overageCap} generations per calendar month.`;
}

const CUSTOMER_ABUSE_NOTE =
  "Free generations per customer default to 2 (merchant can raise up to 10) to avoid abuse. " +
  "Customers can earn more Studio Credits via the Reward Ladder (Studio Art Class signup, sharing a design, and optionally a purchase threshold). " +
  "Signup credits are issued by Studio. Share and purchase rewards come off your monthly allotment. " +
  "Customers can also buy generation packs on your store — you are billed wholesale; those credits do not burn plan quota.";

type PlanRow = {
  planName: string;
  displayName: string;
  priceUsd: number | null;
  pageLimit: number;
  generationQuota: number;
  overageCap: number;
  selfServe: boolean;
  description: string;
  overageNote?: string;
  trialNote?: string;
  highlight?: boolean;
  icon: ReactNode;
};

function PlanInfoPopover({
  displayName,
  overageNote,
  trialNote,
  description,
}: {
  displayName: string;
  overageNote?: string;
  trialNote?: string;
  description?: string;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${displayName} plan details`}
          className="inline-flex shrink-0 rounded-full text-muted-foreground hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <Info className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="space-y-2 text-sm leading-relaxed">
        {description ? <p>{description}</p> : null}
        {overageNote ? <p>{overageNote}</p> : null}
        {trialNote ? <p>{trialNote}</p> : null}
        <p className="text-muted-foreground">{CUSTOMER_ABUSE_NOTE}</p>
      </PopoverContent>
    </Popover>
  );
}

interface PlanPickerProps {
  onActivated?: () => void;
  inline?: boolean;
}

export default function PlanPicker({ onActivated, inline = false }: PlanPickerProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const overageAgreementRef = useRef<HTMLDivElement>(null);
  const didScrollToOverage = useRef(false);
  const { data: planStatus } = usePlanGenerationQuota();
  const { data: planCatalog } = useQuery<{
    catalogueId: number;
    overagePriceUsd: number;
    trial: { pageLimit: number; generationQuota: number };
    plans: Array<{
      planName: string;
      displayName: string;
      priceUsd: number;
      pageLimit: number;
      generationQuota: number;
      overageCap: number;
      selfServe?: boolean;
    }>;
  }>({
    queryKey: ["/api/appai/billing/plan-catalog"],
  });
  const offerPlans = planCatalog?.plans?.length
    ? planCatalog.plans
    : PAID_PLAN_DEFINITIONS.map((p) => ({ ...p, selfServe: true as boolean }));
  const overagePriceUsd = planCatalog?.overagePriceUsd ?? OVERAGE_PRICE_USD;
  const trialPages = planCatalog?.trial?.pageLimit ?? PLAN_PAGE_LIMITS.trial;
  const trialGens = planCatalog?.trial?.generationQuota ?? PLAN_GENERATION_QUOTAS.trial;
  const [loadingPlan, setLoadingPlan] = useState<string | null>(null);
  const [upgradePlan, setUpgradePlan] = useState<string | null>(null);
  const [upgradePreview, setUpgradePreview] = useState<{
    confirmationMessage: string;
    newPriceUsd: number;
    newIncludedRemaining?: number | null;
    isDowngrade?: boolean;
  } | null>(null);
  const [upgradeAcknowledged, setUpgradeAcknowledged] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);

  const quota = planStatus?.generationQuota;
  const planName = planStatus?.planName;
  const overage = planStatus?.overage;
  const optedIn = !!(overage?.optInEnabled || quota?.overageOptInEnabled);
  const overageUsedLive =
    planStatus?.extra?.used ?? quota?.extraUsed ?? quota?.overageUsed ?? 0;
  const extraBudgetCents =
    planStatus?.extra?.budgetCents ?? quota?.extraBudgetCents ?? null;
  const extraSpentCents = planStatus?.extra?.spentCents ?? quota?.extraSpentCents ?? 0;
  const needsOverageAgreement =
    !optedIn &&
    !quota?.unlimited &&
    !!planName &&
    planName !== "trial" &&
    !!(overage?.showOptInForm || quota?.showOptInForm);
  const showOverageEnableForm =
    !optedIn && !quota?.unlimited && !!planName && planName !== "trial";
  const showOverageManageForm =
    optedIn && !quota?.unlimited && !!planName && planName !== "trial";

  useEffect(() => {
    if (!planStatus || didScrollToOverage.current) return;
    const hash = typeof window !== "undefined" ? window.location.hash.replace(/^#/, "") : "";
    const hashWantsOverage =
      hash === "overage" ||
      hash === "overage-agreement" ||
      hash === "overage-details" ||
      hash === "payg";
    if (!needsOverageAgreement && !hashWantsOverage) return;
    if (!showOverageEnableForm && !showOverageManageForm && !hashWantsOverage) return;

    didScrollToOverage.current = true;
    // After layout/tables paint so the section isn't still at the top of an empty page.
    const t = window.setTimeout(() => {
      const target =
        document.getElementById("overage-details") ?? overageAgreementRef.current;
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
    return () => window.clearTimeout(t);
  }, [planStatus, needsOverageAgreement, showOverageEnableForm, showOverageManageForm]);

  const scrollToOverageDetails = () => {
    document
      .getElementById("overage-details")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const trialMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/appai/billing/start-trial"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/appai/plan"] });
      queryClient.invalidateQueries({ queryKey: ["/api/appai/customizer-pages"] });
      toast({ title: "Trial started!", description: "You can now create 1 customizer page." });
      setLoadingPlan(null);
      onActivated?.();
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
      setLoadingPlan(null);
    },
  });

  const subscriptionMutation = useMutation({
    mutationFn: (plan: string) =>
      apiRequest("POST", "/api/appai/billing/create-subscription", { plan }).then((r) => r.json()),
    onSuccess: (data: { confirmationUrl?: string; activated?: boolean }) => {
      setLoadingPlan(null);
      if (data.activated) {
        queryClient.invalidateQueries({ queryKey: ["/api/appai/plan"] });
        queryClient.invalidateQueries({ queryKey: ["/api/appai/customizer-pages"] });
        toast({ title: "Plan activated!", description: "Your plan has been set." });
        onActivated?.();
      } else if (data.confirmationUrl) {
        window.top
          ? (window.top.location.href = data.confirmationUrl)
          : (window.location.href = data.confirmationUrl);
      }
    },
    onError: (err: Error) => {
      toast({
        title: "Billing error",
        description: parseApiErrorMessage(err),
        variant: "destructive",
      });
      setLoadingPlan(null);
    },
  });

  const handleTrial = () => {
    setLoadingPlan("trial");
    trialMutation.mutate();
  };

  const handlePaid = async (plan: string) => {
    setPreviewLoading(true);
    setUpgradePlan(plan);
    setUpgradeAcknowledged(false);
    try {
      const res = await apiRequest(
        "GET",
        `/api/appai/billing/upgrade-preview?plan=${encodeURIComponent(plan)}`,
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not load upgrade preview");
      setUpgradePreview({
        confirmationMessage: data.confirmationMessage,
        newPriceUsd: data.newPriceUsd,
        newIncludedRemaining: data.newIncludedRemaining ?? null,
        isDowngrade: !!data.isDowngrade,
      });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
      setUpgradePlan(null);
    } finally {
      setPreviewLoading(false);
    }
  };

  const confirmUpgrade = () => {
    if (!upgradePlan) return;
    setLoadingPlan(upgradePlan);
    subscriptionMutation.mutate(upgradePlan);
    setUpgradePlan(null);
    setUpgradePreview(null);
  };

  const rows: PlanRow[] = [
    {
      planName: "trial",
      displayName: "Trial",
      priceUsd: null,
      pageLimit: trialPages,
      generationQuota: trialGens,
      overageCap: 0,
      selfServe: true,
      description: `Evaluate the app with ${trialPages} customizer page${trialPages === 1 ? "" : "s"}. No credit card needed.`,
      trialNote: `Your trial includes ${trialGens} generations. Once they're used, upgrade to the ${PLAN_DISPLAY_NAMES.starter} plan to keep using the customizer page you set up.`,
      icon: <Zap className="h-4 w-4 text-yellow-500" />,
    },
    ...offerPlans.map((plan) => {
      const meta = PLAN_ROW_META[plan.planName];
      const contactUs = plan.selfServe === false;
      return {
        planName: plan.planName,
        displayName: plan.displayName,
        priceUsd: plan.priceUsd,
        pageLimit: plan.pageLimit,
        generationQuota: plan.generationQuota,
        overageCap: plan.overageCap,
        selfServe: !contactUs,
        description:
          meta?.descriptionFor(plan.pageLimit) ?? `${plan.pageLimit} customizer pages.`,
        overageNote: contactUs
          ? "Enterprise plan — contact us to subscribe. Overage and billing terms are arranged with our team."
          : overageNoteForCap(plan.overageCap, overagePriceUsd),
        highlight: meta?.highlight,
        icon: meta?.icon ?? <Rocket className="h-4 w-4 text-orange-500" />,
      } satisfies PlanRow;
    }),
  ];

  const paidOverageRows = rows.filter((r) => r.planName !== "trial");

  const selectRow = (row: PlanRow) => {
    if (row.planName === "trial") {
      handleTrial();
      return;
    }
    if (!row.selfServe) {
      setLoadingPlan(row.planName);
      void apiRequest("POST", "/api/appai/billing/plan-enquiry", {
        plan: row.planName,
        pageUrl: typeof window !== "undefined" ? window.location.href : "",
      })
        .then(async (res) => {
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error || "Could not send enquiry");
          toast({
            title: "Request sent",
            description: `We'll follow up about the ${row.displayName} plan. You can also reply in Support.`,
          });
        })
        .catch((err: Error) => {
          toast({
            title: "Could not send request",
            description: parseApiErrorMessage(err),
            variant: "destructive",
          });
        })
        .finally(() => setLoadingPlan(null));
      return;
    }
    handlePaid(row.planName);
  };

  const ctaLabel = (row: PlanRow) => {
    if (row.planName === "trial") return "Start free trial";
    if (!row.selfServe) return "Contact us";
    return `Choose ${row.displayName}`;
  };

  const content = (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <GenerationQuotaUsage
        showManageLink={false}
        showOptInForm={false}
        onSeeOverageDetails={scrollToOverageDetails}
        className="mb-6"
      />

      <div className="mb-6 text-center">
        <h2 className="mb-2 text-2xl font-bold">Pick a plan to get started</h2>
        <p className="text-muted-foreground">
          Start with a free trial, or pick a paid plan for more customizer pages and a larger
          monthly allotment of included AI generations.
        </p>
      </div>

      <div className="mb-8 overflow-hidden rounded-lg border" data-testid="plan-picker-table">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[220px]">Plan</TableHead>
              <TableHead>Price</TableHead>
              <TableHead>Included gens</TableHead>
              <TableHead>Pages</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const loading = loadingPlan === row.planName;
              return (
                <TableRow
                  key={row.planName}
                  data-testid={`plan-picker-card-${row.planName}`}
                  className={row.highlight ? "bg-muted/40" : undefined}
                >
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className="shrink-0">{row.icon}</span>
                      <span className="font-medium">{row.displayName}</span>
                      {row.highlight ? (
                        <Badge className="bg-primary text-primary-foreground">Most popular</Badge>
                      ) : null}
                      {!row.selfServe && row.planName !== "trial" ? (
                        <Badge variant="secondary">Contact us</Badge>
                      ) : null}
                      <PlanInfoPopover
                        displayName={row.displayName}
                        description={row.description}
                        overageNote={row.overageNote}
                        trialNote={row.trialNote}
                      />
                    </div>
                  </TableCell>
                  <TableCell data-testid={`plan-picker-price-${row.planName}`}>
                    {row.priceUsd == null ? (
                      <span className="font-semibold">Free</span>
                    ) : (
                      <span className="font-semibold">
                        ${Math.round(row.priceUsd).toLocaleString("en-US")}
                        <span className="ml-1 text-sm font-normal text-muted-foreground">/mo</span>
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    {row.generationQuota.toLocaleString()}
                    {row.priceUsd == null ? "" : "/mo"}
                  </TableCell>
                  <TableCell>{row.pageLimit}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant={row.highlight && row.selfServe ? "default" : "outline"}
                      className="min-w-[8.5rem]"
                      onClick={() => selectRow(row)}
                      disabled={loading}
                    >
                      {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                      {ctaLabel(row)}
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <div id="overage-details" className="mb-8 scroll-mt-6">
        <div className="mb-4">
          <h3 className="text-lg font-semibold">Pay-as-you-go overage</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            After your included allowance, extra generations are{" "}
            <span data-testid="plan-picker-overage-rate">
              ${overagePriceUsd.toFixed(2)} USD each
            </span>
            , billed through Shopify up to the plan cap below (requires in-app opt-in).
          </p>
        </div>

        <div
          className="mb-8 overflow-hidden rounded-lg border"
          data-testid="plan-picker-overage-table"
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[220px]">Plan</TableHead>
                <TableHead>Max overage gens / mo</TableHead>
                <TableHead>Max overage spend / mo</TableHead>
                <TableHead>Notes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paidOverageRows.map((row) => {
                const maxSpend =
                  row.overageCap > 0
                    ? Math.round(row.overageCap * overagePriceUsd * 100) / 100
                    : 0;
                return (
                  <TableRow key={`overage-${row.planName}`}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="shrink-0">{row.icon}</span>
                        <span className="font-medium">{row.displayName}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      {row.overageCap > 0 ? row.overageCap.toLocaleString() : "—"}
                    </TableCell>
                    <TableCell>
                      {row.overageCap > 0
                        ? `$${maxSpend.toLocaleString("en-US", {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}`
                        : "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {!row.selfServe
                        ? "Arranged with our team"
                        : row.overageCap > 0
                          ? "Enable agreement below"
                          : "No overage"}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        {(showOverageEnableForm || showOverageManageForm) && (
          <div
            ref={overageAgreementRef}
            id="overage-agreement"
            className="scroll-mt-6"
            data-testid="plan-picker-overage-agreement"
          >
            <h3 className="text-lg font-semibold">
              {showOverageManageForm
                ? "Your pay-as-you-go agreement"
                : "Enable pay-as-you-go overage"}
            </h3>
            <p className="mt-1 mb-4 text-sm text-muted-foreground">
              {showOverageManageForm
                ? "Adjust your period budget or turn extra generations off. Charges already incurred stay in Shopify billing."
                : "Agree to the terms below to allow extra generations after your included allowance, billed through Shopify up to your chosen cap."}
            </p>
            {showOverageEnableForm ? (
              <OverageOptInForm planMaxBudgetCents={planMaxBudgetFromApi(planStatus)} />
            ) : (
              <OverageManageForm
                planMaxBudgetCents={planMaxBudgetFromApi(planStatus)}
                spentCents={extraSpentCents}
                overageUsed={overageUsedLive}
                currentBudgetCents={extraBudgetCents ?? planMaxBudgetFromApi(planStatus)}
                recurring={!!(overage?.recurring || quota?.overageRecurring)}
              />
            )}
          </div>
        )}
      </div>

      <p className="text-center text-xs text-muted-foreground">
        Paid plans are billed monthly through Shopify in USD. Cancel anytime. Tap ⓘ on a plan for
        details.
      </p>

      <Dialog open={!!upgradePlan} onOpenChange={(open) => !open && setUpgradePlan(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {upgradePreview?.isDowngrade ? "Confirm plan change" : "Confirm plan upgrade"}
            </DialogTitle>
            <DialogDescription>Review billing before continuing to Shopify.</DialogDescription>
          </DialogHeader>
          {previewLoading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : upgradePreview ? (
            <div className="space-y-4 text-sm">
              <p>{upgradePreview.confirmationMessage}</p>
              <div className="flex items-start gap-2">
                <Checkbox
                  id="upgrade-ack"
                  checked={upgradeAcknowledged}
                  onCheckedChange={(c) => setUpgradeAcknowledged(!!c)}
                />
                <Label htmlFor="upgrade-ack" className="font-normal leading-relaxed">
                  {upgradePreview.isDowngrade
                    ? "I understand the new plan takes effect at the end of my current billing period and my current benefits continue until then. All amounts in USD."
                    : "I understand I will be charged through Shopify and my included allowance is as described above. All amounts in USD."}
                </Label>
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setUpgradePlan(null)}>
              Cancel
            </Button>
            <Button disabled={!upgradeAcknowledged || previewLoading} onClick={confirmUpgrade}>
              Continue to Shopify
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );

  if (inline) return content;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-muted/30 p-4">
      {content}
    </div>
  );
}
