import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2, Shirt } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { LifestyleMockupRow } from "@shared/schema";
import type { LifestyleGender } from "@shared/lifestyleMockup";

type ListResponse = { mockups: LifestyleMockupRow[]; maxPerGender: number };

/**
 * Admin-only "See it worn": on-demand AI lifestyle mockup for the current
 * tester design (zip / pullover hoodies). One cached generation per gender,
 * with capped re-rolls; the server does the work and this panel polls.
 */
export function SeeItWornPanel({ jobId }: { jobId: string }) {
  const [gender, setGender] = useState<LifestyleGender>("female");
  const queryKey = ["/api/admin/lifestyle-mockups", jobId];

  const { data } = useQuery<ListResponse>({
    queryKey,
    queryFn: async () =>
      (await apiRequest("GET", `/api/admin/lifestyle-mockups?jobId=${encodeURIComponent(jobId)}`)).json(),
    refetchInterval: (query) =>
      query.state.data?.mockups.some((m) => m.status === "pending") ? 3000 : false,
  });

  const start = useMutation({
    mutationFn: async (reroll: boolean) =>
      (await apiRequest("POST", "/api/admin/lifestyle-mockups", { jobId, gender, reroll })).json(),
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
  });

  const rows = (data?.mockups ?? []).filter((m) => m.gender === gender);
  const latest = rows[0];
  const shown = rows.find((m) => m.status === "succeeded");
  const pending = latest?.status === "pending";
  const used = rows.filter((m) => m.status !== "failed").length;
  const max = data?.maxPerGender ?? 4;
  const errorText =
    (start.error as Error | null)?.message ?? (latest?.status === "failed" ? latest.error : null);

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
            disabled={pending || start.isPending}
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
