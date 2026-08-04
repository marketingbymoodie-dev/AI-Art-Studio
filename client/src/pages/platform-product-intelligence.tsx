import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import AdminLayout from "@/components/admin-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Loader2, RefreshCw } from "lucide-react";

type SyncRun = {
  id: number;
  scope: string;
  source: string;
  status: string;
  productsChecked: number;
  variantsChecked: number;
  priceChanges: number;
  availabilityChanges: number;
  newVariants: number;
  removedVariants: number;
  syncFailures: number;
  error?: string | null;
  startedAt: string;
  finishedAt?: string | null;
};

type SyncEvent = {
  id: number;
  productTypeId: number | null;
  syncRunId: number | null;
  eventType: string;
  supplierVariantId?: string | null;
  printAreaKey?: string | null;
  createdAt: string;
};

type HealthOverview = {
  total: number;
  counts: {
    healthy: number;
    needs_review: number;
    attention_required: number;
    unknown: number;
  };
  attention: Array<{
    id: number;
    name: string;
    merchantId: string | null;
    productHealth: string;
    lastProductSyncAt: string | null;
    oosStatus: string | null;
    pricingStrategy: string;
  }>;
};

function healthBadge(health: string) {
  if (health === "attention_required") {
    return <Badge variant="destructive">Attention</Badge>;
  }
  if (health === "needs_review") {
    return (
      <Badge variant="secondary" className="bg-amber-100 text-amber-900">
        Needs review
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="bg-emerald-100 text-emerald-800">
      Healthy
    </Badge>
  );
}

export default function PlatformProductIntelligencePage() {
  const { toast } = useToast();
  const [eventFilter, setEventFilter] = useState<string>("all");
  const [selectedRunId, setSelectedRunId] = useState<string>("all");

  const {
    data: runsData,
    isLoading: runsLoading,
    error: runsError,
  } = useQuery<{ runs: SyncRun[] }>({
    queryKey: ["/api/admin/product-intelligence/runs"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/admin/product-intelligence/runs");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to load sync runs");
      }
      return res.json();
    },
  });

  const {
    data: healthData,
    isLoading: healthLoading,
  } = useQuery<HealthOverview>({
    queryKey: ["/api/admin/product-intelligence/health"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/admin/product-intelligence/health");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to load health");
      }
      return res.json();
    },
  });

  const eventsQuery = useMemo(() => {
    const params = new URLSearchParams();
    if (eventFilter !== "all") params.set("eventType", eventFilter);
    if (selectedRunId !== "all") params.set("syncRunId", selectedRunId);
    const qs = params.toString();
    return `/api/admin/product-intelligence/events${qs ? `?${qs}` : ""}`;
  }, [eventFilter, selectedRunId]);

  const {
    data: eventsData,
    isLoading: eventsLoading,
  } = useQuery<{ events: SyncEvent[] }>({
    queryKey: [eventsQuery],
    queryFn: async () => {
      const res = await apiRequest("GET", eventsQuery);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to load events");
      }
      return res.json();
    },
  });

  const syncAllMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/product-intelligence/sync-all");
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Sync-all failed");
      return body as { ok: boolean; ran: boolean; runId?: number; results?: unknown[] };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/product-intelligence/runs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/product-intelligence/health"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/product-intelligence/events"] });
      toast({
        title: data.ran ? "Catalogue Product Sync complete" : "Sync skipped",
        description: data.ran
          ? `Run #${data.runId ?? "—"} finished. ${data.results?.length ?? 0} products checked.`
          : "A catalogue sync already ran recently.",
      });
    },
    onError: (err: Error) => {
      toast({ title: "Sync failed", description: err.message, variant: "destructive" });
    },
  });

  const latest = runsData?.runs?.[0];

  return (
    <AdminLayout>
      <div className="p-6 max-w-6xl mx-auto space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Product Intelligence</h1>
            <p className="text-muted-foreground text-sm mt-1">
              Operator sync dashboard — COGS, availability, and health from Product Sync.
              Operator Catalog remains the allow-list only.
            </p>
          </div>
          <Button
            onClick={() => syncAllMutation.mutate()}
            disabled={syncAllMutation.isPending}
          >
            {syncAllMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            Sync all products
          </Button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: "Products checked", value: latest?.productsChecked },
            { label: "Variants checked", value: latest?.variantsChecked },
            { label: "Price changes", value: latest?.priceChanges },
            { label: "Availability changes", value: latest?.availabilityChanges },
            { label: "New variants", value: latest?.newVariants },
            { label: "Removed variants", value: latest?.removedVariants },
            { label: "Sync failures", value: latest?.syncFailures },
            {
              label: "Last run",
              value: latest?.startedAt ? new Date(latest.startedAt).toLocaleString() : "—",
            },
          ].map((card) => (
            <Card key={card.label}>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground">
                  {card.label}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-xl font-semibold tabular-nums">
                  {runsLoading ? <Skeleton className="h-7 w-16" /> : (card.value ?? "—")}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Catalogue health</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {healthLoading ? (
                <Skeleton className="h-24 w-full" />
              ) : (
                <>
                  <div className="flex flex-wrap gap-2 text-sm">
                    <span>Total: {healthData?.total ?? 0}</span>
                    <Badge variant="secondary" className="bg-emerald-100 text-emerald-800">
                      Healthy {healthData?.counts.healthy ?? 0}
                    </Badge>
                    <Badge variant="secondary" className="bg-amber-100 text-amber-900">
                      Review {healthData?.counts.needs_review ?? 0}
                    </Badge>
                    <Badge variant="destructive">
                      Attention {healthData?.counts.attention_required ?? 0}
                    </Badge>
                  </div>
                  <div className="overflow-x-auto max-h-72">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-left text-muted-foreground">
                          <th className="py-2 pr-2">Product</th>
                          <th className="py-2 pr-2">Health</th>
                          <th className="py-2">Last sync</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(healthData?.attention ?? []).length === 0 ? (
                          <tr>
                            <td colSpan={3} className="py-3 text-muted-foreground">
                              No products need review.
                            </td>
                          </tr>
                        ) : (
                          healthData!.attention.map((row) => (
                            <tr key={row.id} className="border-b last:border-0">
                              <td className="py-2 pr-2">
                                <div className="font-medium">{row.name}</div>
                                <div className="text-xs text-muted-foreground font-mono">
                                  #{row.id}
                                </div>
                              </td>
                              <td className="py-2 pr-2">{healthBadge(row.productHealth)}</td>
                              <td className="py-2 text-xs text-muted-foreground">
                                {row.lastProductSyncAt
                                  ? new Date(row.lastProductSyncAt).toLocaleString()
                                  : "Never"}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <CardTitle className="text-base">Change feed</CardTitle>
              <div className="flex gap-2">
                <Select value={eventFilter} onValueChange={setEventFilter}>
                  <SelectTrigger className="w-[150px] h-8">
                    <SelectValue placeholder="Event type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All events</SelectItem>
                    <SelectItem value="price_changed">Price changed</SelectItem>
                    <SelectItem value="variant_unavailable">Unavailable</SelectItem>
                    <SelectItem value="back_in_stock">Back in stock</SelectItem>
                    <SelectItem value="variant_added">New variant</SelectItem>
                    <SelectItem value="variant_removed">Removed</SelectItem>
                    <SelectItem value="sync_failure">Sync failure</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={selectedRunId} onValueChange={setSelectedRunId}>
                  <SelectTrigger className="w-[120px] h-8">
                    <SelectValue placeholder="Run" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All runs</SelectItem>
                    {(runsData?.runs ?? []).slice(0, 15).map((r) => (
                      <SelectItem key={r.id} value={String(r.id)}>
                        Run #{r.id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent>
              {eventsLoading ? (
                <Skeleton className="h-48 w-full" />
              ) : (
                <div className="overflow-x-auto max-h-80">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-muted-foreground">
                        <th className="py-2 pr-2">When</th>
                        <th className="py-2 pr-2">Type</th>
                        <th className="py-2 pr-2">PT</th>
                        <th className="py-2">Variant</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(eventsData?.events ?? []).length === 0 ? (
                        <tr>
                          <td colSpan={4} className="py-3 text-muted-foreground">
                            No events yet.
                          </td>
                        </tr>
                      ) : (
                        eventsData!.events.map((ev) => (
                          <tr key={ev.id} className="border-b last:border-0">
                            <td className="py-2 pr-2 text-xs text-muted-foreground whitespace-nowrap">
                              {new Date(ev.createdAt).toLocaleString()}
                            </td>
                            <td className="py-2 pr-2 font-mono text-xs">{ev.eventType}</td>
                            <td className="py-2 pr-2 font-mono text-xs">
                              {ev.productTypeId ?? "—"}
                            </td>
                            <td className="py-2 font-mono text-xs truncate max-w-[140px]">
                              {ev.supplierVariantId ?? "—"}
                              {ev.printAreaKey ? ` (${ev.printAreaKey})` : ""}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Sync history</CardTitle>
          </CardHeader>
          <CardContent>
            {runsLoading && <Skeleton className="h-40 w-full" />}
            {runsError && (
              <p className="text-sm text-destructive">{(runsError as Error).message}</p>
            )}
            {!runsLoading && !runsError && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="py-2 pr-3">Run</th>
                      <th className="py-2 pr-3">Source</th>
                      <th className="py-2 pr-3">Status</th>
                      <th className="py-2 pr-3">Products</th>
                      <th className="py-2 pr-3">Variants</th>
                      <th className="py-2 pr-3">Δ Price</th>
                      <th className="py-2 pr-3">Δ Avail</th>
                      <th className="py-2 pr-3">Fail</th>
                      <th className="py-2">Started</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(runsData?.runs ?? []).length === 0 ? (
                      <tr>
                        <td colSpan={9} className="py-4 text-muted-foreground">
                          No sync runs yet. Click Sync all products.
                        </td>
                      </tr>
                    ) : (
                      runsData!.runs.map((run) => (
                        <tr
                          key={run.id}
                          className="border-b last:border-0 cursor-pointer hover:bg-muted/40"
                          onClick={() => setSelectedRunId(String(run.id))}
                        >
                          <td className="py-2 pr-3 font-mono">#{run.id}</td>
                          <td className="py-2 pr-3">{run.source}</td>
                          <td className="py-2 pr-3">
                            <Badge
                              variant={run.status === "failed" ? "destructive" : "secondary"}
                            >
                              {run.status}
                            </Badge>
                          </td>
                          <td className="py-2 pr-3 tabular-nums">{run.productsChecked}</td>
                          <td className="py-2 pr-3 tabular-nums">{run.variantsChecked}</td>
                          <td className="py-2 pr-3 tabular-nums">{run.priceChanges}</td>
                          <td className="py-2 pr-3 tabular-nums">{run.availabilityChanges}</td>
                          <td className="py-2 pr-3 tabular-nums">{run.syncFailures}</td>
                          <td className="py-2 text-xs text-muted-foreground">
                            {new Date(run.startedAt).toLocaleString()}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}
