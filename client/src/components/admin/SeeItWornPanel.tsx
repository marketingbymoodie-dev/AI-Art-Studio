import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2, Shirt } from "lucide-react";
import { apiRequest, parseApiErrorMessage, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { LifestyleMockupRow } from "@shared/schema";
import type { LifestyleGender } from "@shared/lifestyleMockup";

type ListResponse = { mockups: LifestyleMockupRow[]; maxPerGender: number; flatsReady: boolean };

const APPLY_FIRST = "Apply the placement first — See it worn needs the design's saved front and back.";

/**
 * Admin-only "See it worn": on-demand AI lifestyle mockup for the current
 * tester design (zip / pullover hoodies). One cached generation per gender,
 * with capped re-rolls; the server does the work and this panel polls.
 */
export function SeeItWornPanel({ jobId }: { jobId: string }) {
  const [gender, setGender] = useState<LifestyleGender>("female");
  const { toast } = useToast();
  const queryKey = ["/api/admin/lifestyle-mockups", jobId];

  const { data } = useQuery<ListResponse>({
    queryKey,
    queryFn: async () =>
      (await apiRequest("GET", `/api/admin/lifestyle-mockups?jobId=${encodeURIComponent(jobId)}`)).json(),
    // Poll while a generation runs, and while waiting for Apply to save the flats.
    refetchInterval: (query) => {
      const d = query.state.data;
      if (d?.mockups.some((m) => m.status === "pending")) return 3000;
      return d && !d.flatsReady ? 4000 : false;
    },
  });

  const start = useMutation({
    mutationFn: async (reroll: boolean) =>
      (await apiRequest("POST", "/api/admin/lifestyle-mockups", { jobId, gender, reroll })).json(),
    onError: (error) => {
      const flatsMissing = ((error as Error)?.message ?? "").includes("FLATS_MISSING");
      toast({
        title: flatsMissing ? "Apply the placement first" : "Couldn't start See it worn",
        description: flatsMissing ? APPLY_FIRST : parseApiErrorMessage(error),
        variant: flatsMissing ? "default" : "destructive",
      });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
  });
  const flatsReady = data?.flatsReady === true;

  const rows = (data?.mockups ?? []).filter((m) => m.gender === gender);
  const latest = rows[0];
  const shown = rows.find((m) => m.status === "succeeded");
  const pending = latest?.status === "pending";
  const used = rows.filter((m) => m.status !== "failed").length;
  const max = data?.maxPerGender ?? 4;
  // Request errors surface as toasts; only a failed generation shows inline.
  const errorText = latest?.status === "failed" ? latest.error : null;

  return (
    <div className="space-y-2 rounded-md border p-3" data-testid="panel-see-it-worn">
      <div className="flex flex-wrap items-center gap-2">
        <ToggleGroup
          type="single"
          value={gender}
          onValueChange={(v) => v && setGender(v as LifestyleGender)}
          size="sm"
        >
          <ToggleGroupItem value="female" data-testid="toggle-lifestyle-female">Female</ToggleGroupItem>
          <ToggleGroupItem value="male" data-testid="toggle-lifestyle-male">Male</ToggleGroupItem>
        </ToggleGroup>
        {!shown ? (
          <Button
            size="sm"
            onClick={() => start.mutate(false)}
            disabled={!flatsReady || pending || start.isPending}
            title={flatsReady ? undefined : APPLY_FIRST}
            data-testid="button-see-it-worn"
          >
            {pending || start.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Shirt className="h-4 w-4 mr-2" />
            )}
            {pending ? "Generating…" : "See it worn"}
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            onClick={() => start.mutate(true)}
            disabled={pending || start.isPending || used >= max}
            data-testid="button-see-it-worn-reroll"
          >
            {pending || start.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            {pending ? "Generating…" : `Re-roll (${Math.max(0, max - used)} left)`}
          </Button>
        )}
      </div>
      {data && !flatsReady && !shown ? (
        <p className="text-xs text-muted-foreground" data-testid="text-see-it-worn-apply-first">{APPLY_FIRST}</p>
      ) : null}
      {errorText ? (
        <p className="text-xs text-destructive" data-testid="text-see-it-worn-error">{errorText}</p>
      ) : null}
      {shown?.imageUrl ? (
        <div className="space-y-1">
          <img
            src={shown.imageUrl}
            alt={`Lifestyle mockup (${gender})`}
            className="w-full rounded-md border"
            data-testid="img-see-it-worn"
          />
          <p className="text-xs text-muted-foreground">
            Setting: {shown.setting ?? "—"} · ${Number(shown.costUsd ?? 0).toFixed(3)} · seed {shown.seed ?? "n/a"}
          </p>
        </div>
      ) : null}
    </div>
  );
}
