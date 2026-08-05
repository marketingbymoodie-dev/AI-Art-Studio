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
  CREDIT_PACK_CATALOG,
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

type CreditPackOption = {
  id: string;
  credits: number;
  priceUsd: number;
  entitlementUsd: number;
  label: string;
};

type StorefrontSettings = {
  storefrontFreeGensPerVisitor: number;
  min: number;
  max: number;
  default: number;
  shopDomain: string | null;
  creditReimbursementMode?: "appai_discount" | "merchant_handles";
  enabledCreditPackIds?: string[];
  availableCreditPacks?: CreditPackOption[];
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
  const [reimbursementMode, setReimbursementMode] = useState<"appai_discount" | "merchant_handles">(
    "appai_discount",
  );
  const [enabledPackIds, setEnabledPackIds] = useState<string[]>(["5"]);

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
    if (storefrontSettings?.creditReimbursementMode) {
      setReimbursementMode(storefrontSettings.creditReimbursementMode);
    }
    if (storefrontSettings?.enabledCreditPackIds?.length) {
      setEnabledPackIds(storefrontSettings.enabledCreditPackIds);
    }
  }, [storefrontSettings]);

  const updateStorefrontSettingsMutation = useMutation({
    mutationFn: async (body: {
      storefrontFreeGensPerVisitor: number;
      creditReimbursementMode: "appai_discount" | "merchant_handles";
      enabledCreditPackIds: string[];
    }) => {
      const res = await apiRequest("PATCH", "/api/admin/storefront-settings", body);
      return res.json() as Promise<StorefrontSettings>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/storefront-settings"] });
      setFreeGensPerVisitor(String(data.storefrontFreeGensPerVisitor));
      if (data.creditReimbursementMode) setReimbursementMode(data.creditReimbursementMode);
      if (data.enabledCreditPackIds) setEnabledPackIds(data.enabledCreditPackIds);
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
    if (enabledPackIds.length === 0) {
      toast({
        title: "Select a pack",
        description: "Enable at least one generation pack for customers.",
        variant: "destructive",
      });
      return;
    }
    updateStorefrontSettingsMutation.mutate({
      storefrontFreeGensPerVisitor: n,
      creditReimbursementMode: reimbursementMode,
      enabledCreditPackIds: enabledPackIds,
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
              Paid packs are sold via Stripe; you choose which packs to offer and who
              reimburses pack buyers on a physical order.
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

            <div className="space-y-2">
              <Label>Generation packs offered to customers</Label>
              <div className="space-y-2">
                {(storefrontSettings?.availableCreditPacks?.length
                  ? storefrontSettings.availableCreditPacks
                  : CREDIT_PACK_CATALOG.map((p) => ({
                      id: p.packId,
                      credits: p.credits,
                      priceUsd: p.priceInCents / 100,
                      entitlementUsd: p.entitlementCents / 100,
                      label: p.label,
                    }))
                ).map((pack) => {
                  const checked = enabledPackIds.includes(pack.id);
                  return (
                    <label
                      key={pack.id}
                      className="flex items-center gap-3 rounded-md border px-3 py-2 text-sm cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          setEnabledPackIds((prev) =>
                            checked
                              ? prev.filter((id) => id !== pack.id)
                              : [...prev, pack.id],
                          );
                        }}
                      />
                      <span className="font-medium">{pack.label}</span>
                      <span className="text-muted-foreground">
                        {reimbursementMode === "appai_discount"
                          ? `· up to $${pack.entitlementUsd} off product order`
                          : "· no automatic checkout discount"}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2">
              <Label>Pack reimbursement</Label>
              <div className="space-y-2 text-sm">
                <label className="flex items-start gap-3 rounded-md border px-3 py-2 cursor-pointer">
                  <input
                    type="radio"
                    name="reimbursement"
                    className="mt-1"
                    checked={reimbursementMode === "appai_discount"}
                    onChange={() => setReimbursementMode("appai_discount")}
                  />
                  <span>
                    <span className="font-medium">AI Art Studio checkout discount</span>
                    <span className="block text-muted-foreground text-xs mt-0.5">
                      Pack buyers get up to $1–$3 off a physical product order automatically.
                    </span>
                  </span>
                </label>
                <label className="flex items-start gap-3 rounded-md border px-3 py-2 cursor-pointer">
                  <input
                    type="radio"
                    name="reimbursement"
                    className="mt-1"
                    checked={reimbursementMode === "merchant_handles"}
                    onChange={() => setReimbursementMode("merchant_handles")}
                  />
                  <span>
                    <span className="font-medium">I&apos;ll handle reimbursement myself</span>
                    <span className="block text-muted-foreground text-xs mt-0.5">
                      No automatic entitlement — run your own store discount or promo if you want.
                    </span>
                  </span>
                </label>
              </div>
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
