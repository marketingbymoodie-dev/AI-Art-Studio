import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { queryClient, apiRequest, parseApiErrorMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useSetupStatus, type MerchantSetupStatus } from "@/hooks/use-setup-status";
import { getShopifyParams } from "@/lib/shopify";
import AdminLayout from "@/components/admin-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  Info,
  Loader2,
  Package,
  Sparkles,
  Store,
} from "lucide-react";

interface ShopifyInstallationLite {
  id: number;
  shopDomain: string;
  status: string;
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

  const { data: installationsData } = useQuery<
    { installations: ShopifyInstallationLite[] },
    Error,
    ShopifyInstallationLite[]
  >({
    queryKey: ["/api/shopify/installations"],
    select: (data) => data.installations,
  });
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

  const confirmEmbedMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/appai/setup/confirm-embed");
      return res.json() as Promise<{ success?: boolean; error?: string }>;
    },
    onSuccess: () => {
      queryClient.setQueryData(["/api/appai/setup/status"], (prev: MerchantSetupStatus | undefined) =>
        prev
          ? {
              ...prev,
              embedEnabledGuess: true,
              nextStep: prev.printifyConnected ? "done" : "connect_printify",
            }
          : prev,
      );
      queryClient.invalidateQueries({ queryKey: ["/api/appai/setup/status"] });
      toast({ title: "Got it!", description: "App Embed marked as enabled." });
    },
    onError: (err: Error) => {
      toast({
        title: "Couldn't save that yet",
        description:
          parseApiErrorMessage(err) ||
          "Try reopening the app from Shopify Admin, then click again.",
        variant: "destructive",
      });
    },
  });

  const embedDone = !!status?.embedEnabledGuess;
  const printifyDone = !!status?.printifyConnected;
  const setupComplete = embedDone && printifyDone;

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
            A few quick steps, then open Products Catalogue to Preview or Create a Live page.
          </p>
        </div>

        {status && status.shopAuthorized === false && status.reconnectUrl && (
          <Card className="border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800">
            <CardContent className="pt-4 flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="flex-1 space-y-1">
                <p className="text-sm font-medium">Finish connecting this shop</p>
                <p className="text-sm text-muted-foreground">
                  Shopify opened the app, but we still need one approval step to save an Admin API
                  token (needed for Preview and Create Page). This is different from uninstalling.
                </p>
              </div>
              <Button asChild data-testid="button-reconnect-shopify">
                <a href={status.reconnectUrl} target="_top" rel="noopener noreferrer">
                  <ExternalLink className="h-4 w-4 mr-2" />
                  Connect Shopify
                </a>
              </Button>
            </CardContent>
          </Card>
        )}

        <StepShell number={1} title="Install the app" done={status?.shopAuthorized !== false}>
          {status?.shopAuthorized === false ? (
            <p className="text-sm text-muted-foreground">
              Almost done — click <strong>Connect Shopify</strong> above, approve permissions, then
              continue.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Done — you&apos;ve installed AI Art Studio and approved the required permissions.
            </p>
          )}
        </StepShell>

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
                I&apos;ve enabled it
              </Button>
            )}
          </div>
          {!embedDone && (
            <p className="text-xs text-muted-foreground mt-2">
              In the theme editor: App Embeds (left sidebar) → toggle on &quot;AI Art Studio Embed&quot; → Save.
            </p>
          )}
        </StepShell>

        <StepShell number={3} title="Connect Printify to go Live" done={printifyDone} locked={!embedDone}>
          {!embedDone ? (
            <p className="text-sm text-muted-foreground">Enable the App Embed above to unlock this step.</p>
          ) : printifyDone ? (
            <p className="text-sm text-muted-foreground">
              Printify is connected. When you Create Page, you&apos;ll choose a print supplier and apply
              suggested retail prices before going Live.
            </p>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Connect your Printify API token and Shop ID in Settings. You can still Preview products
                in-app without Printify; Live pages need it for supplier and pricing.
              </p>
              <Button asChild data-testid="button-connect-printify">
                <a href="/admin/settings">
                  <Store className="h-4 w-4 mr-2" />
                  Open Settings
                </a>
              </Button>
            </div>
          )}
        </StepShell>

        {setupComplete && (
          <Card className="border-primary/30 bg-primary/5">
            <CardContent className="pt-4 flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="flex-1 space-y-1">
                <p className="text-sm font-medium flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                  Setup complete — next: Products Catalogue
                </p>
                <p className="text-sm text-muted-foreground">
                  Preview products in Preview Studio (in-app), or Create Page to pick a Printify supplier,
                  set suggested prices, and go Live. Provider, pricing, variants, and Art Styles are
                  configured on the Customizer Page.
                </p>
              </div>
              <Button asChild data-testid="button-setup-open-catalogue">
                <Link href="/admin/products">
                  <Package className="h-4 w-4 mr-2" />
                  Open Products Catalogue
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Link>
              </Button>
            </CardContent>
          </Card>
        )}

        {statusLoading && (
          <p className="text-xs text-muted-foreground">Loading your setup status…</p>
        )}
      </div>
    </AdminLayout>
  );
}
