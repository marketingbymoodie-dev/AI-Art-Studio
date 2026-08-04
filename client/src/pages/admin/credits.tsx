import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CreditCard, TrendingUp, Users, LayoutTemplate } from "lucide-react";
import AdminLayout from "@/components/admin-layout";
import GenerationQuotaUsage, { usePlanGenerationQuota } from "@/components/admin/GenerationQuotaUsage";
import { apiRequest } from "@/lib/queryClient";
import { Link } from "wouter";

interface CreditStats {
  totalCreditsIssued: number;
  totalCreditsUsed: number;
  activeCustomers: number;
}

export default function AdminCredits() {
  const { data: planData } = usePlanGenerationQuota();
  const quota = planData?.generationQuota;

  const { data: stats, isLoading } = useQuery<CreditStats>({
    queryKey: ["/api/admin/credit-stats"],
    queryFn: async () => {
      const response = await fetch("/api/admin/credit-stats", { credentials: "include" });
      if (!response.ok) {
        return { totalCreditsIssued: 0, totalCreditsUsed: 0, activeCustomers: 0 };
      }
      return response.json();
    },
  });

  const { data: pagesData } = useQuery<{ pages: Array<{ id: string; status: string }> }>({
    queryKey: ["/api/appai/customizer-pages"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/appai/customizer-pages");
      if (!res.ok) return { pages: [] };
      return res.json();
    },
  });

  const livePageCount = useMemo(
    () => (pagesData?.pages ?? []).filter((p) => p.status === "active").length,
    [pagesData?.pages],
  );

  const remaining = quota?.unlimited
    ? null
    : Math.max(0, (quota?.limit ?? 0) - (quota?.used ?? 0));
  const avgGensPerPage =
    livePageCount > 0 && quota?.used != null ? quota.used / livePageCount : null;
  const estimatedCustomersServed =
    remaining != null && avgGensPerPage != null && avgGensPerPage > 0
      ? Math.floor(remaining / Math.max(1, Math.round(avgGensPerPage)))
      : null;

  const planLabel = planData?.planName
    ? planData.planName.replace("_", " ")
    : "—";

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-credits-title">Credits</h1>
          <p className="text-muted-foreground">
            Shop plan quota and end-customer credit usage
          </p>
        </div>

        <GenerationQuotaUsage />

        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Shop plan quota</CardTitle>
              <CreditCard className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="text-monthly-limit">
                {quota?.unlimited
                  ? `${quota.used} used`
                  : `${quota?.used ?? 0} / ${quota?.limit ?? "—"}`}
              </div>
              <p className="text-xs text-muted-foreground">
                {quota?.plan === "trial"
                  ? "Trial generations (lifetime total for your shop)"
                  : "AI generations this billing period (your shop)"}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Current plan</CardTitle>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold capitalize" data-testid="text-subscription-tier">
                {planLabel}
              </div>
              <p className="text-xs text-muted-foreground">
                {planData?.planStatus === "trialing" ? "Trial active" : "Subscription status"}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Active Customers</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                <div className="text-2xl font-bold" data-testid="text-active-customers">
                  {stats?.activeCustomers || 0}
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Customers with credit balances
              </p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <div>
              <CardTitle className="text-base">AI usage capacity</CardTitle>
              <CardDescription>
                Rough capacity from live customizer pages and gens used this period.{" "}
                <Link href="/admin/insights" className="underline underline-offset-2">
                  Profit Insights
                </Link>
              </CardDescription>
            </div>
            <LayoutTemplate className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3 text-sm">
            <div>
              <p className="text-muted-foreground">Live customizer pages</p>
              <p className="text-xl font-semibold">{livePageCount}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Avg gens / live page</p>
              <p className="text-xl font-semibold">
                {avgGensPerPage != null ? avgGensPerPage.toFixed(1) : "—"}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Est. remaining capacity (pages)</p>
              <p className="text-xl font-semibold">
                {estimatedCustomersServed != null ? estimatedCustomersServed : "—"}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Remaining gens ÷ avg gens per live page
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Customer credits</CardTitle>
            <CardDescription>
              End-customer packs (10 free generations per customer, then paid credits) are separate from your shop plan quota above.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <div>
              <p className="text-sm text-muted-foreground">Total credits issued</p>
              <p className="text-xl font-semibold">{stats?.totalCreditsIssued ?? 0}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Total credits used</p>
              <p className="text-xl font-semibold">{stats?.totalCreditsUsed ?? 0}</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}
