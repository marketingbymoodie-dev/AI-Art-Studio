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
