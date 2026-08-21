import AdminLayout from "@/components/admin-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { FileCode, RefreshCw } from "lucide-react";

interface HealthRow {
  shopDomain: string;
  installationId: number;
  successCount: number;
  failureCount: number;
  failureRate: number;
  lastFailureAt: string | null;
}

export default function PlatformGenerationHealthPage() {
  const { toast } = useToast();
  const { data: installations } = useQuery<
    { installations: Array<{ id: number; shopDomain: string; status: string }> }
  >({
    queryKey: ["/api/shopify/installations"],
  });

  const rewriteAppUrls = async (shopDomain: string) => {
    try {
      const res = await apiRequest("POST", "/api/shopify/sync-metafields", { shopDomain });
      const body = await res.json();
      toast({
        title: "App URLs rewritten",
        description: body.message || "Product metafields now point at the current Railway app URL.",
      });
    } catch (err) {
      toast({
        title: "Rewrite failed",
        description: err instanceof Error ? err.message : "Could not rewrite product app URLs.",
        variant: "destructive",
      });
    }
  };

  const registerLegacyScript = async (shopDomain: string) => {
    try {
      const res = await apiRequest("POST", "/api/shopify/register-script", { shopDomain });
      const body = await res.json();
      toast({
        title: "Legacy cart script registered",
        description: body.message || "Script tag registered.",
      });
    } catch (err) {
      toast({
        title: "Register failed",
        description: err instanceof Error ? err.message : "Could not register the cart script tag.",
        variant: "destructive",
      });
    }
  };

  const { data, isLoading, error } = useQuery<{ shops: HealthRow[] }>({
    queryKey: ["/api/platform/generation-health"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/platform/generation-health");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to load generation health");
      }
      return res.json();
    },
  });

  return (
    <AdminLayout>
      <div className="p-6 max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Generation health</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Rolling 1-hour failure rates per shop (founder monitoring). Sorted by failure rate.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Shopify recovery</CardTitle>
            <CardDescription>
              Operator-only. Rewrite product metafields after a Railway host change, or
              re-inject the legacy cart ScriptTag. Theme App Embed is the normal cart path.
              These do not change a shop&apos;s custom domain.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {(installations?.installations ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No connected shop on this session.</p>
            ) : (
              (installations?.installations ?? []).map((inst) => (
                <div
                  key={inst.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
                >
                  <div>
                    <p className="font-mono text-xs">{inst.shopDomain}</p>
                    <p className="text-xs text-muted-foreground capitalize">{inst.status}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" className="gap-2" onClick={() => rewriteAppUrls(inst.shopDomain)}>
                      <RefreshCw className="h-3.5 w-3.5" />
                      Rewrite app URLs
                    </Button>
                    <Button size="sm" variant="outline" className="gap-2" onClick={() => registerLegacyScript(inst.shopDomain)}>
                      <FileCode className="h-3.5 w-3.5" />
                      Register legacy script
                    </Button>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Shops</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading && <Skeleton className="h-48 w-full" />}
            {error && (
              <p className="text-sm text-destructive">{(error as Error).message}</p>
            )}
            {!isLoading && !error && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="py-2 pr-4">Shop</th>
                      <th className="py-2 pr-4">Success</th>
                      <th className="py-2 pr-4">Failures</th>
                      <th className="py-2 pr-4">Rate</th>
                      <th className="py-2">Last failure</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.shops ?? []).length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-4 text-muted-foreground">
                          No health data yet.
                        </td>
                      </tr>
                    ) : (
                      data?.shops.map((row) => (
                        <tr key={row.installationId} className="border-b last:border-0">
                          <td className="py-2 pr-4 font-mono text-xs">{row.shopDomain}</td>
                          <td className="py-2 pr-4">{row.successCount}</td>
                          <td className="py-2 pr-4">{row.failureCount}</td>
                          <td className="py-2 pr-4">
                            {(row.failureRate * 100).toFixed(1)}%
                          </td>
                          <td className="py-2 text-muted-foreground text-xs">
                            {row.lastFailureAt
                              ? new Date(row.lastFailureAt).toLocaleString()
                              : "—"}
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
