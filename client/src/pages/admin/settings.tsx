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
import { Save, CheckCircle, AlertCircle, Loader2, Store, RefreshCw, ExternalLink, FileCode, Link2, Sparkles } from "lucide-react";
import AdminLayout from "@/components/admin-layout";
import BrandingSettingsComponent from "@/components/admin/branding-settings";
import type { Merchant } from "@shared/schema";
import {
  STOREFRONT_FREE_GENERATION_DEFAULT,
  STOREFRONT_FREE_GENERATION_MAX,
  STOREFRONT_FREE_GENERATION_MIN,
} from "@shared/storefront-credits";

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
  const [useBuiltIn, setUseBuiltIn] = useState(true);
  const [customToken, setCustomToken] = useState("");
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
  });

  type RewardRungDraft = { creditAmount: string; thresholdDollars: string };
  const [rewardDrafts, setRewardDrafts] = useState<Record<string, RewardRungDraft>>({});

  useEffect(() => {
    if (!rewardLadder?.rungs?.length) return;
    const next: Record<string, RewardRungDraft> = {};
    for (const rung of rewardLadder.rungs) {
      next[rung.rungKey] = {
        creditAmount: String(rung.creditAmount ?? 0),
        thresholdDollars:
          rung.thresholdCents != null && rung.thresholdCents > 0
            ? String(Math.round(rung.thresholdCents) / 100)
            : "50",
      };
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
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/reward-ladder"] });
      if (variables.creditAmount !== undefined || variables.thresholdCents !== undefined) {
        toast({ title: "Saved", description: "Reward Ladder updated." });
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

  const saveRewardRungAmounts = (rung: RewardRung) => {
    const draft = rewardDrafts[rung.rungKey];
    if (!draft) return;
    const creditAmount = Math.max(0, Math.min(50, Math.floor(Number(draft.creditAmount) || 0)));
    const patch: RewardRungPatch = { rungKey: rung.rungKey, creditAmount };
    if (rung.rungKey === "purchase_threshold") {
      const dollars = Number(draft.thresholdDollars);
      if (!Number.isFinite(dollars) || dollars < 1) {
        toast({
          title: "Invalid threshold",
          description: "Purchase threshold must be at least $1.",
          variant: "destructive",
        });
        return;
      }
      patch.thresholdCents = Math.round(dollars * 100);
    }
    updateRewardLadderMutation.mutate(patch);
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

  const handleSyncUrls = async () => {
    try {
      const res = await apiRequest("POST", "/api/shopify/sync-urls");
      const data = await res.json();
      toast({
        title: "Success",
        description: data.message || "App URLs synced with Shopify successfully",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to sync app URLs with Shopify",
        variant: "destructive",
      });
    }
  };

  const handleRegisterScript = async () => {
    try {
      const res = await apiRequest("POST", "/api/shopify/register-script");
      const data = await res.json();
      toast({
        title: "Success",
        description: data.message || "Script tag registered successfully",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to register script tag",
        variant: "destructive",
      });
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
      setUseBuiltIn(merchant.useBuiltInNanoBanana ?? true);
      setCustomToken(merchant.customNanoBananaToken || "");
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
      useBuiltInNanoBanana: useBuiltIn,
      customNanoBananaToken: customToken,
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
              Credits for email signup and share-design are a one-time reward per customer.
              When spent, they count against your shop plan quota.
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
                    ? "Email sign-up"
                    : rung.rungKey === "share_design"
                      ? "Share a design"
                      : rung.rungKey === "purchase_threshold"
                        ? "Purchase threshold"
                        : rung.rungKey;
                  const description = rung.rungKey === "email_signup"
                    ? "Studio Credits when a visitor signs in with Google or email OTP (once per customer)."
                    : rung.rungKey === "share_design"
                      ? "Studio Credits when someone else opens their shared design (once per customer)."
                      : rung.rungKey === "purchase_threshold"
                        ? rewardLadder.purchaseRewardsEnabled
                          ? "Studio Credits when a customer’s paid order clears this amount (once per customer)."
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
                          onCheckedChange={(checked) =>
                            updateRewardLadderMutation.mutate({
                              rungKey: rung.rungKey,
                              enabled: checked,
                            })
                          }
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
            <CardTitle className="flex items-center gap-2">
              <FileCode className="h-5 w-5" />
              AI Integration
            </CardTitle>
            <CardDescription>
              Configure AI image generation settings
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="use-builtin">USE BUILT-IN AI</Label>
                <p className="text-xs text-muted-foreground">
                  Use the default AI provider (recommended)
                </p>
              </div>
              <Switch
                id="use-builtin"
                checked={useBuiltIn}
                onCheckedChange={setUseBuiltIn}
              />
            </div>

            {!useBuiltIn && (
              <div className="space-y-2 pt-2">
                <Label htmlFor="custom-token">CUSTOM API TOKEN</Label>
                <Input
                  id="custom-token"
                  type="password"
                  placeholder="Enter your custom API token"
                  value={customToken}
                  onChange={(e) => setCustomToken(e.target.value)}
                />
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Store className="h-5 w-5" />
              Shopify Integration
            </CardTitle>
            <CardDescription>
              Manage your connected Shopify stores
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
                    <div className="flex gap-2">
                      <Button 
                        size="sm" 
                        variant="outline" 
                        className="gap-2"
                        onClick={handleSyncUrls}
                        title="Update all AI Art Studio products to use the current app URL"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                        Sync URLs
                      </Button>
                      <Button 
                        size="sm" 
                        variant="outline" 
                        className="gap-2"
                        onClick={handleRegisterScript}
                      >
                        <FileCode className="h-3.5 w-3.5" />
                        Register Script
                      </Button>
                      <Button 
                        size="sm" 
                        variant="outline" 
                        className="gap-2"
                        onClick={() => handleReconnectStore(inst.shopDomain)}
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                        Reconnect
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

        <BrandingSettingsComponent />
      </div>
    </AdminLayout>
  );
}
