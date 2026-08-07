import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Trash2 } from "lucide-react";
import {
  DEFAULT_AVG_EMAIL_GENS_USED,
  DEFAULT_AVG_FREE_GENS_USED,
  DEFAULT_AVG_SHARE_GENS_USED,
  DEFAULT_BASE_COST_PER_GEN_USD,
  DEFAULT_CUSTOMIZER_ENGAGEMENT_RATE,
  DEFAULT_EMAIL_RUNG_TAKE_RATE,
  DEFAULT_FUNNEL_REWARD_GRANTS,
  DEFAULT_GENS_PER_SALE,
  DEFAULT_MONTHLY_VISITORS,
  DEFAULT_PURCHASE_CONVERSION_RATE,
  DEFAULT_PURCHASE_REWARD_REDEEM_RATE,
  DEFAULT_SHARE_RUNG_TAKE_RATE,
  DEFAULT_VECTORIZE_SHARE,
  estimateCustomizerFunnel,
  estimateMonthlyGenerations,
  pagesNeededFromMix,
  recommendPlan,
  totalMonthlyUnits,
  type FunnelRewardGrants,
  type MixLine,
} from "@shared/planEstimator";

function newLine(label = ""): MixLine {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    label,
    monthlyUnits: 10,
  };
}

function pctString(rate: number): string {
  return String(Math.round(rate * 1000) / 10);
}

type PlanGenerationEstimatorProps = {
  title?: string;
  description?: string;
  /** Seed mix when mounting (e.g. from merchant calculator). */
  initialLines?: MixLine[];
  /** When provided, parent owns lines (controlled). */
  lines?: MixLine[];
  onLinesChange?: (lines: MixLine[]) => void;
  /** Extra footer content (e.g. merchant current-plan note). */
  footerNote?: ReactNode;
  /** When true, mix is display-only (parent owns product rows). */
  lockMix?: boolean;
  /**
   * When false (merchant Profit Insights), hide platform cost / vectorize inputs
   * and dollar AI cost / plan−AI / cost-per-lead. Math still runs under the hood.
   */
  showPlatformCost?: boolean;
  /** Live free-gens + Reward Ladder grants from Settings. */
  rewardGrants?: FunnelRewardGrants;
};

export default function PlanGenerationEstimator({
  title = "Plan & generation estimator",
  description = "Funnel model: visitors → customizer engagement → free gens + Reward Ladder spend. Plan fit uses credits spent, not granted.",
  initialLines,
  lines: controlledLines,
  onLinesChange,
  footerNote,
  lockMix = false,
  showPlatformCost = true,
  rewardGrants,
}: PlanGenerationEstimatorProps) {
  const grants = rewardGrants ?? DEFAULT_FUNNEL_REWARD_GRANTS;

  const [internalLines, setInternalLines] = useState<MixLine[]>(
    () => (initialLines?.length ? initialLines : [newLine("Unisex tee"), newLine("Zip hoodie")]),
  );
  const [monthlyVisitors, setMonthlyVisitors] = useState(String(DEFAULT_MONTHLY_VISITORS));
  const [engagementPct, setEngagementPct] = useState(pctString(DEFAULT_CUSTOMIZER_ENGAGEMENT_RATE));
  const [conversionPct, setConversionPct] = useState(pctString(DEFAULT_PURCHASE_CONVERSION_RATE));

  const [avgFreeGensUsed, setAvgFreeGensUsed] = useState(String(DEFAULT_AVG_FREE_GENS_USED));
  const [emailTakePct, setEmailTakePct] = useState(pctString(DEFAULT_EMAIL_RUNG_TAKE_RATE));
  const [avgEmailGensUsed, setAvgEmailGensUsed] = useState(
    String(Math.min(DEFAULT_AVG_EMAIL_GENS_USED, grants.emailCredits || DEFAULT_AVG_EMAIL_GENS_USED)),
  );
  const [shareTakePct, setShareTakePct] = useState(pctString(DEFAULT_SHARE_RUNG_TAKE_RATE));
  const [avgShareGensUsed, setAvgShareGensUsed] = useState(
    String(Math.min(DEFAULT_AVG_SHARE_GENS_USED, grants.shareCredits || DEFAULT_AVG_SHARE_GENS_USED)),
  );
  const [purchaseRedeemPct, setPurchaseRedeemPct] = useState(
    pctString(DEFAULT_PURCHASE_REWARD_REDEEM_RATE),
  );

  const [baseCostPerGen, setBaseCostPerGen] = useState(String(DEFAULT_BASE_COST_PER_GEN_USD));
  const [vectorizeSharePct, setVectorizeSharePct] = useState(pctString(DEFAULT_VECTORIZE_SHARE));
  const [gensPerSale, setGensPerSale] = useState(String(DEFAULT_GENS_PER_SALE));
  const [showAdvanced, setShowAdvanced] = useState(false);

  // When live grants change (merchant Settings), clamp avg-used defaults to new caps.
  useEffect(() => {
    setAvgFreeGensUsed((prev) => {
      const n = parseFloat(prev);
      if (!Number.isFinite(n)) return String(Math.min(DEFAULT_AVG_FREE_GENS_USED, grants.freeGensPerVisitor));
      return String(Math.min(n, grants.freeGensPerVisitor));
    });
    setAvgEmailGensUsed((prev) => {
      const cap = grants.emailCredits || 0;
      const n = parseFloat(prev);
      if (!cap) return "0";
      if (!Number.isFinite(n)) return String(Math.min(DEFAULT_AVG_EMAIL_GENS_USED, cap));
      return String(Math.min(n, cap));
    });
    setAvgShareGensUsed((prev) => {
      const cap = grants.shareCredits || 0;
      const n = parseFloat(prev);
      if (!cap) return "0";
      if (!Number.isFinite(n)) return String(Math.min(DEFAULT_AVG_SHARE_GENS_USED, cap));
      return String(Math.min(n, cap));
    });
  }, [grants.freeGensPerVisitor, grants.emailCredits, grants.shareCredits]);

  const lines = controlledLines ?? internalLines;
  const setLines = (next: MixLine[]) => {
    if (onLinesChange) onLinesChange(next);
    else setInternalLines(next);
  };

  const parsePct = (raw: string, fallback: number) => {
    const pct = parseFloat(raw);
    if (!Number.isFinite(pct)) return fallback;
    return Math.min(1, Math.max(0, pct / 100));
  };

  const visitorsN = parseFloat(monthlyVisitors);
  const visitors = Number.isFinite(visitorsN) ? Math.max(0, visitorsN) : DEFAULT_MONTHLY_VISITORS;
  const units = totalMonthlyUnits(lines);
  const pagesNeeded = pagesNeededFromMix(lines);

  const funnel = useMemo(
    () =>
      estimateCustomizerFunnel({
        monthlyVisitors: visitors,
        engagementRate: parsePct(engagementPct, DEFAULT_CUSTOMIZER_ENGAGEMENT_RATE),
        avgFreeGensUsed: (() => {
          const n = parseFloat(avgFreeGensUsed);
          return Number.isFinite(n) ? n : DEFAULT_AVG_FREE_GENS_USED;
        })(),
        emailTakeRate: parsePct(emailTakePct, DEFAULT_EMAIL_RUNG_TAKE_RATE),
        avgEmailGensUsed: (() => {
          const n = parseFloat(avgEmailGensUsed);
          return Number.isFinite(n) ? n : DEFAULT_AVG_EMAIL_GENS_USED;
        })(),
        shareTakeRate: parsePct(shareTakePct, DEFAULT_SHARE_RUNG_TAKE_RATE),
        avgShareGensUsed: (() => {
          const n = parseFloat(avgShareGensUsed);
          return Number.isFinite(n) ? n : DEFAULT_AVG_SHARE_GENS_USED;
        })(),
        purchaseConversionRate: parsePct(conversionPct, DEFAULT_PURCHASE_CONVERSION_RATE),
        purchaseRedeemRate: parsePct(purchaseRedeemPct, DEFAULT_PURCHASE_REWARD_REDEEM_RATE),
        baseCostPerGenUsd: (() => {
          const n = parseFloat(baseCostPerGen);
          return Number.isFinite(n) ? n : DEFAULT_BASE_COST_PER_GEN_USD;
        })(),
        vectorizeShare: parsePct(vectorizeSharePct, DEFAULT_VECTORIZE_SHARE),
        grants,
      }),
    [
      visitors,
      engagementPct,
      avgFreeGensUsed,
      emailTakePct,
      avgEmailGensUsed,
      shareTakePct,
      avgShareGensUsed,
      conversionPct,
      purchaseRedeemPct,
      baseCostPerGen,
      vectorizeSharePct,
      grants,
    ],
  );

  const estimatedGens = funnel.totalGensSpent;
  const expectedSales = funnel.orders;
  const gensN = parseFloat(gensPerSale);
  const gensPerSaleEstimate = estimateMonthlyGenerations({
    totalUnits: units > 0 ? units : expectedSales,
    gensPerSale: Number.isFinite(gensN) ? gensN : DEFAULT_GENS_PER_SALE,
  });

  const recommendation = useMemo(
    () => recommendPlan({ pagesNeeded, estimatedGens }),
    [pagesNeeded, estimatedGens],
  );
  const suggestedPlanProfit =
    showPlatformCost && recommendation.fits && recommendation.priceUsd != null
      ? Math.round((recommendation.priceUsd - funnel.aiCostUsd) * 100) / 100
      : null;

  const engagementRate = parsePct(engagementPct, DEFAULT_CUSTOMIZER_ENGAGEMENT_RATE);
  const conversionRate = parsePct(conversionPct, DEFAULT_PURCHASE_CONVERSION_RATE);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <Label>Product mix (monthly units)</Label>
            {!lockMix && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setLines([...lines, newLine("")])}
              >
                <Plus className="h-3.5 w-3.5 mr-1" />
                Add product
              </Button>
            )}
          </div>
          <div className="space-y-2">
            {lines.map((line) => (
              <div key={line.id} className="flex flex-wrap gap-2 items-center">
                {lockMix ? (
                  <div className="flex-1 min-w-[160px] text-sm font-medium truncate px-1">
                    {line.label || "Product"}
                  </div>
                ) : (
                  <Input
                    className="flex-1 min-w-[160px]"
                    placeholder="Product name"
                    value={line.label}
                    onChange={(e) =>
                      setLines(
                        lines.map((l) =>
                          l.id === line.id ? { ...l, label: e.target.value } : l,
                        ),
                      )
                    }
                  />
                )}
                {lockMix ? (
                  <div className="w-28 text-sm tabular-nums text-right px-1">
                    {Number.isFinite(line.monthlyUnits) ? line.monthlyUnits : 0} units
                  </div>
                ) : (
                  <Input
                    className="w-28"
                    type="number"
                    min={0}
                    placeholder="Units"
                    value={Number.isFinite(line.monthlyUnits) ? line.monthlyUnits : 0}
                    onChange={(e) =>
                      setLines(
                        lines.map((l) =>
                          l.id === line.id
                            ? { ...l, monthlyUnits: parseInt(e.target.value, 10) || 0 }
                            : l,
                        ),
                      )
                    }
                  />
                )}
                {!lockMix && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={lines.length <= 1}
                    onClick={() => setLines(lines.filter((l) => l.id !== line.id))}
                    aria-label="Remove product"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor="monthly-visitors">Unique visitors / mo</Label>
            <Input
              id="monthly-visitors"
              type="number"
              min={0}
              step={1}
              value={monthlyVisitors}
              onChange={(e) => setMonthlyVisitors(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="engagement-pct">Customizer engagement %</Label>
            <Input
              id="engagement-pct"
              type="number"
              min={0}
              max={100}
              step={1}
              value={engagementPct}
              onChange={(e) => setEngagementPct(e.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">
              % of visitors who open the customizer (typical 10–40%)
            </p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="conversion-pct">Purchase conversion % (of engaged)</Label>
            <Input
              id="conversion-pct"
              type="number"
              min={0}
              max={100}
              step={0.1}
              value={conversionPct}
              onChange={(e) => setConversionPct(e.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">
              Of engaged visitors — not raw page traffic
            </p>
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          Free allotment from Settings:{" "}
          <span className="font-medium text-foreground">{grants.freeGensPerVisitor}</span>
          {" · "}
          Email rung:{" "}
          <span className="font-medium text-foreground">
            {grants.emailEnabled ? `+${grants.emailCredits}` : "off"}
          </span>
          {" · "}
          Share:{" "}
          <span className="font-medium text-foreground">
            {grants.shareEnabled ? `+${grants.shareCredits}` : "off"}
          </span>
          {" · "}
          Purchase:{" "}
          <span className="font-medium text-foreground">
            {grants.purchaseEnabled ? `+${grants.purchaseCredits}` : "off"}
          </span>
        </p>

        {showPlatformCost && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="base-cost-per-gen">Base cost / gen (USD)</Label>
              <Input
                id="base-cost-per-gen"
                type="number"
                min={0}
                step={0.01}
                value={baseCostPerGen}
                onChange={(e) => setBaseCostPerGen(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="vectorize-share">Vectorize share %</Label>
              <Input
                id="vectorize-share"
                type="number"
                min={0}
                max={100}
                step={1}
                value={vectorizeSharePct}
                onChange={(e) => setVectorizeSharePct(e.target.value)}
              />
              <p className="text-[11px] text-muted-foreground">
                Blended ≈ ${funnel.blendedCostPerGen.toFixed(3)}/gen (+$0.01 × share)
              </p>
            </div>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
          <div className="rounded-md border p-3">
            <div className="text-muted-foreground">Pages needed</div>
            <div className="text-xl font-semibold">{pagesNeeded}</div>
          </div>
          <div className="rounded-md border p-3">
            <div className="text-muted-foreground">Est. gens spent / mo</div>
            <div className="text-xl font-semibold">{estimatedGens}</div>
            <p className="text-[11px] text-muted-foreground mt-1">
              {funnel.engaged} engaged × funnel rates
            </p>
          </div>
          <div className="rounded-md border p-3">
            <div className="text-muted-foreground">Expected sales</div>
            <div className="text-xl font-semibold">{expectedSales}</div>
            <p className="text-[11px] text-muted-foreground mt-1">
              {funnel.engaged} engaged × {(conversionRate * 100).toFixed(1)}%
              {units > 0 ? ` · mix units ${units}` : ""}
            </p>
          </div>
          <div className="rounded-md border p-3">
            <div className="text-muted-foreground">Suggested plan</div>
            <div className="text-xl font-semibold">
              {recommendation.fits ? recommendation.displayName : "None fit"}
            </div>
            {recommendation.fits && recommendation.priceUsd != null && (
              <p className="text-[11px] text-muted-foreground mt-1">
                ${recommendation.priceUsd}/mo
                {showPlatformCost
                  ? ` · AI ~$${funnel.aiCostUsd.toFixed(2)}${
                      suggestedPlanProfit != null
                        ? ` · plan−AI ≈ $${suggestedPlanProfit.toFixed(2)}`
                        : ""
                    }`
                  : ` · ~${estimatedGens} gens spent`}
              </p>
            )}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 text-sm">
          <div className="rounded-md border p-3">
            <div className="text-muted-foreground">Leads captured (email rung)</div>
            <div className="text-xl font-semibold">{funnel.leadsCaptured}</div>
            <p className="text-[11px] text-muted-foreground mt-1">
              Engaged × email take rate — merchant acquisition value
            </p>
          </div>
          {showPlatformCost ? (
            <div className="rounded-md border p-3">
              <div className="text-muted-foreground">Cost per lead</div>
              <div className="text-xl font-semibold">
                {funnel.costPerLeadUsd != null ? `$${funnel.costPerLeadUsd.toFixed(2)}` : "—"}
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">
                AI ~${funnel.aiCostUsd.toFixed(2)} ÷ leads (gens as acquisition spend)
              </p>
            </div>
          ) : (
            <div className="rounded-md border p-3">
              <div className="text-muted-foreground">Funnel breakdown (gens spent)</div>
              <p className="text-[11px] text-muted-foreground mt-1 space-y-0.5">
                <span className="block">Free: {funnel.freeGensSpent}</span>
                <span className="block">Email: {funnel.emailGensSpent}</span>
                <span className="block">Share: {funnel.shareGensSpent}</span>
                <span className="block">Purchase redeem: {funnel.purchaseGensSpent}</span>
              </p>
            </div>
          )}
        </div>

        <div className="rounded-md border border-sky-200 bg-sky-50/60 p-3 text-sm space-y-1">
          <p className="font-medium text-sky-950">Customizer funnel</p>
          <p className="text-sky-900/90">
            {visitors} visitors × {(engagementRate * 100).toFixed(0)}% engagement →{" "}
            <span className="font-semibold">{funnel.engaged}</span> engaged. Plan fit uses{" "}
            <span className="font-semibold">{estimatedGens}</span> gens spent (not credits
            granted). Expected sales:{" "}
            <span className="font-semibold">{expectedSales}</span>/mo · leads:{" "}
            <span className="font-semibold">{funnel.leadsCaptured}</span>.
          </p>
        </div>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="px-0 h-auto text-xs text-muted-foreground"
          onClick={() => setShowAdvanced((v) => !v)}
        >
          {showAdvanced ? "Hide" : "Show"} advanced funnel rates
        </Button>
        {showAdvanced && (
          <div className="rounded-md border p-3 space-y-3 text-sm">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <div className="space-y-1">
                <Label htmlFor="avg-free-gens">Avg free gens used</Label>
                <Input
                  id="avg-free-gens"
                  type="number"
                  min={0}
                  max={grants.freeGensPerVisitor}
                  step={0.1}
                  value={avgFreeGensUsed}
                  onChange={(e) => setAvgFreeGensUsed(e.target.value)}
                />
                <p className="text-[11px] text-muted-foreground">
                  Of {grants.freeGensPerVisitor} free (not everyone uses both)
                </p>
              </div>
              {grants.emailEnabled && grants.emailCredits > 0 && (
                <>
                  <div className="space-y-1">
                    <Label htmlFor="email-take">Email rung take %</Label>
                    <Input
                      id="email-take"
                      type="number"
                      min={0}
                      max={100}
                      step={0.5}
                      value={emailTakePct}
                      onChange={(e) => setEmailTakePct(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="avg-email-gens">Avg email gens used</Label>
                    <Input
                      id="avg-email-gens"
                      type="number"
                      min={0}
                      max={grants.emailCredits}
                      step={0.1}
                      value={avgEmailGensUsed}
                      onChange={(e) => setAvgEmailGensUsed(e.target.value)}
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Of {grants.emailCredits} granted
                    </p>
                  </div>
                </>
              )}
              {grants.shareEnabled && grants.shareCredits > 0 && (
                <>
                  <div className="space-y-1">
                    <Label htmlFor="share-take">Share rung take %</Label>
                    <Input
                      id="share-take"
                      type="number"
                      min={0}
                      max={100}
                      step={0.5}
                      value={shareTakePct}
                      onChange={(e) => setShareTakePct(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="avg-share-gens">Avg share gens used</Label>
                    <Input
                      id="avg-share-gens"
                      type="number"
                      min={0}
                      max={grants.shareCredits}
                      step={0.1}
                      value={avgShareGensUsed}
                      onChange={(e) => setAvgShareGensUsed(e.target.value)}
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Of {grants.shareCredits} granted
                    </p>
                  </div>
                </>
              )}
              {grants.purchaseEnabled && grants.purchaseCredits > 0 && (
                <div className="space-y-1">
                  <Label htmlFor="purchase-redeem">Purchase reward redeem %</Label>
                  <Input
                    id="purchase-redeem"
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    value={purchaseRedeemPct}
                    onChange={(e) => setPurchaseRedeemPct(e.target.value)}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Of {grants.purchaseCredits} granted per order (breakage)
                  </p>
                </div>
              )}
              <div className="space-y-1">
                <Label htmlFor="gens-per-sale">Gens per sale (cross-check)</Label>
                <Input
                  id="gens-per-sale"
                  type="number"
                  min={0}
                  step={0.5}
                  value={gensPerSale}
                  onChange={(e) => setGensPerSale(e.target.value)}
                />
              </div>
            </div>
            <p className="text-muted-foreground">
              Units/sales × gens/sale ≈{" "}
              <span className="font-medium text-foreground">{gensPerSaleEstimate}</span> gens
              (analytics-style cross-check only — not used for plan fit).
            </p>
          </div>
        )}

        <p className="text-sm text-muted-foreground">{recommendation.reason}</p>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-2">Plan</th>
                <th className="py-2 pr-2">Price</th>
                <th className="py-2 pr-2">Pages</th>
                <th className="py-2 pr-2">Gens</th>
                <th className="py-2">Fit</th>
              </tr>
            </thead>
            <tbody>
              {recommendation.comparisons.map((c) => (
                <tr key={c.planName} className="border-b last:border-0">
                  <td className="py-2 pr-2 font-medium">{c.displayName}</td>
                  <td className="py-2 pr-2">${c.priceUsd}</td>
                  <td className="py-2 pr-2">
                    {pagesNeeded}/{c.pageLimit}{" "}
                    <span className={c.pagesOk ? "text-emerald-700" : "text-destructive"}>
                      {c.pagesOk ? "ok" : "short"}
                    </span>
                  </td>
                  <td className="py-2 pr-2">
                    {estimatedGens}/{c.generationQuota}{" "}
                    <span className={c.gensOk ? "text-emerald-700" : "text-destructive"}>
                      {c.gensOk ? "ok" : `−${c.genShortfall}`}
                    </span>
                  </td>
                  <td className="py-2">{c.fits ? "Yes" : "No"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {footerNote}
      </CardContent>
    </Card>
  );
}
