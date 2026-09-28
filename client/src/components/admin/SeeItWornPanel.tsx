import { useEffect, useState } from "react";
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

export type SeeItWornView = "flat" | "worn";

/**
 * Admin-only "See it worn" state for the current tester design: one cached
 * generation per gender, capped re-rolls. The server does the work; this polls.
 */
export function useSeeItWorn(jobId: string | null) {
  const [gender, setGender] = useState<LifestyleGender>("female");
  const [view, setView] = useState<SeeItWornView>("flat");
  const { toast } = useToast();
  const queryKey = ["/api/admin/lifestyle-mockups", jobId];

  const { data } = useQuery<ListResponse>({
    queryKey,
    enabled: !!jobId,
    queryFn: async () =>
      (await apiRequest("GET", `/api/admin/lifestyle-mockups?jobId=${encodeURIComponent(jobId!)}`)).json(),
    // Poll while a generation runs, and while waiting for Apply to save BOTH flats.
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
      // Never surface the raw 409 body; a missing-flats race gets the Apply hint.
      const flatsMissing = ((error as Error)?.message ?? "").includes("FLATS_MISSING");
      toast({
        title: flatsMissing ? "Apply the placement first" : "Couldn't start See it worn",
        description: flatsMissing ? APPLY_FIRST : parseApiErrorMessage(error),
        variant: flatsMissing ? "default" : "destructive",
      });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
  });

  const rows = (data?.mockups ?? []).filter((m) => m.gender === gender);
  const latest = rows[0];
  const shown = rows.find((m) => m.status === "succeeded") ?? null;

  // A new image for this gender switches the preview to it; a new design resets to the flat.
  const shownId = shown?.id ?? null;
  useEffect(() => {
    if (shownId != null) setView("worn");
  }, [shownId]);
  useEffect(() => {
    setView("flat");
  }, [jobId]);

  return {
    gender,
    setGender,
    view: shown ? view : ("flat" as SeeItWornView),
    setView,
    shown,
    pending: latest?.status === "pending",
    failed: latest?.status === "failed" ? latest.error ?? "Generation failed" : null,
    flatsReady: data?.flatsReady === true,
    loaded: !!data,
    used: rows.filter((m) => m.status !== "failed").length,
    max: data?.maxPerGender ?? 4,
    start: (reroll: boolean) => start.mutate(reroll),
    starting: start.isPending,
  };
}

export type SeeItWorn = ReturnType<typeof useSeeItWorn>;

/** Compact controls for the top of the main preview box. */
export function SeeItWornToolbar({ sw }: { sw: SeeItWorn }) {
  const busy = sw.pending || sw.starting;
  return (
    <div
      className="flex flex-wrap items-center gap-1.5 rounded-md bg-background/90 p-1 shadow-sm backdrop-blur"
      data-testid="toolbar-see-it-worn"
    >
      <ToggleGroup
        type="single"
        value={sw.gender}
        onValueChange={(v) => v && sw.setGender(v as LifestyleGender)}
        size="sm"
      >
        <ToggleGroupItem value="female" data-testid="toggle-lifestyle-female">Female</ToggleGroupItem>
        <ToggleGroupItem value="male" data-testid="toggle-lifestyle-male">Male</ToggleGroupItem>
      </ToggleGroup>
      {!sw.shown ? (
        <Button
          size="sm"
          onClick={() => sw.start(false)}
          disabled={!sw.flatsReady || busy}
          title={sw.flatsReady ? undefined : APPLY_FIRST}
          data-testid="button-see-it-worn"
        >
          {busy ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Shirt className="h-4 w-4 mr-1.5" />}
          {sw.pending ? "Generating…" : "See it worn"}
        </Button>
      ) : (
        <>
          <ToggleGroup
            type="single"
            value={sw.view}
            onValueChange={(v) => v && sw.setView(v as SeeItWornView)}
            size="sm"
          >
            <ToggleGroupItem value="flat" data-testid="toggle-view-flat">Flat</ToggleGroupItem>
            <ToggleGroupItem value="worn" data-testid="toggle-view-worn">Worn</ToggleGroupItem>
          </ToggleGroup>
          <Button
            size="sm"
            variant="outline"
            onClick={() => sw.start(true)}
            disabled={busy || sw.used >= sw.max}
            data-testid="button-see-it-worn-reroll"
          >
            {busy ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : null}
            {sw.pending ? "Generating…" : `Re-roll (${Math.max(0, sw.max - sw.used)} left)`}
          </Button>
        </>
      )}
      {sw.loaded && !sw.flatsReady && !sw.shown ? (
        <span className="px-1 text-xs text-muted-foreground" data-testid="text-see-it-worn-apply-first">
          Apply the placement first
        </span>
      ) : null}
      {sw.failed ? (
        <span className="px-1 text-xs text-destructive" data-testid="text-see-it-worn-error" title={sw.failed}>
          Generation failed — try Re-roll
        </span>
      ) : null}
    </div>
  );
}
