import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, parseApiErrorMessage, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Save, Loader2, Search, ExternalLink } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import AdminLayout from "@/components/admin-layout";
import {
  MY_PET_ART_STYLES,
  MY_PET_DEFAULT_RENDER_PARAMS,
  MY_PET_LOCKED_PRINT_RULES,
  MY_PET_SUNBURST_ESTIMATED_COST_USD,
  type MyPetArtStyle,
  type MyPetRenderParams,
  type MyPetSettings,
} from "@shared/myPetSettings";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type MyPetProductRow = {
  id: string;
  title: string;
  shopifyProductId: string | null;
  myPetEnabled: boolean;
  status: string;
};

function MyPetPerProduct() {
  const { toast } = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);
  const products = useQuery<{ products: MyPetProductRow[] }>({
    queryKey: ["/api/admin/my-pet-settings/products"],
  });
  const rows = products.data?.products || [];
  const key = ["/api/admin/my-pet-settings/products"];

  async function setEnabled(row: MyPetProductRow, enabled: boolean) {
    const previous = queryClient.getQueryData<{ products: MyPetProductRow[] }>(key);
    queryClient.setQueryData(key, {
      products: (previous?.products || rows).map((item) => item.id === row.id ? { ...item, myPetEnabled: enabled } : item),
    });
    setBusyId(row.id);
    try {
      const res = await apiRequest("PATCH", `/api/admin/my-pet-settings/products/${row.id}`, { enabled });
      await res.json();
    } catch (err) {
      if (previous) queryClient.setQueryData(key, previous);
      toast({
        title: "Could not update My Pet",
        description: parseApiErrorMessage(err),
        variant: "destructive",
      });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card data-testid="my-pet-per-product">
      <CardHeader>
        <CardTitle>My Pet per product</CardTitle>
        <CardDescription>
          On or off for each design on this store. The switch writes the product record and the Shopify metafield.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {products.isLoading ? <p className="text-sm text-muted-foreground">Loading products…</p> : null}
        {products.isError ? <p className="text-sm">Could not load design products.</p> : null}
        {!products.isLoading && !products.isError && rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No design products on this store.</p>
        ) : null}
        {rows.length ? (
          <ul className="divide-y">
            {rows.map((row) => (
              <li key={row.id} className="flex items-center justify-between gap-4 py-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{row.title}</p>
                  {!row.shopifyProductId ? (
                    <p className="text-xs text-muted-foreground">Not on Shopify yet</p>
                  ) : null}
                </div>
                <Switch
                  checked={row.myPetEnabled !== false}
                  disabled={busyId === row.id || !row.shopifyProductId}
                  aria-label={`My Pet for ${row.title}`}
                  data-testid={`my-pet-product-${row.id}`}
                  onCheckedChange={(enabled) => { void setEnabled(row, enabled); }}
                />
              </li>
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}

const STYLE_LABELS: Record<MyPetArtStyle, string> = {
  woodcut: "Woodcut",
  "folk-graphic": "Folk Graphic",
  "bold-type": "Bold Type",
  "pen-ink": "Pen & Ink",
  "vintage-engraving": "Vintage Engraving",
  "retro-character": "Retro Character",
};

export default function MyPetSettingsPage() {
  const { toast } = useToast();
  const { data, isLoading, isError } = useQuery<{ settings: MyPetSettings }>({
    queryKey: ["/api/admin/my-pet-settings"],
  });

  const [basePrompt, setBasePrompt] = useState("");
  const [styleTweaks, setStyleTweaks] = useState<Record<string, string>>({});
  const [capPerListing, setCapPerListing] = useState("2");
  const [capPerDay, setCapPerDay] = useState("20");
  const [capEmailBonus, setCapEmailBonus] = useState("2");
  const [renderParams, setRenderParams] = useState<MyPetRenderParams>({ ...MY_PET_DEFAULT_RENDER_PARAMS });

  useEffect(() => {
    if (!data?.settings) return;
    setBasePrompt(data.settings.basePrompt);
    setStyleTweaks(data.settings.styleTweaks || {});
    setCapPerListing(String(data.settings.caps.perListing));
    setCapPerDay(String(data.settings.caps.perDay));
    setCapEmailBonus(String(data.settings.caps.emailBonus));
    if (data.settings.renderParams) setRenderParams({ ...data.settings.renderParams });
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PUT", "/api/admin/my-pet-settings", {
        basePrompt,
        styleTweaks,
        caps: {
          perListing: Number(capPerListing) || 0,
          perDay: Number(capPerDay) || 0,
          emailBonus: Number(capEmailBonus) || 0,
        },
        renderParams,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Saved", description: "My Pet settings updated — takes effect immediately, no redeploy." });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/my-pet-settings"] });
    },
    onError: (err: Error) => {
      toast({ title: "Could not save", description: err.message, variant: "destructive" });
    },
  });

  if (isError) {
    return (
      <AdminLayout>
        <div className="p-6">
          <p className="text-muted-foreground">My Pet settings are not available for this store.</p>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="max-w-3xl mx-auto p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">My Pet Settings</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Operator-only. One base prompt for every design, plus optional per-style tweaks. Changes take effect
            immediately — no redeploy.
          </p>
        </div>

        <MyPetPerProduct />

        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-48 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : (
          <>
            <Card>
              <CardHeader>
                <CardTitle>Base prompt</CardTitle>
                <CardDescription>
                  Sent with every My Pet image edit, along with that design's own species, style and wording.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Textarea
                  value={basePrompt}
                  onChange={(e) => setBasePrompt(e.target.value)}
                  rows={5}
                  data-testid="input-my-pet-base-prompt"
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Per-style tweaks</CardTitle>
                <CardDescription>Blank by default. Only appended for a design in that style.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {MY_PET_ART_STYLES.map((style) => (
                  <div key={style} className="space-y-1.5">
                    <Label>{STYLE_LABELS[style]}</Label>
                    <Textarea
                      value={styleTweaks[style] || ""}
                      onChange={(e) => setStyleTweaks((prev) => ({ ...prev, [style]: e.target.value }))}
                      rows={2}
                      placeholder="(none)"
                      data-testid={`input-my-pet-tweak-${style}`}
                    />
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Print rules</CardTitle>
                <CardDescription>Always appended last. Locked — not editable.</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground bg-muted rounded-md p-3">{MY_PET_LOCKED_PRINT_RULES}</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Caps</CardTitle>
                <CardDescription>No login — enforced by cookie and IP together. Hitting a cap shows a friendly message, never an error.</CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <Label>Per listing (first go + retries)</Label>
                  <Input
                    type="number"
                    min={0}
                    value={capPerListing}
                    onChange={(e) => setCapPerListing(e.target.value)}
                    data-testid="input-my-pet-cap-listing"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Per day, store-wide</Label>
                  <Input
                    type="number"
                    min={0}
                    value={capPerDay}
                    onChange={(e) => setCapPerDay(e.target.value)}
                    data-testid="input-my-pet-cap-day"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Email bonus (per product)</Label>
                  <Input
                    type="number"
                    min={0}
                    value={capEmailBonus}
                    onChange={(e) => setCapEmailBonus(e.target.value)}
                    data-testid="input-my-pet-cap-email-bonus"
                  />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Render parameters (Sunburst)</CardTitle>
                <CardDescription>
                  Per-call Replicate parameters for the pet-swap image edit. Measured defaults run roughly{" "}
                  <strong>${MY_PET_SUNBURST_ESTIMATED_COST_USD.toFixed(2)}</strong> and 20–25s per generation. Changing
                  size or quality changes both numbers — re-measure after tuning.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Quality</Label>
                  <Select
                    value={renderParams.quality}
                    onValueChange={(v) => setRenderParams((prev) => ({ ...prev, quality: v as MyPetRenderParams["quality"] }))}
                  >
                    <SelectTrigger data-testid="select-my-pet-render-quality"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">low</SelectItem>
                      <SelectItem value="medium">medium (default)</SelectItem>
                      <SelectItem value="high">high</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Background</Label>
                  <Select
                    value={renderParams.background}
                    onValueChange={(v) => setRenderParams((prev) => ({ ...prev, background: v as MyPetRenderParams["background"] }))}
                  >
                    <SelectTrigger data-testid="select-my-pet-render-background"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="transparent">transparent (default)</SelectItem>
                      <SelectItem value="opaque">opaque</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Size</Label>
                  <Select
                    value={renderParams.size}
                    onValueChange={(v) => setRenderParams((prev) => ({ ...prev, size: v }))}
                  >
                    <SelectTrigger data-testid="select-my-pet-render-size"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1024x1024">1024x1024 (square)</SelectItem>
                      <SelectItem value="1024x1536">1024x1536 (portrait, default)</SelectItem>
                      <SelectItem value="1536x1024">1536x1024 (landscape)</SelectItem>
                      <SelectItem value="auto">auto</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Output format</Label>
                  <Select
                    value={renderParams.outputFormat}
                    onValueChange={(v) => setRenderParams((prev) => ({ ...prev, outputFormat: v as MyPetRenderParams["outputFormat"] }))}
                  >
                    <SelectTrigger data-testid="select-my-pet-render-format"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="png">png (default — keeps alpha)</SelectItem>
                      <SelectItem value="webp">webp</SelectItem>
                      <SelectItem value="jpeg">jpeg (no alpha)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Output compression (0–100)</Label>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    value={String(renderParams.outputCompression)}
                    onChange={(e) =>
                      setRenderParams((prev) => ({
                        ...prev,
                        outputCompression: Math.min(100, Math.max(0, Number(e.target.value) || 0)),
                      }))
                    }
                    data-testid="input-my-pet-render-compression"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Moderation</Label>
                  <Select
                    value={renderParams.moderation}
                    onValueChange={(v) => setRenderParams((prev) => ({ ...prev, moderation: v as MyPetRenderParams["moderation"] }))}
                  >
                    <SelectTrigger data-testid="select-my-pet-render-moderation"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">low (default)</SelectItem>
                      <SelectItem value="auto">auto</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>

            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} data-testid="button-save-my-pet-settings">
              {saveMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
              Save
            </Button>

            <OrderLookupCard />
          </>
        )}
      </div>
    </AdminLayout>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Order lookup (Issue 11) — audit a customer's order end-to-end.
// Given an order name (#1234) or Shopify order id, lists every My Pet
// render on that order with the preview, Replicate prediction link, and
// candidate style. Pairs with the Shopify order metafield written by
// server/my-pet.ts's recordMyPetSaleForOrder on orders/paid.
// ─────────────────────────────────────────────────────────────────────────
type MyPetOrderRender = {
  renderId: string;
  createdAt: string;
  previewUrl: string | null;
  previewPath: string;
  candidateId: string;
  artStyle: string | null;
  species: string | null;
  colorName: string | null;
  sizeId: string | null;
  replicatePredictionId: string | null;
  replicatePredictionUrl: string | null;
  petPhotoId: string | null;
  jobId: string | null;
  durationMs: number | null;
  estimatedCostUsd: string | null;
};
type MyPetOrderLookup = {
  found: boolean;
  orderId: string | null;
  orderName: string | null;
  renders: MyPetOrderRender[];
};

function OrderLookupCard() {
  const { toast } = useToast();
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<MyPetOrderLookup | null>(null);
  const [searching, setSearching] = useState(false);

  async function runLookup() {
    const trimmed = query.trim();
    if (!trimmed) return;
    setSearching(true);
    setResult(null);
    try {
      // Numeric-only input → treat as Shopify internal order id; anything with
      // # or non-digits → treat as order name (backend adds the # if missing).
      const isNumericId = /^\d+$/.test(trimmed);
      const url = isNumericId
        ? `/api/admin/my-pet-orders?orderId=${encodeURIComponent(trimmed)}`
        : `/api/admin/my-pet-orders?orderName=${encodeURIComponent(trimmed)}`;
      const res = await apiRequest("GET", url);
      const json = (await res.json()) as MyPetOrderLookup;
      setResult(json);
      if (!json.found) toast({ title: "No My Pet renders found on that order" });
    } catch (err: any) {
      toast({ title: "Lookup failed", description: err?.message, variant: "destructive" });
    } finally {
      setSearching(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Order lookup</CardTitle>
        <CardDescription>
          Audit a customer's order end-to-end. Enter the order name (e.g. <code>#1234</code>) or Shopify order id and
          see every My Pet render on it with the preview, candidate style, and the Replicate prediction link.
          The same summary is written to the Shopify order's <code>ai_art_studio.my_pet_render_id</code> metafield
          when the order is paid.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Input
            placeholder="#1234 or Shopify order id"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") runLookup(); }}
            data-testid="input-my-pet-order-lookup"
          />
          <Button onClick={runLookup} disabled={searching || !query.trim()} data-testid="button-my-pet-order-lookup">
            {searching ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Search className="h-4 w-4 mr-2" />}
            Look up
          </Button>
        </div>

        {result?.found && result.renders.length > 0 && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {result.renders.length} My Pet render{result.renders.length === 1 ? "" : "s"} on order{" "}
              <strong>{result.orderName || result.orderId}</strong>
            </p>
            {result.renders.map((r) => (
              <div key={r.renderId} className="border rounded-md p-3 flex gap-3">
                {r.previewUrl ? (
                  <a href={r.previewUrl} target="_blank" rel="noreferrer" className="flex-shrink-0">
                    <img src={r.previewUrl} alt="Preview" className="w-24 h-24 object-cover rounded" />
                  </a>
                ) : (
                  <div className="w-24 h-24 bg-muted rounded flex items-center justify-center text-xs text-muted-foreground">
                    No preview
                  </div>
                )}
                <div className="flex-1 min-w-0 text-sm space-y-1">
                  <div className="font-medium">
                    {r.artStyle || "(unknown style)"} · {r.species || "?"}
                    {r.colorName ? ` · ${r.colorName}` : ""}
                    {r.sizeId ? ` · ${r.sizeId}` : ""}
                  </div>
                  <div className="text-muted-foreground text-xs break-all">
                    <div>render: <code>{r.renderId}</code></div>
                    {r.jobId && <div>job: <code>{r.jobId}</code></div>}
                    {r.petPhotoId && <div>pet photo: <code>{r.petPhotoId}</code></div>}
                    <div>storage: <code>{r.previewPath}</code></div>
                    <div>
                      cost: {r.estimatedCostUsd ? `$${r.estimatedCostUsd}` : "—"}
                      {typeof r.durationMs === "number" ? ` · ${(r.durationMs / 1000).toFixed(1)}s` : ""}
                      {" · "}
                      {new Date(r.createdAt).toLocaleString()}
                    </div>
                  </div>
                  {r.replicatePredictionUrl && (
                    <a
                      href={r.replicatePredictionUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                      data-testid="link-replicate-prediction"
                    >
                      <ExternalLink className="h-3 w-3" />
                      Replicate prediction
                      {r.replicatePredictionId ? ` (${r.replicatePredictionId.slice(0, 8)}…)` : ""}
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        {result && !result.found && (
          <p className="text-sm text-muted-foreground">
            No My Pet renders found on that order. If the customer complaint references a product customised via the
            standard studio flow (not My Pet), check that order's metafields directly in Shopify instead.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
