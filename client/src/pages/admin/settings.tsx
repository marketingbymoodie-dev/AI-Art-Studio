import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest, apiFetch } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Save, CheckCircle, AlertCircle, Loader2, Store, RefreshCw, ExternalLink, Link2, Sparkles, Copy, Scale } from "lucide-react";
import { DEFAULT_TERMS_CONTENT, type TermsContent } from "@shared/termsContent";
import AdminLayout from "@/components/admin-layout";
import BrandingSettingsComponent from "@/components/admin/branding-settings";
import type { Merchant } from "@shared/schema";
import {
  STOREFRONT_FREE_GENERATION_DEFAULT,
  STOREFRONT_FREE_GENERATION_MAX,
  STOREFRONT_FREE_GENERATION_MIN,
} from "@shared/storefront-credits";
import { StudioNewsletterSignup } from "@/components/studio-newsletter-signup";

interface ShopifyInstallation {
  id: number;
  shopDomain: string;
  status: string;
  scope: string | null;
}

type StorefrontSettings = {
  storefrontFreeGensPerVisitor: number;
  min: number;
  max: number;
  default: number;
  shopDomain: string | null;
};

export default function AdminSettings() {
  const { toast } = useToast();
  
  const [printifyToken, setPrintifyToken] = useState("");
  const [printifyShopId, setPrintifyShopId] = useState("");
  const [detectShopLoading, setDetectShopLoading] = useState(false);
  const [shopDetectResult, setShopDetectResult] = useState<{ message: string; error?: boolean; shops?: { id: string; title: string; recommended?: boolean }[]; instructions?: string[] } | null>(null);
  const [freeGensPerVisitor, setFreeGensPerVisitor] = useState(String(STOREFRONT_FREE_GENERATION_DEFAULT));

  const { data: merchant, isLoading: merchantLoading } = useQuery<Merchant>({
    queryKey: ["/api/merchant"],
  });

  const { data: shopifyInstallations, isLoading: installationsLoading } = useQuery<
    { installations: ShopifyInstallation[] },
    Error,
    ShopifyInstallation[]
  >({
    queryKey: ["/api/shopify/installations"],
    select: (data) => data.installations,
  });

  const { data: storefrontSettings } = useQuery<StorefrontSettings>({
    queryKey: ["/api/admin/storefront-settings"],
  });

  const { data: termsData } = useQuery<{ content: TermsContent }>({
    queryKey: ["/api/terms"],
    staleTime: 60_000,
  });
  const termsContent = termsData?.content ?? DEFAULT_TERMS_CONTENT;

  type RewardRung = {
    id: number;
    shop: string;
    rungKey: "free_anonymous" | "email_signup" | "share_design" | "purchase_threshold";
    enabled: boolean;
    creditAmount: number;
    thresholdCents: number | null;
    sortOrder: number;
  };
  type RewardLadderResponse = {
    shopDomain: string;
    purchaseRewardsEnabled: boolean;
    rungs: RewardRung[];
  };

  const { data: rewardLadder } = useQuery<RewardLadderResponse>({
    queryKey: ["/api/admin/reward-ladder"],
    staleTime: 0,
    refetchOnMount: "always",
  });

  type RewardRungDraft = { creditAmount: string; thresholdDollars: string };
  const [rewardDrafts, setRewardDrafts] = useState<Record<string, RewardRungDraft>>({});

  const draftFromRung = (rung: RewardRung): RewardRungDraft => ({
    creditAmount: String(rung.creditAmount ?? 0),
    thresholdDollars:
      rung.thresholdCents != null && rung.thresholdCents > 0
        ? String(Math.round(rung.thresholdCents) / 100)
        : "50",
  });

  useEffect(() => {
    if (!rewardLadder?.rungs?.length) return;
    const next: Record<string, RewardRungDraft> = {};
    for (const rung of rewardLadder.rungs) {
      next[rung.rungKey] = draftFromRung(rung);
    }
    setRewardDrafts(next);
  }, [rewardLadder]);

  type RewardRungPatch = {
    rungKey: RewardRung["rungKey"];
    enabled?: boolean;
    creditAmount?: number;
    thresholdCents?: number | null;
  };

  const updateRewardLadderMutation = useMutation({
    mutationFn: async (rung: RewardRungPatch) => {
      const res = await apiRequest("PATCH", "/api/admin/reward-ladder", {
        rungs: [rung],
      });
      return res.json() as Promise<RewardLadderResponse>;
    },
    onSuccess: (data, variables) => {
      queryClient.setQueryData(["/api/admin/reward-ladder"], data);
      if (data?.rungs?.length) {
        setRewardDrafts((prev) => {
          const next = { ...prev };
          for (const rung of data.rungs) {
            next[rung.rungKey] = draftFromRung(rung);
          }
          return next;
        });
      }
      void queryClient.invalidateQueries({ queryKey: ["/api/admin/reward-ladder"] });
      if (variables.creditAmount !== undefined || variables.thresholdCents !== undefined) {
        const saved = data?.rungs?.find((r) => r.rungKey === variables.rungKey);
        const credits = saved?.creditAmount ?? variables.creditAmount;
        toast({
          title: "Saved",
          description:
            credits != null
              ? `Reward Ladder updated — ${credits} credit${credits === 1 ? "" : "s"}.`
              : "Reward Ladder updated.",
        });
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const patchFromDraft = (
    rung: RewardRung,
    extra?: Partial<RewardRungPatch>,
  ): RewardRungPatch | null => {
    const draft = rewardDrafts[rung.rungKey] ?? draftFromRung(rung);
    const creditAmount = Math.max(0, Math.min(50, Math.floor(Number(draft.creditAmount) || 0)));
    const patch: RewardRungPatch = { rungKey: rung.rungKey, creditAmount, ...extra };
    if (rung.rungKey === "purchase_threshold") {
      const dollars = Number(draft.thresholdDollars);
      if (!Number.isFinite(dollars) || dollars < 1) {
        toast({
          title: "Invalid threshold",
          description: "Purchase threshold must be at least $1.",
          variant: "destructive",
        });
        return null;
      }
      patch.thresholdCents = Math.round(dollars * 100);
    }
    return patch;
  };

  const saveRewardRungAmounts = (rung: RewardRung) => {
    const patch = patchFromDraft(rung);
    if (patch) updateRewardLadderMutation.mutate(patch);
  };

  const handleReconnectStore = async (shopDomain: string) => {
    try {
      // Fetch a signed reinstall URL from the server so the key is never exposed in client code
      const res = await fetch(`/shopify/reinstall-url?shop=${encodeURIComponent(shopDomain)}`);
      const data = await res.json();
      if (data.url) {
        window.open(`${window.location.origin}${data.url}`, '_blank');
      }
    } catch {
      window.open(`${window.location.origin}/shopify/install?shop=${encodeURIComponent(shopDomain)}`, '_blank');
    }
  };

  const updateMerchantMutation = useMutation({
    mutationFn: async (updates: Partial<Merchant>) => {
      const res = await apiRequest("PUT", "/api/merchant", updates);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/merchant"] });
      toast({
        title: "Settings saved",
        description: "Your integration settings have been updated.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  useEffect(() => {
    if (merchant) {
      setPrintifyToken(merchant.printifyApiToken || "");
      setPrintifyShopId(merchant.printifyShopId || "");
    }
  }, [merchant]);

  useEffect(() => {
    if (storefrontSettings?.storefrontFreeGensPerVisitor != null) {
      setFreeGensPerVisitor(String(storefrontSettings.storefrontFreeGensPerVisitor));
    }
  }, [storefrontSettings]);

  const updateStorefrontSettingsMutation = useMutation({
    mutationFn: async (body: {
      storefrontFreeGensPerVisitor: number;
    }) => {
      const res = await apiRequest("PATCH", "/api/admin/storefront-settings", body);
      return res.json() as Promise<StorefrontSettings>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/storefront-settings"] });
      setFreeGensPerVisitor(String(data.storefrontFreeGensPerVisitor));
      toast({
        title: "Storefront settings saved",
        description: `Visitors get ${data.storefrontFreeGensPerVisitor} free generation${data.storefrontFreeGensPerVisitor === 1 ? "" : "s"}.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleSave = () => {
    updateMerchantMutation.mutate({
      printifyApiToken: printifyToken,
      printifyShopId: printifyShopId,
    });
  };

  const handleSaveStorefrontSettings = () => {
    const n = parseInt(freeGensPerVisitor, 10);
    if (!Number.isFinite(n)) {
      toast({
        title: "Invalid value",
        description: `Enter a number between ${STOREFRONT_FREE_GENERATION_MIN} and ${STOREFRONT_FREE_GENERATION_MAX}.`,
        variant: "destructive",
      });
      return;
    }
    updateStorefrontSettingsMutation.mutate({
      storefrontFreeGensPerVisitor: n,
    });
  };

  const handleDetectShop = async () => {
    if (!printifyToken.trim()) {
      toast({
        title: "Token required",
        description: "Please enter your Printify API token first.",
        variant: "destructive",
      });
      return;
    }

    setDetectShopLoading(true);
    setShopDetectResult(null);
    try {
      const res = await apiFetch("/api/admin/printify/detect-shop", {
        method: "POST",
        body: JSON.stringify({ token: printifyToken }),
      });
      const data = await res.json();

      if (!res.ok) {
        setShopDetectResult({
          message: data.error || data.message || "Failed to detect shop",
          error: true,
          instructions: data.instructions,
        });
        return;
      }

      if (data.shops?.length === 1) {
        setPrintifyShopId(String(data.shops[0].id));
        toast({
          title: "Shop detected!",
          description: `Found "${data.shops[0].title}". Click Save Settings at the top to store it.`,
        });
        setShopDetectResult(null);
      } else if (data.shops?.length > 1) {
        const recommended = data.shops.find((s: { recommended?: boolean }) => s.recommended);
        if (recommended) {
          setPrintifyShopId(String(recommended.id));
          toast({
            title: "Shopify store selected",
            description: `Using recommended shop "${recommended.title}". Click Save Settings at the top.`,
          });
        }
        setShopDetectResult({
          message: data.message || `Found ${data.shops.length} shops. Select the one you want to use.`,
          shops: data.shops,
        });
      } else {
        setShopDetectResult({
          message: data.error || data.message || "No shops found",
          error: true,
          instructions: data.instructions,
          shops: data.shops,
        });
      }
    } catch {
      setShopDetectResult({
        message: "Failed to connect to Printify. Please check your connection and try again.",
        error: true,
      });
    } finally {
      setDetectShopLoading(false);
    }
  };

  if (merchantLoading) {
    return (
      <AdminLayout title="Settings">
        <div className="space-y-6">
          <Skeleton className="h-[200px] w-full" />
          <Skeleton className="h-[200px] w-full" />
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout title="Settings">
      <div className="sticky top-0 z-10 -mt-2 mb-6 flex flex-wrap items-center justify-between gap-3 border-b bg-background/95 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <p className="text-sm text-muted-foreground">
          Connect Printify, AI, and Shopify. Save after updating token or shop ID.
        </p>
        <Button
          size="lg"
          className="gap-2 shrink-0"
          onClick={handleSave}
          disabled={updateMerchantMutation.isPending}
        >
          {updateMerchantMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          Save Settings
        </Button>
      </div>
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Store className="h-5 w-5" />
              Printify Integration
            </CardTitle>
            <CardDescription>
              Connect to Printify for print-on-demand fulfillment
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="printify-token">PRINTIFY API TOKEN</Label>
              <Input
                id="printify-token"
                type="password"
                placeholder="Enter your Printify API token"
                value={printifyToken}
                onChange={(e) => setPrintifyToken(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Get your API token from Printify Dashboard &gt; Settings &gt; API
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="printify-shop">SHOP ID</Label>
              <div className="flex gap-2">
                <Input
                  id="printify-shop"
                  placeholder="Shop ID (auto-detected)"
                  value={printifyShopId}
                  onChange={(e) => setPrintifyShopId(e.target.value)}
                />
                <Button 
                  variant="outline" 
                  onClick={handleDetectShop}
                  disabled={detectShopLoading}
                >
                  {detectShopLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Detect"}
                </Button>
              </div>
              {shopDetectResult && (
                <div className={`text-sm p-3 rounded-md ${shopDetectResult.error ? "bg-destructive/10 text-destructive" : "bg-muted"}`}>
                  <p>{shopDetectResult.message}</p>
                  {shopDetectResult.shops && shopDetectResult.shops.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {shopDetectResult.shops.map((shop) => (
                        <Button
                          key={shop.id}
                          variant={shop.recommended ? "default" : "secondary"}
                          size="sm"
                          onClick={() => {
                            setPrintifyShopId(String(shop.id));
                            setShopDetectResult(null);
                            toast({
                              title: "Shop ID set",
                              description: `Using "${shop.title}" (ID: ${shop.id}). Click Save Settings at the top.`,
                            });
                          }}
                          className="w-full justify-start"
                        >
                          {shop.title} (ID: {shop.id}){shop.recommended ? " — Shopify linked" : ""}
                        </Button>
                      ))}
                    </div>
                  )}
                  {shopDetectResult.instructions && (
                    <ul className="mt-2 text-xs space-y-1 list-none">
                      {shopDetectResult.instructions.map((step, i) => (
                        <li key={i}>{step}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5" />
              Storefront credits
            </CardTitle>
            <CardDescription>
              Free generations come off your monthly plan allotment (default{" "}
              {STOREFRONT_FREE_GENERATION_DEFAULT}, max {STOREFRONT_FREE_GENERATION_MAX}).
              Customers can buy generation packs on your store; you are billed wholesale and
              those credits do not burn this allotment.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2 max-w-xs">
              <Label htmlFor="free-gens-visitor">Free gens per visitor</Label>
              <Input
                id="free-gens-visitor"
                type="number"
                min={STOREFRONT_FREE_GENERATION_MIN}
                max={STOREFRONT_FREE_GENERATION_MAX}
                step={1}
                value={freeGensPerVisitor}
                onChange={(e) => setFreeGensPerVisitor(e.target.value)}
              />
            </div>

            <Button
              type="button"
              onClick={handleSaveStorefrontSettings}
              disabled={updateStorefrontSettingsMutation.isPending}
              className="gap-2"
            >
              {updateStorefrontSettingsMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              Save storefront credits
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5" />
              Reward Ladder
            </CardTitle>
            <CardDescription>
              Share-design and purchase rewards come off your shop plan quota when spent.
              Studio Art Class signup credits are issued by Studio, not your quota.
              {rewardLadder?.shopDomain ? (
                <span className="block mt-1">
                  Applies to {rewardLadder.shopDomain}. Creator shops share the checkout store’s ladder.
                </span>
              ) : null}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {rewardLadder?.rungs?.length ? (
              rewardLadder.rungs
                .filter((rung) => rung.rungKey !== "free_anonymous")
                .sort((a, b) => a.sortOrder - b.sortOrder)
                .map((rung) => {
                  const draft = rewardDrafts[rung.rungKey] ?? {
                    creditAmount: String(rung.creditAmount ?? 0),
                    thresholdDollars: "50",
                  };
                  const label = rung.rungKey === "email_signup"
                    ? "Studio Art Class signup"
                    : rung.rungKey === "share_design"
                      ? "Share a design"
                      : rung.rungKey === "purchase_threshold"
                        ? "Purchase threshold"
                        : rung.rungKey;
                  const description = rung.rungKey === "email_signup"
                    ? "Studio Credits when a visitor joins the Studio Art Class list (once per customer). Issued by Studio — does not burn your quota."
                    : rung.rungKey === "share_design"
                      ? "Studio Credits when someone else opens their shared design (once per customer). Comes off your monthly allotment when spent."
                      : rung.rungKey === "purchase_threshold"
                        ? rewardLadder.purchaseRewardsEnabled
                          ? "Studio Credits when a customer’s paid order clears this amount (once per customer). Comes off your monthly allotment when spent."
                          : "Temporarily disabled by the app operator."
                        : "";
                  const disabled =
                    rung.rungKey === "purchase_threshold" && !rewardLadder.purchaseRewardsEnabled;
                  const creditsDirty = Number(draft.creditAmount) !== rung.creditAmount;
                  const thresholdDirty =
                    rung.rungKey === "purchase_threshold" &&
                    Math.round(Number(draft.thresholdDollars) * 100) !== (rung.thresholdCents ?? 0);
                  const amountsDirty = creditsDirty || thresholdDirty;
                  return (
                    <div
                      key={rung.rungKey}
                      className="space-y-3 rounded-lg border p-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-0.5">
                          <Label className="text-sm font-medium">{label}</Label>
                          <p className="text-xs text-muted-foreground">{description}</p>
                        </div>
                        <Switch
                          checked={rung.enabled && !disabled}
                          disabled={disabled || updateRewardLadderMutation.isPending}
                          onCheckedChange={(checked) => {
                            const patch = patchFromDraft(rung, { enabled: checked });
                            if (patch) updateRewardLadderMutation.mutate(patch);
                          }}
                        />
                      </div>
                      <div className="flex flex-wrap items-end gap-3">
                        <div className="space-y-1">
                          <Label htmlFor={`reward-credits-${rung.rungKey}`} className="text-xs text-muted-foreground">
                            Credits
                          </Label>
                          <Input
                            id={`reward-credits-${rung.rungKey}`}
                            type="number"
                            min={0}
                            max={50}
                            step={1}
                            className="w-24"
                            value={draft.creditAmount}
                            disabled={disabled || updateRewardLadderMutation.isPending}
                            onChange={(e) =>
                              setRewardDrafts((prev) => ({
                                ...prev,
                                [rung.rungKey]: {
                                  ...draft,
                                  creditAmount: e.target.value,
                                },
                              }))
                            }
                            onBlur={() => {
                              if (Number(draft.creditAmount) !== rung.creditAmount) {
                                saveRewardRungAmounts(rung);
                              }
                            }}
                          />
                        </div>
                        {rung.rungKey === "purchase_threshold" && (
                          <div className="space-y-1">
                            <Label htmlFor={`reward-threshold-${rung.rungKey}`} className="text-xs text-muted-foreground">
                              Order total ($)
                            </Label>
                            <Input
                              id={`reward-threshold-${rung.rungKey}`}
                              type="number"
                              min={1}
                              max={1000}
                              step={1}
                              className="w-28"
                              value={draft.thresholdDollars}
                              disabled={disabled || updateRewardLadderMutation.isPending}
                              onChange={(e) =>
                                setRewardDrafts((prev) => ({
                                  ...prev,
                                  [rung.rungKey]: {
                                    ...draft,
                                    thresholdDollars: e.target.value,
                                  },
                                }))
                              }
                              onBlur={() => {
                                if (
                                  Math.round(Number(draft.thresholdDollars) * 100) !==
                                  (rung.thresholdCents ?? 0)
                                ) {
                                  saveRewardRungAmounts(rung);
                                }
                              }}
                            />
                          </div>
                        )}
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={disabled || !amountsDirty || updateRewardLadderMutation.isPending}
                          onClick={() => saveRewardRungAmounts(rung)}
                        >
                          {updateRewardLadderMutation.isPending ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <>
                              <Save className="h-3.5 w-3.5 mr-1" />
                              Save
                            </>
                          )}
                        </Button>
                      </div>
                    </div>
                  );
                })
            ) : (
              <Skeleton className="h-24 w-full" />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Studio Art Class list</CardTitle>
            <CardDescription>
              Join the Studio list for merchant updates. Signup credits for store customers
              are issued by Studio, not your shop quota.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <StudioNewsletterSignup
              source="merchant"
              shopDomain={storefrontSettings?.shopDomain || undefined}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Store className="h-5 w-5" />
              Shopify Integration
            </CardTitle>
            <CardDescription>
              The Shopify shop this app is installed on. The{" "}
              <span className="font-mono">.myshopify.com</span> handle is the store id —
              your custom domain (if any) is separate.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {installationsLoading ? (
              <Skeleton className="h-20 w-full" />
            ) : shopifyInstallations && shopifyInstallations.length > 0 ? (
              <div className="space-y-4">
                {shopifyInstallations.map((inst) => (
                  <div key={inst.id} className="flex items-center justify-between p-3 border rounded-lg">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-primary/10 rounded-full">
                        <Store className="h-4 w-4 text-primary" />
                      </div>
                      <div>
                        <p className="font-medium">{inst.shopDomain}</p>
                        <p className="text-xs text-muted-foreground capitalize">{inst.status}</p>
                      </div>
                    </div>
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button 
                        size="sm" 
                        variant="outline" 
                        className="gap-2"
                        onClick={() => handleReconnectStore(inst.shopDomain)}
                        title="Re-authorize the app if Shopify access was lost"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                        Reconnect store
                      </Button>
                      <Button size="sm" variant="ghost" asChild>
                        <a href={`https://${inst.shopDomain}/admin/apps/ai-art-studio`} target="_blank" rel="noreferrer">
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-6 border-2 border-dashed rounded-lg">
                <Link2 className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">No Shopify stores connected yet.</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Scale className="h-5 w-5" />
              AI Art Studio terms
            </CardTitle>
            <CardDescription>
              Customers using the customizer agree to the live Terms of Use. Paste the addendum
              below into your Shopify Terms of service if you want the same rules on your store
              policy page. Changing our terms later does not update text you already published
              there — we will tell you if you need to paste a new version.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" asChild>
                <a href="/terms" target="_blank" rel="noreferrer">
                  <ExternalLink className="mr-2 h-3.5 w-3.5" />
                  View live terms
                </a>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(termsContent.merchantStoreAddendum);
                    toast({
                      title: "Copied",
                      description: "Paste into Shopify → Settings → Policies → Terms of service.",
                    });
                  } catch {
                    toast({
                      title: "Copy failed",
                      description: "Select the addendum text and copy it manually.",
                      variant: "destructive",
                    });
                  }
                }}
              >
                <Copy className="mr-2 h-3.5 w-3.5" />
                Copy store addendum
              </Button>
            </div>
            <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
              {termsContent.merchantStoreAddendum}
            </pre>
          </CardContent>
        </Card>

        <BrandingSettingsComponent />
      </div>
    </AdminLayout>
  );
}
