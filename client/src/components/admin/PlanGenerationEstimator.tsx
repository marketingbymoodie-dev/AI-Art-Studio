import { useMemo, useState, type ReactNode } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Trash2 } from "lucide-react";
import {
  DEFAULT_GENS_PER_SALE,
  DEFAULT_PLATFORM_COST_PER_GEN_USD,
  FREE_GENS_PER_VISITOR,
  estimateMonthlyGenerations,
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
  description = "Sandbox for plan page limits and merchant generation allotments. Visitor free gens come off the merchant quota. Gens-per-sale is a guess until live data.",
  initialLines,
  lines: controlledLines,
  onLinesChange,
  footerNote,
  lockMix = false,
}: PlanGenerationEstimatorProps) {
  const [internalLines, setInternalLines] = useState<MixLine[]>(
    () => initialLines?.length ? initialLines : [newLine("Unisex tee"), newLine("Zip hoodie")],
  );
  const [gensPerSale, setGensPerSale] = useState(String(DEFAULT_GENS_PER_SALE));
  const [costPerGen, setCostPerGen] = useState(String(DEFAULT_PLATFORM_COST_PER_GEN_USD));

  const lines = controlledLines ?? internalLines;
  const setLines = (next: MixLine[]) => {
    if (onLinesChange) onLinesChange(next);
    else setInternalLines(next);
  };

  const gensN = parseFloat(gensPerSale);
  const costN = parseFloat(costPerGen);
  const units = totalMonthlyUnits(lines);
  const pagesNeeded = pagesNeededFromMix(lines);
  const estimatedGens = estimateMonthlyGenerations({
    totalUnits: units,
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

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor="gens-per-sale">Gens per sale (guess)</Label>
            <Input
              id="gens-per-sale"
              type="number"
              min={0}
              step={0.5}
              value={gensPerSale}
              onChange={(e) => setGensPerSale(e.target.value)}
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
          <div className="space-y-1">
            <Label>Free gens / visitor</Label>
            <Input value={FREE_GENS_PER_VISITOR} disabled />
            <p className="text-[11px] text-muted-foreground">
              Comes off the merchant plan allowance
            </p>
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
              {units} units × {Number.isFinite(gensN) ? gensN : DEFAULT_GENS_PER_SALE} gens
            </p>
          </div>
          <div className="rounded-md border p-3">
            <div className="text-muted-foreground">Platform AI cost</div>
            <div className="text-xl font-semibold">${aiCost.toFixed(2)}</div>
          </div>
          <div className="rounded-md border p-3">
            <div className="text-muted-foreground">Suggested plan</div>
            <div className="text-xl font-semibold">
              {recommendation.fits ? recommendation.displayName : "None fit"}
            </div>
            {recommendation.fits && recommendation.priceUsd != null && (
              <p className="text-[11px] text-muted-foreground mt-1">
                ${recommendation.priceUsd}/mo
              </p>
            )}
          </div>
        </div>

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
