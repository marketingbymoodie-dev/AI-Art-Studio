import { useMemo, useState, type ReactNode } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Trash2 } from "lucide-react";
import {
  DEFAULT_CONVERSION_RATE,
  DEFAULT_GENS_PER_SALE,
  DEFAULT_MONTHLY_VISITORS,
  DEFAULT_PLATFORM_COST_PER_GEN_USD,
  FREE_GENS_PER_VISITOR,
  estimateMonthlyGenerations,
  estimateSalesFromVisitors,
  estimateVisitorFunnelGens,
  pagesNeededFromMix,
  platformAiCostUsd,
  recommendPlan,
  totalMonthlyUnits,
  type MixLine,
} from "@shared/planEstimator";

function newLine(label = ""): MixLine {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    label,
    monthlyUnits: 10,
  };
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
};

export default function PlanGenerationEstimator({
  title = "Plan & generation estimator",
  description = "Primary story: unique visitors × free gens (plan allotment). Conversion turns traffic into sales. Gens-per-sale stays optional / provisional.",
  initialLines,
  lines: controlledLines,
  onLinesChange,
  footerNote,
  lockMix = false,
}: PlanGenerationEstimatorProps) {
  const [internalLines, setInternalLines] = useState<MixLine[]>(
    () => initialLines?.length ? initialLines : [newLine("Unisex tee"), newLine("Zip hoodie")],
  );
  const [monthlyVisitors, setMonthlyVisitors] = useState(String(DEFAULT_MONTHLY_VISITORS));
  const [conversionPct, setConversionPct] = useState(String(DEFAULT_CONVERSION_RATE * 100));
  const [gensPerSale, setGensPerSale] = useState(String(DEFAULT_GENS_PER_SALE));
  const [costPerGen, setCostPerGen] = useState(String(DEFAULT_PLATFORM_COST_PER_GEN_USD));
  const [freeGensPerVisitor, setFreeGensPerVisitor] = useState(String(FREE_GENS_PER_VISITOR));
  const [showAdvanced, setShowAdvanced] = useState(false);

  const lines = controlledLines ?? internalLines;
  const setLines = (next: MixLine[]) => {
    if (onLinesChange) onLinesChange(next);
    else setInternalLines(next);
  };

  const visitorsN = parseFloat(monthlyVisitors);
  const conversionRate = (() => {
    const pct = parseFloat(conversionPct);
    if (!Number.isFinite(pct)) return DEFAULT_CONVERSION_RATE;
    return Math.min(1, Math.max(0, pct / 100));
  })();
  const gensN = parseFloat(gensPerSale);
  const costN = parseFloat(costPerGen);
  const freeN = parseFloat(freeGensPerVisitor);
  const units = totalMonthlyUnits(lines);
  const pagesNeeded = pagesNeededFromMix(lines);

  const visitors = Number.isFinite(visitorsN) ? Math.max(0, visitorsN) : DEFAULT_MONTHLY_VISITORS;
  const freeGens = Number.isFinite(freeN) && freeN >= 0 ? freeN : FREE_GENS_PER_VISITOR;
  const estimatedGens = estimateVisitorFunnelGens({
    monthlyVisitors: visitors,
    freeGensPerVisitor: freeGens,
  });
  const expectedSales = estimateSalesFromVisitors({
    monthlyVisitors: visitors,
    conversionRate,
  });
  const gensPerSaleEstimate = estimateMonthlyGenerations({
    totalUnits: units > 0 ? units : expectedSales,
    gensPerSale: Number.isFinite(gensN) ? gensN : DEFAULT_GENS_PER_SALE,
  });
  const aiCost = platformAiCostUsd(
    estimatedGens,
    Number.isFinite(costN) ? costN : DEFAULT_PLATFORM_COST_PER_GEN_USD,
  );
  const recommendation = useMemo(
    () => recommendPlan({ pagesNeeded, estimatedGens }),
    [pagesNeeded, estimatedGens],
  );
  const suggestedPlanProfit =
    recommendation.fits && recommendation.priceUsd != null
      ? Math.round((recommendation.priceUsd - aiCost) * 100) / 100
      : null;

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

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
            <Label htmlFor="free-gens-visitor">Free gens / visitor</Label>
            <Input
              id="free-gens-visitor"
              type="number"
              min={1}
              max={10}
              step={1}
              value={freeGensPerVisitor}
              onChange={(e) => setFreeGensPerVisitor(e.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">
              Comes off the merchant plan (live default {FREE_GENS_PER_VISITOR}, max 10)
            </p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="conversion-pct">Conversion % (visitor → sale)</Label>
            <Input
              id="conversion-pct"
              type="number"
              min={0}
              max={100}
              step={0.1}
              value={conversionPct}
              onChange={(e) => setConversionPct(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="cost-per-gen">Platform cost / gen (USD)</Label>
            <Input
              id="cost-per-gen"
              type="number"
              min={0}
              step={0.01}
              value={costPerGen}
              onChange={(e) => setCostPerGen(e.target.value)}
            />
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
          <div className="rounded-md border p-3">
            <div className="text-muted-foreground">Pages needed</div>
            <div className="text-xl font-semibold">{pagesNeeded}</div>
          </div>
          <div className="rounded-md border p-3">
            <div className="text-muted-foreground">Est. gens / month</div>
            <div className="text-xl font-semibold">{estimatedGens}</div>
            <p className="text-[11px] text-muted-foreground mt-1">
              {visitors} visitors × {freeGens} free gens
            </p>
          </div>
          <div className="rounded-md border p-3">
            <div className="text-muted-foreground">Expected sales</div>
            <div className="text-xl font-semibold">{expectedSales}</div>
            <p className="text-[11px] text-muted-foreground mt-1">
              {visitors} × {(conversionRate * 100).toFixed(1)}%
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
                ${recommendation.priceUsd}/mo · AI ~${aiCost.toFixed(2)}
                {suggestedPlanProfit != null ? ` · plan−AI ≈ $${suggestedPlanProfit.toFixed(2)}` : ""}
              </p>
            )}
          </div>
        </div>

        <div className="rounded-md border border-sky-200 bg-sky-50/60 p-3 text-sm space-y-1">
          <p className="font-medium text-sky-950">Visitor funnel (primary)</p>
          <p className="text-sky-900/90">
            Plan fit uses <span className="font-semibold">{estimatedGens}</span> gens if every
            visitor uses their free allotment. Expected sales from conversion:{" "}
            <span className="font-semibold">{expectedSales}</span>/mo.
          </p>
        </div>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="px-0 h-auto text-xs text-muted-foreground"
          onClick={() => setShowAdvanced((v) => !v)}
        >
          {showAdvanced ? "Hide" : "Show"} advanced gens-per-sale guess
        </Button>
        {showAdvanced && (
          <div className="rounded-md border p-3 space-y-2 text-sm">
            <div className="space-y-1 max-w-xs">
              <Label htmlFor="gens-per-sale">Gens per sale (provisional)</Label>
              <Input
                id="gens-per-sale"
                type="number"
                min={0}
                step={0.5}
                value={gensPerSale}
                onChange={(e) => setGensPerSale(e.target.value)}
              />
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
