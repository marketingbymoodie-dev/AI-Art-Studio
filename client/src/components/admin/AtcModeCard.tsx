import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";

interface AtcModeRow {
  installationId: number;
  shopDomain: string;
  atcMode: string;
}

const MODE_HELP: Record<string, string> = {
  "shadow-direct": "Today's path: resolve shadow SKU before add-to-cart",
  "base-first": "Branch C: add base variant, swap shadow in background",
  "no-shadow": "Branch B: line-item properties only",
};

export default function AtcModeCard() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [saving, setSaving] = useState<string | null>(null);
  const { data, isLoading, error } = useQuery<{ modes: string[]; shops: AtcModeRow[] }>({
    queryKey: ["/api/platform/atc-mode"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/platform/atc-mode");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to load ATC modes");
      }
      return res.json();
    },
  });

  const setMode = async (shopDomain: string, atcMode: string) => {
    setSaving(shopDomain);
    try {
      const res = await apiRequest("PATCH", "/api/platform/atc-mode", { shopDomain, atcMode });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Update failed");
      toast({
        title: "Add-to-cart mode updated",
        description: `${shopDomain}: ${body.previous} → ${body.atcMode}. Storefront picks it up within ~2 minutes.`,
      });
      await qc.invalidateQueries({ queryKey: ["/api/platform/atc-mode"] });
    } catch (err) {
      toast({
        title: "Update failed",
        description: err instanceof Error ? err.message : "Could not update ATC mode.",
        variant: "destructive",
      });
    } finally {
      setSaving(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Add-to-cart mode</CardTitle>
        <CardDescription>
          Operator kill switch per shop. <code>shadow-direct</code> is the known-good fallback.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading && <Skeleton className="h-24 w-full" />}
        {error && <p className="text-sm text-destructive">{(error as Error).message}</p>}
        <ShadowMintDiagnostics />
        {(data?.shops ?? []).map((row) => (
          <div
            key={row.installationId}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
          >
            <div>
              <p className="font-mono text-xs">{row.shopDomain}</p>
              <p className="text-xs text-muted-foreground">{MODE_HELP[row.atcMode] ?? row.atcMode}</p>
            </div>
            <select
              className="h-8 rounded-md border bg-background px-2 text-sm"
              value={row.atcMode}
              disabled={saving === row.shopDomain}
              onChange={(e) => setMode(row.shopDomain, e.target.value)}
              data-testid={`atc-mode-${row.shopDomain}`}
            >
              {(data?.modes ?? []).map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function ShadowMintDiagnostics() {
  const { data, isLoading, error } = useQuery<{
    counts: { shop: string; state: string; n: number }[];
    timing: { shop: string; n: number; p50Ms: number | null; p95Ms: number | null; waitP50Ms: number | null }[];
    failed: { shop: string; key: string; attempts: number; lastError: string; updatedAt: string }[];
  }>({
    queryKey: ["/api/platform/shadow-mint"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/platform/shadow-mint");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to load mint queue");
      }
      return res.json();
    },
  });
  if (isLoading) return <Skeleton className="h-16 w-full" />;
  if (error) return <p className="text-sm text-destructive">{(error as Error).message}</p>;
  const failed = data?.failed ?? [];
  const timing = data?.timing ?? [];
  const counts = data?.counts ?? [];
  return (
    <div className="space-y-2 rounded-lg border p-3" data-testid="shadow-mint-diagnostics">
      <p className="text-xs font-medium">Shadow mint queue</p>
      {counts.length === 0 && <p className="text-xs text-muted-foreground">No mint jobs yet.</p>}
      {counts.map((row) => (
        <p key={`${row.shop}:${row.state}`} className="font-mono text-xs text-muted-foreground">
          {row.shop} {row.state} {row.n}
        </p>
      ))}
      {timing.map((row) => (
        <p key={row.shop} className="font-mono text-xs text-muted-foreground">
          {row.shop} n={row.n} p50={row.p50Ms ?? "–"}ms p95={row.p95Ms ?? "–"}ms wait={row.waitP50Ms ?? "–"}ms
        </p>
      ))}
      {failed.map((row) => (
        <p key={`${row.shop}:${row.key}`} className="text-xs text-destructive">
          {row.shop} dead after {row.attempts}: {row.lastError || "failed"} ({row.key})
        </p>
      ))}
    </div>
  );
}
