import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { OVERAGE_PRICE_USD } from "@shared/customizerPlans";

export interface OverageManageFormProps {
  planMaxBudgetCents: number;
  /** Live monthlyOverageUsed × rate — floor for budget edits. */
  spentCents: number;
  overageUsed: number;
  currentBudgetCents: number;
  recurring: boolean;
  className?: string;
}

/**
 * Manage an existing PAYG agreement. Budget changes are app-side only
 * (Shopify cappedAmount is plan max at subscribe — no re-approval).
 */
export function OverageManageForm({
  planMaxBudgetCents,
  spentCents,
  overageUsed,
  currentBudgetCents,
  recurring: initialRecurring,
  className,
}: OverageManageFormProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const maxUsd = planMaxBudgetCents / 100;
  const floorUsd = Math.max(OVERAGE_PRICE_USD, spentCents / 100);
  const [budgetUsd, setBudgetUsd] = useState(
    Math.min(maxUsd, Math.max(floorUsd, currentBudgetCents / 100 || floorUsd)),
  );
  const [recurring, setRecurring] = useState<"once" | "repeat">(
    initialRecurring ? "repeat" : "once",
  );

  const saveMutation = useMutation({
    mutationFn: async () => {
      const budgetCents = Math.round(budgetUsd * 100);
      const res = await apiRequest("POST", "/api/appai/billing/overage-opt-in", {
        budgetCents,
        recurring: recurring === "repeat",
        acknowledged: true,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/appai/plan"] });
      toast({
        title: "Pay-as-you-go updated",
        description: `Budget set to $${budgetUsd.toFixed(2)} USD this period.`,
      });
    },
    onError: (err: Error) => {
      toast({ title: "Could not update", description: err.message, variant: "destructive" });
    },
  });

  const disableMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/appai/billing/overage-opt-out", {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/appai/plan"] });
      toast({
        title: "Pay-as-you-go turned off",
        description: "Extra generations are disabled for this period. Already billed usage is unchanged.",
      });
    },
    onError: (err: Error) => {
      toast({ title: "Could not turn off", description: err.message, variant: "destructive" });
    },
  });

  const busy = saveMutation.isPending || disableMutation.isPending;

  return (
    <div
      className={`rounded-lg border border-border bg-muted/30 p-4 space-y-4 ${className ?? ""}`}
      data-testid="overage-manage-form"
    >
      <div>
        <p className="text-sm font-medium">Pay-as-you-go extra generations</p>
        <p className="text-xs text-muted-foreground mt-1">
          ${OVERAGE_PRICE_USD.toFixed(2)} USD each after your plan allowance, billed through Shopify.
          This period: {overageUsed} overage used
          {spentCents > 0 ? ` ($${(spentCents / 100).toFixed(2)} USD incurred)` : ""}.
          Budget cannot go below what you have already used.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="overage-manage-budget">Maximum spend this period (USD)</Label>
        <Input
          id="overage-manage-budget"
          data-testid="overage-manage-budget"
          type="number"
          min={floorUsd}
          max={maxUsd}
          step={OVERAGE_PRICE_USD}
          value={budgetUsd}
          onChange={(e) =>
            setBudgetUsd(
              Math.min(maxUsd, Math.max(floorUsd, Number(e.target.value) || floorUsd)),
            )
          }
        />
        <p className="text-xs text-muted-foreground">
          Floor ${floorUsd.toFixed(2)} · plan max ${maxUsd.toFixed(2)} USD
        </p>
      </div>

      <RadioGroup value={recurring} onValueChange={(v) => setRecurring(v as "once" | "repeat")}>
        <div className="flex items-center space-x-2">
          <RadioGroupItem value="once" id="manage-recurring-once" />
          <Label htmlFor="manage-recurring-once" className="font-normal">
            This month only
          </Label>
        </div>
        <div className="flex items-center space-x-2">
          <RadioGroupItem value="repeat" id="manage-recurring-repeat" />
          <Label htmlFor="manage-recurring-repeat" className="font-normal">
            Repeat every billing period until I turn off
          </Label>
        </div>
      </RadioGroup>

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          data-testid="overage-manage-save"
          disabled={busy}
          onClick={() => saveMutation.mutate()}
        >
          {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
          Save changes
        </Button>
        <Button
          size="sm"
          variant="outline"
          data-testid="overage-manage-disable"
          disabled={busy}
          onClick={() => disableMutation.mutate()}
        >
          {disableMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
          Turn off
        </Button>
      </div>
    </div>
  );
}
