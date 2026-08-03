import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useSetupStatus, type MerchantSetupStatus } from "@/hooks/use-setup-status";
import { getShopifyParams } from "@/lib/shopify";
import AdminLayout from "@/components/admin-layout";
import ConfettiBurst from "@/components/admin/ConfettiBurst";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  CheckCircle2,
  Circle,
  ExternalLink,
  Info,
  Loader2,
  PartyPopper,
  Sparkles,
  Store,
} from "lucide-react";

interface CatalogEntry {
  blueprintId: number;
  label: string;
  brand: string | null;
  category: string | null;
  kind: "printify" | "flat" | "aop" | "blocked";
}

interface ShopifyInstallationLite {
  id: number;
  shopDomain: string;
  status: string;
}

interface ActivateResult {
  page: { id: number; handle: string; title: string };
  productTypeId: number;
  previewUrl: string;
  storefrontUrl: string;
}

function StepShell({
  number,
  title,
  done,
  locked,
  children,
}: {
  number: number;
  title: string;
  done: boolean;
  locked?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Card className={locked ? "opacity-60" : undefined}>
      <CardHeader>
        <div className="flex items-center gap-3">
          {done ? (
            <CheckCircle2 className="h-6 w-6 text-green-600 shrink-0" />
          ) : (
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center">
              {number}
            </span>
          )}
          <CardTitle className="text-lg">{title}</CardTitle>
        </div>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export default function AdminSetupPage() {
  const { toast } = useToast();
  const { data: status, isLoading: statusLoading } = useSetupStatus();
  const [activatedBlueprintId, setActivatedBlueprintId] = useState<number | null>(null);
  const [lastResult, setLastResult] = useState<ActivateResult | null>(null);

  const { data: installationsData } = useQuery<
    { installations: ShopifyInstallationLite[] },
    Error,
    ShopifyInstallationLite[]
  >({
    queryKey: ["/api/shopify/installations"],
    select: (data) => data.installations,
  });
  // Prefer DB install row; fall back to embedded Admin shop/host so
  // "Open Theme Editor" works on first visit before installations finish linking.
  const shopifyParams = getShopifyParams();
  const shopFromHost = (() => {
    if (!shopifyParams.host) return null;
    try {
      const decoded = atob(shopifyParams.host);
      const handle = decoded.match(/\/store\/([^/?]+)/)?.[1];
      return handle ? `${handle}.myshopify.com` : null;
    } catch {
      return null;
    }
  })();
  const shopDomain =
    installationsData?.[0]?.shopDomain ||
    shopifyParams.shop ||
    shopFromHost ||
    null;

  const { data: catalogData, isLoading: catalogLoading } = useQuery<{ entries: CatalogEntry[] }>({
    queryKey: ["/api/appai/setup/catalog"],
  });

  const confirmEmbedMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/appai/setup/confirm-embed");
      return res.json() as Promise<{ success?: boolean; error?: string }>;
    },
    onSuccess: () => {
      queryClient.setQueryData(["/api/appai/setup/status"], (prev: MerchantSetupStatus | undefined) =>
        prev
          ? { ...prev, embedEnabledGuess: true, nextStep: prev.pagesCount > 0 ? prev.nextStep : "choose_product" }
          : prev,
      );
      queryClient.invalidateQueries({ queryKey: ["/api/appai/setup/status"] });
      toast({ title: "Got it!", description: "App Embed marked as enabled." });
    },
    onError: (err: Error) => {
      toast({
        title: "Couldn't save that yet",
        description: err.message || "Try reopening the app from Shopify Admin, then click again.",
        variant: "destructive",
      });
    },
  });

  const activateMutation = useMutation({
    mutationFn: async (blueprintId: number) => {
      const res = await apiRequest("POST", "/api/appai/setup/activate-product", { blueprintId });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to activate this product.");
      }
      return res.json() as Promise<ActivateResult>;
    },
    onMutate: (blueprintId) => setActivatedBlueprintId(blueprintId),
    onSuccess: (data) => {
      setLastResult(data);
      queryClient.invalidateQueries({ queryKey: ["/api/appai/setup/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/appai/customizer-pages"] });
    },
    onError: (err: Error) => {
      setActivatedBlueprintId(null);
      toast({ title: "Couldn't activate that product", description: err.message, variant: "destructive" });
    },
  });

  const embedDone = !!status?.embedEnabledGuess;
  const hasPage = (status?.pagesCount ?? 0) > 0;
  const printifyDone = !!status?.printifyConnected;

  const normalizedShop = shopDomain
    ? shopDomain.includes(".")
      ? shopDomain
      : `${shopDomain}.myshopify.com`
    : null;
  const themeEditorUrl = normalizedShop
    ? `https://${normalizedShop}/admin/themes/current/editor?context=apps`
    : null;

  return (
    <AdminLayout>
      <div className="space-y-6 max-w-3xl">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Sparkles className="h-6 w-6 text-primary" />
            Get set up
          </h1>
          <p className="text-muted-foreground">
            A few quick steps and your AI product customizer will be ready to show customers.
          </p>
        </div>

        {/* Step 1 — Install & permissions (always complete by the time this page loads) */}
        <StepShell number={1} title="Install the app" done>
          <p className="text-sm text-muted-foreground">
            Done — you've installed AI Art Studio and approved the required permissions.
          </p>
        </StepShell>

        {/* Step 2 — Enable App Embed */}
        <StepShell number={2} title="Enable the App Embed" done={embedDone}>
          <div className="flex items-start gap-2 mb-3">
            <p className="text-sm text-muted-foreground flex-1">
              This turns on the customizer widget on your storefront pages.
            </p>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5 cursor-help" data-testid="icon-embed-info" />
              </TooltipTrigger>
              <TooltipContent className="max-w-xs text-sm">
                Enabling app embeds is a Shopify safety requirement — only you, the store owner, can
                turn it on in the theme editor. We wish we could automate this step for you, but
                Shopify requires manual merchant approval here.
              </TooltipContent>
            </Tooltip>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant={embedDone ? "outline" : "default"}
              onClick={() => {
                if (themeEditorUrl) {
                  window.open(themeEditorUrl, "_blank");
                  return;
                }
                toast({
                  title: "Open Theme Editor from Shopify",
                  description:
                    "Go to Online Store → Themes → Customize → App embeds, then toggle on AI Art Studio Embed and Save.",
                });
              }}
              data-testid="button-open-theme-editor"
            >
              <ExternalLink className="h-4 w-4 mr-2" />
              {embedDone ? "Re-open Theme Editor" : "Open Theme Editor"}
            </Button>
            {!embedDone && (
              <Button
                variant="secondary"
                onClick={() => confirmEmbedMutation.mutate()}
                disabled={confirmEmbedMutation.isPending}
                data-testid="button-confirm-embed"
              >
                {confirmEmbedMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                I've enabled it
              </Button>
            )}
          </div>
          {!embedDone && (
            <p className="text-xs text-muted-foreground mt-2">
              In the theme editor: App Embeds (left sidebar) → toggle on "AI Art Studio Embed" → Save.
            </p>
          )}
        </StepShell>

        {/* Step 3 — Choose a product */}
        <StepShell number={3} title="Choose a Customizer Page product" done={hasPage} locked={!embedDone}>
          {!embedDone ? (
            <p className="text-sm text-muted-foreground">Enable the App Embed above to unlock this step.</p>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Pick a product from our ready-to-go catalog — it's activated instantly, no Printify
                account needed yet.
              </p>

              {lastResult && (
                <div className="relative rounded-md border border-green-200 bg-green-50 dark:bg-green-950/30 dark:border-green-900 p-4 overflow-hidden">
                  <ConfettiBurst />
                  <div className="flex items-center gap-2 mb-2">
                    <PartyPopper className="h-5 w-5 text-green-600" />
                    <p className="font-medium">"{lastResult.page.title}" is ready to preview!</p>
                  </div>
                  <Button
                    className="shimmer-btn"
                    onClick={() => window.open(lastResult.previewUrl, "_blank")}
                    data-testid="button-see-your-page"
                  >
                    <span className="relative z-10 flex items-center">
                      <ExternalLink className="h-4 w-4 mr-2" />
                      See your page
                    </span>
                  </Button>
                </div>
              )}

              {catalogLoading ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Skeleton className="h-24 w-full" />
                  <Skeleton className="h-24 w-full" />
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {(catalogData?.entries ?? []).map((entry) => {
                    const isActivating = activateMutation.isPending && activatedBlueprintId === entry.blueprintId;
                    const justActivated = lastResult && activatedBlueprintId === entry.blueprintId;
                    return (
                      <div
                        key={entry.blueprintId}
                        className="rounded-md border p-3 flex flex-col gap-2"
                        data-testid={`card-catalog-${entry.blueprintId}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="font-medium text-sm">{entry.label}</p>
                          <Badge variant="outline" className="shrink-0">{entry.kind}</Badge>
                        </div>
                        {(entry.brand || entry.category) && (
                          <p className="text-xs text-muted-foreground">
                            {[entry.brand, entry.category].filter(Boolean).join(" · ")}
                          </p>
                        )}
                        <Button
                          size="sm"
                          variant={justActivated ? "outline" : "default"}
                          disabled={isActivating}
                          onClick={() => activateMutation.mutate(entry.blueprintId)}
                          data-testid={`button-activate-${entry.blueprintId}`}
                        >
                          {isActivating && <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />}
                          {justActivated ? "Activated" : "Activate"}
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </StepShell>

        {/* Step 4 — Connect Printify */}
        <StepShell number={4} title="Connect Printify to fulfil orders" done={printifyDone} locked={!hasPage}>
          {!hasPage ? (
            <p className="text-sm text-muted-foreground">Activate a product above to unlock this step.</p>
          ) : printifyDone ? (
            <p className="text-sm text-muted-foreground">
              Printify is connected — your Customizer Page{(status?.pagesCount ?? 0) > 1 ? "s are" : " is"} now
              visible to customers.
            </p>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Your page{(status?.pagesCount ?? 0) > 1 ? "s are" : " is"} live in preview for you only — connect
                your Printify account so customers can check out and orders actually get fulfilled.
                We'll remind you daily until this is done, and won't spend AI generations on a page that
                can't yet be fulfilled.
              </p>
              <Button asChild data-testid="button-connect-printify">
                <a href="/admin/settings">
                  <Store className="h-4 w-4 mr-2" />
                  Connect Printify in Settings
                </a>
              </Button>
            </div>
          )}
        </StepShell>

        {statusLoading && (
          <p className="text-xs text-muted-foreground">Loading your setup status…</p>
        )}
      </div>
    </AdminLayout>
  );
}
