import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { BarChart3, CheckCircle, AlertCircle, TrendingUp, ArrowRight, CheckCircle2, Sparkles } from "lucide-react";
import AdminLayout from "@/components/admin-layout";
import GenerationQuotaUsage from "@/components/admin/GenerationQuotaUsage";
import { useSetupStatus, type SetupNextStep } from "@/hooks/use-setup-status";

interface GenerationStats {
  total: number;
  successful: number;
  failed: number;
}

const SETUP_STEP_LABELS: Partial<Record<SetupNextStep, string>> = {
  enable_embed: "Enable the App Embed",
  connect_printify: "Connect Printify to fulfil orders",
};
const SETUP_STEP_NUMBERS: Partial<Record<SetupNextStep, number>> = {
  enable_embed: 2,
  connect_printify: 3,
};

/** Dashboard's setup-rail pointer — mirrors /admin/setup's live status instead of a static list of steps. */
function SetupStatusCard() {
  const { data: status } = useSetupStatus();
  if (!status) return null;

  if (status.nextStep === "done") {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-green-600" />
            <CardTitle>Setup complete</CardTitle>
          </div>
          <CardDescription>
            Printify is connected. Open Products to Preview in-app or Create a Live page.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline" size="sm" data-testid="button-setup-add-product">
            <Link href="/admin/products">
              Open Products
              <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
            </Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <CardTitle>Finish setting up</CardTitle>
        </div>
        <CardDescription>
          Step {SETUP_STEP_NUMBERS[status.nextStep]} of 3 — {SETUP_STEP_LABELS[status.nextStep]}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button asChild data-testid="button-continue-setup">
          <Link href="/admin/setup">
            Continue setup
            <ArrowRight className="h-4 w-4 ml-2" />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

export default function AdminDashboard() {
  const { data: stats, isLoading } = useQuery<GenerationStats>({
    queryKey: ["/api/admin/stats"],
  });

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-dashboard-title">Dashboard</h1>
          <p className="text-muted-foreground">Overview of your AI Art Studio performance</p>
        </div>

        <GenerationQuotaUsage />

        <p className="text-xs text-muted-foreground -mt-2">
          Plan quota is your shop&apos;s AI generation allowance. Analytics below count logged generations from the last 30 days.
        </p>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Generations</CardTitle>
              <BarChart3 className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-8 w-20" />
              ) : (
                <div className="text-2xl font-bold" data-testid="text-total-generations">
                  {stats?.total || 0}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Successful</CardTitle>
              <CheckCircle className="h-4 w-4 text-green-500" />
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-8 w-20" />
              ) : (
                <div className="text-2xl font-bold text-green-600" data-testid="text-successful-generations">
                  {stats?.successful || 0}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Failed</CardTitle>
              <AlertCircle className="h-4 w-4 text-red-500" />
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-8 w-20" />
              ) : (
                <div className="text-2xl font-bold text-red-600" data-testid="text-failed-generations">
                  {stats?.failed || 0}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Success Rate</CardTitle>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-8 w-20" />
              ) : (
                <div className="text-2xl font-bold" data-testid="text-success-rate">
                  {stats?.total ? Math.round((stats.successful / stats.total) * 100) : 0}%
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <SetupStatusCard />
      </div>
    </AdminLayout>
  );
}
