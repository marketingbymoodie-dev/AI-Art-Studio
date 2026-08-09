import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest, parseApiErrorMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
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
import { Loader2, CheckCircle, Zap, LayoutTemplate, Star, Rocket, Crown, Info } from "lucide-react";
import GenerationQuotaUsage from "@/components/admin/GenerationQuotaUsage";
import {
  OVERAGE_PRICE_USD,
  PAID_PLAN_DEFINITIONS,
  PLAN_DISPLAY_NAMES,
  PLAN_GENERATION_QUOTAS,
  PLAN_PAGE_LIMITS,
} from "@shared/customizerPlans";

const PLAN_CARD_META: Record<
  string,
  { descriptionFor: (pageLimit: number) => string; highlight?: boolean; icon: ReactNode }
> = {
  starter: {
    descriptionFor: (n) =>
      `Perfect for shops selling up to ${n} custom product${n === 1 ? "" : "s"}.`,
    icon: <LayoutTemplate className="h-5 w-5 text-blue-500" />,
  },
  dabbler: {
    descriptionFor: (n) => `Try several products with up to ${n} customizer pages.`,
    highlight: true,
    icon: <Star className="h-5 w-5 text-purple-500" />,
  },
  pro: {
    descriptionFor: (n) => `Scale across your full catalog with ${n} pages.`,
    icon: <Rocket className="h-5 w-5 text-green-500" />,
  },
  pro_plus: {
    descriptionFor: (n) => `Maximum scale: ${n} customizer pages for large catalogs.`,
    icon: <Rocket className="h-5 w-5 text-orange-500" />,
  },
  mogul: {
    descriptionFor: (n) => `Enterprise scale: ${n} customizer pages — talk to us to get started.`,
    icon: <Crown className="h-5 w-5 text-amber-600" />,
  },
};

function overageNoteForCap(overageCap: number, overagePriceUsd: number): string {
  return `Additional generations can be added at $${overagePriceUsd.toFixed(2)} per generation, capped at an extra ${overageCap} generations per calendar month.`;
}

/**
 * Shared note appended to every paid plan's info popover (and the Trial card).
 * Explains the per-customer free-generation cap and Studio Credits Reward Ladder.
 */
const CUSTOMER_ABUSE_NOTE =
  "Free generations per customer default to 2 (merchant can raise up to 10) to avoid abuse. " +
  "Customers can earn more Studio Credits via the Reward Ladder (email signup, sharing a design, and optionally a purchase threshold). " +
  "Merchant-sold credit packs are coming soon.";

interface PlanCardProps {
  name: string;
  displayName: string;
  price: number | null;
  pageLimit: number;
  /** Monthly included AI-generation allotment for this plan. */
  freeGenerations: number;
  description: string;
  /** First line of the info popover, describing this plan's overage terms (paid plans only). */
  overageNote?: string;
  /** Extra free-text shown on the Trial card explaining the upgrade path. */
  trialNote?: string;
  highlight?: boolean;
  icon: React.ReactNode;
  ctaLabel: string;
  onSelect: () => void;
  loading: boolean;
  /** Non-self-serve tiers (e.g. Mogul) — show Contact us, no Shopify checkout. */
  contactUs?: boolean;
}

function PlanCard({
  name, displayName, price, pageLimit, freeGenerations, description, overageNote, trialNote,
  highlight, icon, ctaLabel, onSelect, loading, contactUs,
}: PlanCardProps) {
  return (
    <Card
      className={`relative flex h-full min-w-0 flex-col overflow-hidden ${highlight ? "border-primary ring-2 ring-primary/20" : ""}`}
      data-testid={`plan-picker-card-${name}`}
    >
      {highlight && (
        <div className="absolute -top-3 left-1/2 z-10 -translate-x-1/2">
          <Badge className="bg-primary text-primary-foreground px-3">Most Popular</Badge>
        </div>
      )}
      <CardHeader className="pb-2 space-y-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="shrink-0">{icon}</span>
          <CardTitle className="truncate text-lg">{displayName}</CardTitle>
        </div>
        <div className="flex min-w-0 flex-wrap items-baseline gap-1" data-testid={`plan-picker-price-${name}`}>
          {price === null ? (
            <span className="text-3xl font-bold">Free</span>
          ) : (
            <>
              <span className="text-3xl font-bold">
                ${Math.round(price).toLocaleString("en-US")}
              </span>
              <span className="text-muted-foreground text-sm">/month</span>
            </>
          )}
        </div>
        <CardDescription className="text-pretty">{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col gap-4 pt-0">
        <ul className="min-w-0 flex-1 space-y-2 text-sm">
          <li className="flex min-w-0 items-start gap-2">
            <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-green-500" />
            <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1 gap-y-0.5">
              <span className="min-w-0 break-words">
                {freeGenerations.toLocaleString()} included gen
                {freeGenerations !== 1 ? "s" : ""}
                {price === null ? "" : "/mo"}
              </span>
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    aria-label={`${displayName} generation details`}
                    className="inline-flex shrink-0 rounded-full text-muted-foreground hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <Info className="h-3.5 w-3.5" />
                  </button>
                </PopoverTrigger>
                <PopoverContent align="start" className="text-sm leading-relaxed space-y-2">
                  {overageNote ? <p>{overageNote}</p> : null}
                  {trialNote ? <p>{trialNote}</p> : null}
                  <p className="text-muted-foreground">{CUSTOMER_ABUSE_NOTE}</p>
                </PopoverContent>
              </Popover>
            </span>
          </li>
          <li className="flex min-w-0 items-start gap-2">
            <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-green-500" />
            <span className="min-w-0 break-words">
              {pageLimit} customizer page{pageLimit !== 1 ? "s" : ""}
            </span>
          </li>
          <li className="flex min-w-0 items-start gap-2">
            <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-green-500" />
            <span className="min-w-0 break-words">Native cart & checkout mockups</span>
          </li>
        </ul>
        <Button
          variant={highlight && !contactUs ? "default" : "outline"}
          className="mt-auto h-auto min-h-9 w-full shrink-0 whitespace-normal px-2 py-2 text-center leading-snug"
          onClick={onSelect}
          disabled={loading}
        >
          {loading ? <Loader2 className="mr-2 h-4 w-4 shrink-0 animate-spin" /> : null}
          {contactUs ? "Contact us" : ctaLabel}
        </Button>
      </CardContent>
    </Card>
  );
}

interface PlanPickerProps {
  /** Called after a plan is activated (trial or paid) so parent can refetch. */
  onActivated?: () => void;
  /** If true, renders inline (no AdminLayout wrapping). */
  inline?: boolean;
}

export default function PlanPicker({ onActivated, inline = false }: PlanPickerProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
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
      apiRequest("POST", "/api/appai/billing/create-subscription", { plan }).then(r => r.json()),
    onSuccess: (data: { confirmationUrl?: string; activated?: boolean }) => {
      setLoadingPlan(null);
      if (data.activated) {
        // Owner bypass: plan was activated directly without Shopify billing
        queryClient.invalidateQueries({ queryKey: ["/api/appai/plan"] });
        queryClient.invalidateQueries({ queryKey: ["/api/appai/customizer-pages"] });
        toast({ title: "Plan activated!", description: "Your plan has been set." });
        onActivated?.();
      } else if (data.confirmationUrl) {
        // Redirect the full window to Shopify billing confirmation
        window.top ? (window.top.location.href = data.confirmationUrl) : (window.location.href = data.confirmationUrl);
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
      const res = await apiRequest("GET", `/api/appai/billing/upgrade-preview?plan=${encodeURIComponent(plan)}`);
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

  const content = (
    <div className="max-w-5xl mx-auto py-8 px-4">
      <GenerationQuotaUsage
        showManageLink={false}
        alwaysShowOverageControls
        className="mb-6"
      />

      <div className="text-center mb-8">
        <h2 className="text-2xl font-bold mb-2">Pick a plan to get started</h2>
        <p className="text-muted-foreground">
          Start with a free trial, or pick a paid plan for more customizer pages and a larger
          monthly allotment of included AI generations.
        </p>
      </div>

      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 xl:gap-3">
        {/* Trial */}
        <PlanCard
          name="trial"
          displayName="Trial"
          price={null}
          pageLimit={trialPages}
          freeGenerations={trialGens}
          description={`Evaluate the app with ${trialPages} customizer page${trialPages === 1 ? "" : "s"}. No credit card needed.`}
          trialNote={`Your trial includes ${trialGens} generations. Once they're used, upgrade to the ${PLAN_DISPLAY_NAMES.starter} plan to keep using the customizer page you set up.`}
          icon={<Zap className="h-5 w-5 text-yellow-500" />}
          ctaLabel="Start Free Trial"
          onSelect={handleTrial}
          loading={loadingPlan === "trial"}
        />
        {offerPlans.map((plan) => {
          const meta = PLAN_CARD_META[plan.planName];
          const contactUs = plan.selfServe === false;
          return (
            <PlanCard
              key={plan.planName}
              name={plan.planName}
              displayName={plan.displayName}
              price={plan.priceUsd}
              pageLimit={plan.pageLimit}
              freeGenerations={plan.generationQuota}
              description={
                meta?.descriptionFor(plan.pageLimit) ??
                `${plan.pageLimit} customizer pages.`
              }
              overageNote={
                contactUs
                  ? "Enterprise plan — contact us to subscribe. Overage and billing terms are arranged with our team."
                  : overageNoteForCap(plan.overageCap, overagePriceUsd)
              }
              highlight={meta?.highlight}
              icon={meta?.icon ?? <Rocket className="h-5 w-5 text-orange-500" />}
              ctaLabel={`Choose ${plan.displayName}`}
              contactUs={contactUs}
              onSelect={() => {
                if (contactUs) {
                  const subject = encodeURIComponent(
                    `AI Art Studio — ${plan.displayName} plan enquiry`,
                  );
                  window.open(
                    `mailto:hello@aiartstudio.app?subject=${subject}`,
                    "_blank",
                    "noopener,noreferrer",
                  );
                  return;
                }
                handlePaid(plan.planName);
              }}
              loading={loadingPlan === plan.planName}
            />
          );
        })}
      </div>

      <p
        className="text-center text-xs text-muted-foreground"
        data-testid="plan-picker-overage-rate"
      >
        Paid plans are billed monthly through Shopify in USD. Cancel anytime.
        Extra generations require in-app opt-in (${overagePriceUsd.toFixed(2)} USD each, pay-as-you-go). Tap ⓘ on a plan for details.
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
    <div className="min-h-screen flex flex-col items-center justify-center bg-muted/30 p-4">
      {content}
    </div>
  );
}
