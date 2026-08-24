import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import AdminLayout from "@/components/admin-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Loader2, RefreshCw, Trash2 } from "lucide-react";

type TierConfig = {
  offerThresholdBp: number;
  excludeThresholdBp: number;
  absoluteCapCents: number;
  retailMarkupBp: number;
};

type ClassSummary = {
  id: number;
  blueprintId: number;
  providerId: number;
  name: string;
  shippingMethod: string;
  groupCount: number;
  zoneCount: number;
  normalZones: string[];
  warnedZones: string[];
  excludedZones: string[];
  productCount: number;
  variantCount: number;
  absoluteCapCentsOverride: number | null;
  typicalRetailCentsOverride: number | null;
  lastFetchedAt: string | null;
  lastChangedAt: string | null;
  lastError: string | null;
};

type GeoIpStatus = {
  path: string;
  exists: boolean;
  ageDays: number | null;
  lastRefreshAt: string | null;
  lastError: string | null;
  readerOpen: boolean;
  licenseKeyPresent: boolean;
  stale: boolean;
  status: "ok" | "no_license" | "db_missing" | "stale" | "error";
};

type Overview = { config: TierConfig; classes: ClassSummary[]; geo?: GeoIpStatus };

type GroupDef = { group: string; label: string; printifyVariantIds: string[] };

type RateRow = {
  id: number;
  countryCode: string;
  variantGroup: string;
  firstItemCents: number;
  additionalCents: number;
  shippable: boolean;
  tier: string;
  ratioBp: number | null;
  typicalRetailCents: number | null;
  tierReason: string | null;
};

type AuditRow = {
  id: number;
  countryCode: string | null;
  variantGroup: string | null;
  changeType: string;
  oldValue: string | null;
  newValue: string | null;
  createdAt: string;
};

type ZoneRule = {
  id: number;
  shippingClassId: number;
  countryCode: string;
  action: string;
  note: string | null;
};

type ClassDetail = {
  class: ClassSummary & { variantGroupsJson: string; tableHash: string | null };
  groups: GroupDef[];
  rates: RateRow[];
  audits: AuditRow[];
  rules: ZoneRule[];
  products: Array<{ id: number; name: string }>;
  variantCount: number;
};

type SyncRun = {
  id: number;
  source: string;
  status: string;
  classesChecked: number;
  classesChanged: number;
  classesFailed: number;
  startedAt: string;
  finishedAt: string | null;
};

type StoreRow = {
  shopDomain: string;
  shippingMode: string;
  manageVariantWeights: boolean;
  probedMaxRatesPerZone: number | null;
  lastReconcileAt: string | null;
  lastReconcileStatus: string | null;
  lastReconcileError: string | null;
  mappedProfiles: number;
  erroredProfiles: number;
  customProfilesUsed: number | null;
  profileBudget: number;
  profileWarnAt: number;
};

type ReconcileSummary = {
  status: string;
  desiredProfiles: number;
  createdProfiles: number;
  updatedProfiles: number;
  unchangedProfiles: number;
  removedProfiles: number;
  zonesWritten: number;
  ratesWritten: number;
  variantsAssociated: number;
  weightsWritten: number;
  unresolvedVariants: number;
  customProfilesUsed: number;
  profileBudget: number;
  warnings: string[];
  errors: string[];
};

function usd(cents: number | null | undefined): string {
  if (cents == null) return "—";
  return `$${(cents / 100).toFixed(2)}`;
}

function tierBadge(tier: string) {
  if (tier === "excluded") return <Badge variant="destructive">excluded</Badge>;
  if (tier === "warned") {
    return (
      <Badge variant="secondary" className="bg-amber-100 text-amber-900">
        warned
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="bg-emerald-100 text-emerald-800">
      normal
    </Badge>
  );
}

async function getJson<T>(url: string): Promise<T> {
  const res = await apiRequest("GET", url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as any).error || `Request failed: ${url}`);
  }
  return res.json();
}

export default function PlatformShippingPage() {
  const { toast } = useToast();
  const [selectedClassId, setSelectedClassId] = useState<number | null>(null);
  const [configDraft, setConfigDraft] = useState<Partial<TierConfig>>({});
  const [ruleCountry, setRuleCountry] = useState("");
  const [ruleAction, setRuleAction] = useState<"block" | "allow">("block");
  const [capDraft, setCapDraft] = useState("");
  const [retailDraft, setRetailDraft] = useState("");
  const [newBpId, setNewBpId] = useState("");
  const [newProviderId, setNewProviderId] = useState("");
  const [newStoreDomain, setNewStoreDomain] = useState("");
  const [lastDryRun, setLastDryRun] = useState<{ shop: string; summary: ReconcileSummary } | null>(
    null,
  );

  const overviewQ = useQuery<Overview>({
    queryKey: ["/api/platform/shipping/overview"],
    queryFn: () => getJson("/api/platform/shipping/overview"),
  });

  const runsQ = useQuery<{ runs: SyncRun[] }>({
    queryKey: ["/api/platform/shipping/runs"],
    queryFn: () => getJson("/api/platform/shipping/runs"),
  });

  const storesQ = useQuery<{ stores: StoreRow[] }>({
    queryKey: ["/api/platform/shipping/stores"],
    queryFn: () => getJson("/api/platform/shipping/stores"),
    // Applies run in the background server-side (they outlive the HTTP
    // request) — poll while any store reports a run in progress.
    refetchInterval: (query) =>
      (query.state.data?.stores || []).some((s) => s.lastReconcileStatus === "running")
        ? 5000
        : false,
  });

  // Completion toast: when a store's status leaves "running", announce the
  // outcome — the background apply has no request/response to hang a toast on.
  const prevStatusesRef = useRef<Record<string, string | null>>({});
  useEffect(() => {
    for (const s of storesQ.data?.stores || []) {
      const prev = prevStatusesRef.current[s.shopDomain];
      if (prev === "running" && s.lastReconcileStatus !== "running") {
        toast({
          title: `Apply ${s.lastReconcileStatus} — ${s.shopDomain}`,
          description:
            s.lastReconcileError?.slice(0, 200) ||
            "Delivery profiles reconciled.",
          variant: s.lastReconcileStatus === "ok" ? "default" : "destructive",
        });
      }
      prevStatusesRef.current[s.shopDomain] = s.lastReconcileStatus;
    }
  }, [storesQ.data, toast]);

  const storePatchMutation = useMutation({
    mutationFn: async (payload: {
      shop: string;
      shippingMode?: string;
      manageVariantWeights?: boolean;
    }) => {
      const { shop, ...patch } = payload;
      const res = await apiRequest("PATCH", `/api/platform/shipping/stores/${shop}`, patch);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Store update failed");
      return body;
    },
    onSuccess: () => {
      toast({ title: "Store settings saved" });
      queryClient.invalidateQueries({ queryKey: ["/api/platform/shipping/stores"] });
    },
    onError: (e: Error) =>
      toast({ title: "Store update failed", description: e.message, variant: "destructive" }),
  });

  const reconcileMutation = useMutation({
    mutationFn: async (payload: { shop: string; dryRun: boolean }) => {
      const res = await apiRequest(
        "POST",
        `/api/platform/shipping/stores/${payload.shop}/reconcile`,
        { dryRun: payload.dryRun },
      );
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Reconcile failed");
      return { ...body, shop: payload.shop, dryRun: payload.dryRun };
    },
    onSuccess: (r: any) => {
      if (r.dryRun) {
        const s: ReconcileSummary = r.summary;
        setLastDryRun({ shop: r.shop, summary: s });
        toast({
          title: "Dry-run complete",
          description: `${s.desiredProfiles} profiles desired (+${s.createdProfiles} new, ~${s.updatedProfiles} changed, ${s.removedProfiles} to GC).`,
        });
      } else {
        // Apply runs in the background (202) — status column polls until done.
        toast({
          title: "Apply started",
          description:
            "Running in the background — the status column will update when it finishes (a full apply can take several minutes).",
        });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/platform/shipping/stores"] });
    },
    onError: (e: Error) =>
      toast({ title: "Reconcile failed", description: e.message, variant: "destructive" }),
  });

  const disableStoreMutation = useMutation({
    mutationFn: async (shop: string) => {
      const res = await apiRequest("POST", `/api/platform/shipping/stores/${shop}/disable`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Disable failed");
      return body;
    },
    onSuccess: (r: any) => {
      toast({
        title: "Table mode disabled",
        description: `${r.removedProfiles} app profile(s) removed — variants back on General.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/platform/shipping/stores"] });
    },
    onError: (e: Error) =>
      toast({ title: "Disable failed", description: e.message, variant: "destructive" }),
  });

  const detailQ = useQuery<ClassDetail>({
    queryKey: ["/api/platform/shipping/classes", selectedClassId],
    queryFn: () => getJson(`/api/platform/shipping/classes/${selectedClassId}`),
    enabled: selectedClassId != null,
  });

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/platform/shipping/overview"] });
    queryClient.invalidateQueries({ queryKey: ["/api/platform/shipping/runs"] });
    if (selectedClassId != null) {
      queryClient.invalidateQueries({
        queryKey: ["/api/platform/shipping/classes", selectedClassId],
      });
    }
  };

  const syncMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/platform/shipping/sync");
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Sync failed");
      return body;
    },
    onSuccess: (r: any) => {
      toast({
        title: "Shipping sync complete",
        description: `Checked ${r.checked}, changed ${r.changed}, failed ${r.failed}.`,
      });
      invalidateAll();
    },
    onError: (e: Error) => toast({ title: "Sync failed", description: e.message, variant: "destructive" }),
  });

  const resyncClassMutation = useMutation({
    mutationFn: async (classId: number) => {
      const res = await apiRequest("POST", `/api/platform/shipping/classes/${classId}/resync`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Resync failed");
      return body;
    },
    onSuccess: () => {
      toast({ title: "Class resynced" });
      invalidateAll();
    },
    onError: (e: Error) =>
      toast({ title: "Resync failed", description: e.message, variant: "destructive" }),
  });

  const addClassMutation = useMutation({
    mutationFn: async (payload: { blueprintId: number; providerId: number }) => {
      const res = await apiRequest("POST", "/api/platform/shipping/classes", payload);
      const body = await res.json();
      if (!res.ok || !body.ok) throw new Error(body.error || body.result?.error || "Ingest failed");
      return body;
    },
    onSuccess: () => {
      toast({ title: "Shipping class ingested" });
      setNewBpId("");
      setNewProviderId("");
      invalidateAll();
    },
    onError: (e: Error) =>
      toast({ title: "Ingest failed", description: e.message, variant: "destructive" }),
  });

  const configMutation = useMutation({
    mutationFn: async (patch: Partial<TierConfig>) => {
      const res = await apiRequest("PUT", "/api/platform/shipping/config", patch);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Config update failed");
      return body;
    },
    onSuccess: () => {
      toast({ title: "Thresholds saved", description: "Tiers re-evaluated for all classes." });
      setConfigDraft({});
      invalidateAll();
    },
    onError: (e: Error) =>
      toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const ruleMutation = useMutation({
    mutationFn: async (payload: { shippingClassId: number; countryCode: string; action: string }) => {
      const res = await apiRequest("POST", "/api/platform/shipping/rules", payload);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Rule update failed");
      return body;
    },
    onSuccess: () => {
      toast({ title: "Rule saved", description: "Tiers re-evaluated." });
      setRuleCountry("");
      invalidateAll();
    },
    onError: (e: Error) =>
      toast({ title: "Rule failed", description: e.message, variant: "destructive" }),
  });

  const ruleDeleteMutation = useMutation({
    mutationFn: async (ruleId: number) => {
      const res = await apiRequest("DELETE", `/api/platform/shipping/rules/${ruleId}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Rule delete failed");
      return body;
    },
    onSuccess: () => {
      toast({ title: "Rule removed" });
      invalidateAll();
    },
    onError: (e: Error) =>
      toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
  });

  const overrideMutation = useMutation({
    mutationFn: async (payload: {
      classId: number;
      absoluteCapCentsOverride: number | null;
      typicalRetailCentsOverride: number | null;
    }) => {
      const res = await apiRequest("PATCH", `/api/platform/shipping/classes/${payload.classId}`, {
        absoluteCapCentsOverride: payload.absoluteCapCentsOverride,
        typicalRetailCentsOverride: payload.typicalRetailCentsOverride,
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Override update failed");
      return body;
    },
    onSuccess: () => {
      toast({ title: "Overrides saved", description: "Tiers re-evaluated for this class." });
      invalidateAll();
    },
    onError: (e: Error) =>
      toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const config = overviewQ.data?.config;
  const detail = detailQ.data;

  /** Rate matrix: country → group → rate, countries sorted with US/CA/GB/AU first. */
  const rateMatrix = useMemo(() => {
    if (!detail) return { countries: [] as string[], byCountry: new Map<string, Map<string, RateRow>>() };
    const byCountry = new Map<string, Map<string, RateRow>>();
    for (const r of detail.rates) {
      const slot = byCountry.get(r.countryCode) || new Map<string, RateRow>();
      slot.set(r.variantGroup, r);
      byCountry.set(r.countryCode, slot);
    }
    const preferred = ["US", "CA", "GB", "AU", "DE", "FR", "ROW"];
    const countries = Array.from(byCountry.keys()).sort((a, b) => {
      const ia = preferred.indexOf(a);
      const ib = preferred.indexOf(b);
      if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
      return a.localeCompare(b);
    });
    return { countries, byCountry };
  }, [detail]);

  return (
    <AdminLayout>
      <div className="space-y-6 pb-16">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Shipping Coverage</h1>
            <p className="text-sm text-muted-foreground">
              Printify shipping tables → exclusion tiers → coverage matrix. All amounts USD cents
              (standard shipping only).
            </p>
          </div>
          <Button onClick={() => syncMutation.mutate()} disabled={syncMutation.isPending}>
            {syncMutation.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Sync all tables
          </Button>
        </div>

        {/* Thresholds */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Exclusion tier thresholds</CardTitle>
          </CardHeader>
          <CardContent>
            {!config ? (
              <Skeleton className="h-10 w-full" />
            ) : (
              <div className="flex flex-wrap items-end gap-4">
                <label className="text-sm">
                  <div className="text-muted-foreground mb-1">Offer threshold (ratio %)</div>
                  <Input
                    className="w-32"
                    type="number"
                    step="1"
                    value={
                      configDraft.offerThresholdBp != null
                        ? configDraft.offerThresholdBp / 100
                        : config.offerThresholdBp / 100
                    }
                    onChange={(e) =>
                      setConfigDraft((d) => ({
                        ...d,
                        offerThresholdBp: Math.round(parseFloat(e.target.value || "0") * 100),
                      }))
                    }
                  />
                </label>
                <label className="text-sm">
                  <div className="text-muted-foreground mb-1">Exclude threshold (ratio %)</div>
                  <Input
                    className="w-32"
                    type="number"
                    step="1"
                    value={
                      configDraft.excludeThresholdBp != null
                        ? configDraft.excludeThresholdBp / 100
                        : config.excludeThresholdBp / 100
                    }
                    onChange={(e) =>
                      setConfigDraft((d) => ({
                        ...d,
                        excludeThresholdBp: Math.round(parseFloat(e.target.value || "0") * 100),
                      }))
                    }
                  />
                </label>
                <label className="text-sm">
                  <div className="text-muted-foreground mb-1">Absolute cap (USD)</div>
                  <Input
                    className="w-32"
                    type="number"
                    step="1"
                    value={
                      configDraft.absoluteCapCents != null
                        ? configDraft.absoluteCapCents / 100
                        : config.absoluteCapCents / 100
                    }
                    onChange={(e) =>
                      setConfigDraft((d) => ({
                        ...d,
                        absoluteCapCents: Math.round(parseFloat(e.target.value || "0") * 100),
                      }))
                    }
                  />
                </label>
                <label className="text-sm">
                  <div className="text-muted-foreground mb-1">Retail fallback (× COGS)</div>
                  <Input
                    className="w-32"
                    type="number"
                    step="0.1"
                    value={
                      configDraft.retailMarkupBp != null
                        ? configDraft.retailMarkupBp / 10000
                        : config.retailMarkupBp / 10000
                    }
                    onChange={(e) =>
                      setConfigDraft((d) => ({
                        ...d,
                        retailMarkupBp: Math.round(parseFloat(e.target.value || "0") * 10000),
                      }))
                    }
                  />
                </label>
                <Button
                  variant="secondary"
                  disabled={configMutation.isPending || Object.keys(configDraft).length === 0}
                  onClick={() => configMutation.mutate(configDraft)}
                >
                  {configMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Save & re-evaluate
                </Button>
                <div className="text-xs text-muted-foreground max-w-sm">
                  ratio = first-item ÷ typical retail. ≤ offer → normal; ≤ exclude → warned;
                  above, or first-item &gt; cap → excluded. Retail falls back to median group COGS ×
                  multiplier when no per-class retail override is set.
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Per-store delivery profile sync (Phase 3) */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-4">
              <CardTitle className="text-base">Delivery profile sync (per store)</CardTitle>
              <div className="flex items-center gap-2">
                <Input
                  className="w-64"
                  placeholder="shop.myshopify.com"
                  value={newStoreDomain}
                  onChange={(e) => setNewStoreDomain(e.target.value)}
                />
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!newStoreDomain.trim() || reconcileMutation.isPending}
                  onClick={() => {
                    reconcileMutation.mutate({ shop: newStoreDomain.trim(), dryRun: true });
                    setNewStoreDomain("");
                  }}
                >
                  Dry-run new store
                </Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Table mode writes weight-banded delivery profiles from the ingested Printify tables.
              Profiles are demand-driven (created only for classes with live app variants, GC'd
              when the last one leaves). The 99-custom-profile cap is Shopify plan-independent;
              budget below is used/{"{"}90{"}"} with a warning at 70 — long-term headroom is Exact
              Mode, interim lever is the per-class group-merge threshold.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {storesQ.isLoading ? (
              <Skeleton className="h-16 w-full" />
            ) : !storesQ.data?.stores.length ? (
              <div className="text-sm text-muted-foreground">
                No stores tracked yet — run a dry-run against a shop domain above to start.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="py-2 pr-4">Store</th>
                      <th className="py-2 pr-4">Mode</th>
                      <th className="py-2 pr-4">Profiles</th>
                      <th className="py-2 pr-4">Budget</th>
                      <th className="py-2 pr-4">Weights</th>
                      <th className="py-2 pr-4">Last reconcile</th>
                      <th className="py-2 pr-0 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {storesQ.data.stores.map((s) => {
                      const budgetWarn =
                        s.customProfilesUsed != null && s.customProfilesUsed >= s.profileWarnAt;
                      return (
                        <tr key={s.shopDomain} className="border-b align-top">
                          <td className="py-2 pr-4 font-mono text-xs">{s.shopDomain}</td>
                          <td className="py-2 pr-4">
                            <select
                              className="rounded border bg-background px-2 py-1 text-xs"
                              value={s.shippingMode}
                              disabled={storePatchMutation.isPending}
                              onChange={(e) =>
                                storePatchMutation.mutate({
                                  shop: s.shopDomain,
                                  shippingMode: e.target.value,
                                })
                              }
                            >
                              <option value="off">off</option>
                              <option value="table">table</option>
                              <option value="exact" disabled>
                                exact (later)
                              </option>
                            </select>
                          </td>
                          <td className="py-2 pr-4">
                            {s.mappedProfiles}
                            {s.erroredProfiles > 0 && (
                              <Badge variant="destructive" className="ml-2">
                                {s.erroredProfiles} err
                              </Badge>
                            )}
                          </td>
                          <td className="py-2 pr-4">
                            {s.customProfilesUsed == null ? (
                              "—"
                            ) : (
                              <span className={budgetWarn ? "font-semibold text-amber-600" : ""}>
                                {s.customProfilesUsed}/{s.profileBudget}
                              </span>
                            )}
                          </td>
                          <td className="py-2 pr-4">
                            <input
                              type="checkbox"
                              checked={s.manageVariantWeights}
                              disabled={storePatchMutation.isPending}
                              onChange={(e) =>
                                storePatchMutation.mutate({
                                  shop: s.shopDomain,
                                  manageVariantWeights: e.target.checked,
                                })
                              }
                            />
                          </td>
                          <td className="py-2 pr-4 text-xs">
                            {s.lastReconcileAt ? (
                              <>
                                <div>
                                  {new Date(s.lastReconcileAt).toLocaleString()}{" "}
                                  <Badge
                                    variant={
                                      s.lastReconcileStatus === "ok"
                                        ? "secondary"
                                        : s.lastReconcileStatus === "running"
                                          ? "outline"
                                          : "destructive"
                                    }
                                  >
                                    {s.lastReconcileStatus === "running" && (
                                      <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />
                                    )}
                                    {s.lastReconcileStatus}
                                  </Badge>
                                </div>
                                {s.lastReconcileError && (
                                  <div className="mt-1 max-w-xs truncate text-destructive">
                                    {s.lastReconcileError}
                                  </div>
                                )}
                              </>
                            ) : (
                              "never"
                            )}
                          </td>
                          <td className="py-2 pr-0 text-right">
                            <div className="flex justify-end gap-2">
                              <Button
                                size="sm"
                                variant="secondary"
                                disabled={reconcileMutation.isPending}
                                onClick={() =>
                                  reconcileMutation.mutate({ shop: s.shopDomain, dryRun: true })
                                }
                              >
                                Dry-run
                              </Button>
                              <Button
                                size="sm"
                                disabled={
                                  reconcileMutation.isPending ||
                                  s.shippingMode !== "table" ||
                                  s.lastReconcileStatus === "running"
                                }
                                onClick={() =>
                                  reconcileMutation.mutate({ shop: s.shopDomain, dryRun: false })
                                }
                              >
                                {(reconcileMutation.isPending ||
                                  s.lastReconcileStatus === "running") && (
                                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                )}
                                Apply
                              </Button>
                              <Button
                                size="sm"
                                variant="destructive"
                                disabled={disableStoreMutation.isPending || s.mappedProfiles === 0}
                                onClick={() => {
                                  if (
                                    window.confirm(
                                      `Disable table mode on ${s.shopDomain}? All app-owned delivery profiles are removed and variants return to the General profile.`,
                                    )
                                  ) {
                                    disableStoreMutation.mutate(s.shopDomain);
                                  }
                                }}
                              >
                                Disable
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {lastDryRun && (
              <div className="rounded border bg-muted/40 p-3 text-xs">
                <div className="mb-1 font-semibold">
                  Dry-run plan — {lastDryRun.shop}
                </div>
                <div className="flex flex-wrap gap-x-6 gap-y-1">
                  <span>{lastDryRun.summary.desiredProfiles} profiles desired</span>
                  <span>+{lastDryRun.summary.createdProfiles} create</span>
                  <span>~{lastDryRun.summary.updatedProfiles} update</span>
                  <span>={lastDryRun.summary.unchangedProfiles} unchanged</span>
                  <span>-{lastDryRun.summary.removedProfiles} GC</span>
                  <span>{lastDryRun.summary.zonesWritten} zones</span>
                  <span>{lastDryRun.summary.ratesWritten} rates</span>
                  <span>{lastDryRun.summary.variantsAssociated} variants</span>
                  <span>
                    budget {lastDryRun.summary.customProfilesUsed}/
                    {lastDryRun.summary.profileBudget}
                  </span>
                </div>
                {lastDryRun.summary.warnings.length > 0 && (
                  <div className="mt-1 text-amber-600">
                    {lastDryRun.summary.warnings.join(" · ")}
                  </div>
                )}
                {lastDryRun.summary.errors.length > 0 && (
                  <div className="mt-1 text-destructive">
                    {lastDryRun.summary.errors.join(" · ")}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Classes */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-4">
              <CardTitle className="text-base">
                Shipping classes {overviewQ.data ? `(${overviewQ.data.classes.length})` : ""}
              </CardTitle>
              <div className="flex items-center gap-2">
                <Input
                  className="w-28"
                  placeholder="Blueprint id"
                  value={newBpId}
                  onChange={(e) => setNewBpId(e.target.value.replace(/\D/g, ""))}
                />
                <Input
                  className="w-28"
                  placeholder="Provider id"
                  value={newProviderId}
                  onChange={(e) => setNewProviderId(e.target.value.replace(/\D/g, ""))}
                />
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={addClassMutation.isPending || !newBpId || !newProviderId}
                  onClick={() =>
                    addClassMutation.mutate({
                      blueprintId: parseInt(newBpId, 10),
                      providerId: parseInt(newProviderId, 10),
                    })
                  }
                >
                  {addClassMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Add class
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {overviewQ.isLoading ? (
              <Skeleton className="h-32 w-full" />
            ) : overviewQ.error ? (
              <div className="text-sm text-destructive">{(overviewQ.error as Error).message}</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-muted-foreground border-b">
                      <th className="py-2 pr-3">Class</th>
                      <th className="py-2 pr-3">BP / Provider</th>
                      <th className="py-2 pr-3">Groups</th>
                      <th className="py-2 pr-3">Zones</th>
                      <th className="py-2 pr-3">Warned</th>
                      <th className="py-2 pr-3">Excluded</th>
                      <th className="py-2 pr-3">Products</th>
                      <th className="py-2 pr-3">Last change</th>
                      <th className="py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {(overviewQ.data?.classes || []).map((c) => (
                      <tr
                        key={c.id}
                        className={`border-b cursor-pointer hover:bg-muted/50 ${
                          selectedClassId === c.id ? "bg-muted/60" : ""
                        }`}
                        onClick={() => {
                          setSelectedClassId(c.id);
                          setCapDraft(
                            c.absoluteCapCentsOverride != null
                              ? String(c.absoluteCapCentsOverride / 100)
                              : "",
                          );
                          setRetailDraft(
                            c.typicalRetailCentsOverride != null
                              ? String(c.typicalRetailCentsOverride / 100)
                              : "",
                          );
                        }}
                      >
                        <td className="py-2 pr-3 font-medium">
                          {c.name}
                          {c.lastError ? (
                            <span className="ml-2 text-xs text-destructive">fetch error</span>
                          ) : null}
                        </td>
                        <td className="py-2 pr-3 text-muted-foreground">
                          {c.blueprintId} / {c.providerId}
                        </td>
                        <td className="py-2 pr-3">{c.groupCount}</td>
                        <td className="py-2 pr-3">{c.zoneCount}</td>
                        <td className="py-2 pr-3">
                          {c.warnedZones.length ? (
                            <span className="text-amber-700">{c.warnedZones.join(", ")}</span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="py-2 pr-3">
                          {c.excludedZones.length ? (
                            <span className="text-destructive">
                              {c.excludedZones.slice(0, 8).join(", ")}
                              {c.excludedZones.length > 8 ? ` +${c.excludedZones.length - 8}` : ""}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="py-2 pr-3">
                          {c.productCount} ({c.variantCount}v)
                        </td>
                        <td className="py-2 pr-3 text-muted-foreground">
                          {c.lastChangedAt ? new Date(c.lastChangedAt).toLocaleString() : "—"}
                        </td>
                        <td className="py-2 text-right">
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={resyncClassMutation.isPending}
                            onClick={(e) => {
                              e.stopPropagation();
                              resyncClassMutation.mutate(c.id);
                            }}
                          >
                            <RefreshCw className="h-4 w-4" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                    {(overviewQ.data?.classes || []).length === 0 && (
                      <tr>
                        <td colSpan={9} className="py-6 text-center text-muted-foreground">
                          No shipping classes yet — run “Sync all tables”.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Class detail */}
        {selectedClassId != null && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {detail ? detail.class.name : "Loading class…"}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {detailQ.isLoading || !detail ? (
                <Skeleton className="h-40 w-full" />
              ) : (
                <>
                  {/* Groups */}
                  <div>
                    <div className="font-medium mb-2 text-sm">
                      Variant groups ({detail.groups.length}) — cross-zone grouping
                    </div>
                    <div className="grid gap-2 md:grid-cols-2">
                      {detail.groups.map((g) => (
                        <div key={g.group} className="rounded border p-2 text-sm">
                          <span className="font-mono font-medium mr-2">{g.group}</span>
                          {g.label || `${g.printifyVariantIds.length} variant(s)`}
                          <span className="text-muted-foreground ml-2 text-xs">
                            ({g.printifyVariantIds.length} variants)
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Rate matrix */}
                  <div>
                    <div className="font-medium mb-2 text-sm">
                      Rates by zone (first / additional, USD)
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-muted-foreground border-b">
                            <th className="py-2 pr-3">Zone</th>
                            {detail.groups.map((g) => (
                              <th key={g.group} className="py-2 pr-3 font-mono">
                                {g.group}
                              </th>
                            ))}
                            <th className="py-2 pr-3">Tier</th>
                            <th className="py-2">Ratio</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rateMatrix.countries.map((country) => {
                            const slot = rateMatrix.byCountry.get(country)!;
                            const anyRate = detail.groups
                              .map((g) => slot.get(g.group))
                              .find(Boolean);
                            const worst = detail.groups.reduce((acc, g) => {
                              const r = slot.get(g.group);
                              if (!r) return acc;
                              const sev = r.tier === "excluded" ? 2 : r.tier === "warned" ? 1 : 0;
                              return Math.max(acc, sev);
                            }, 0);
                            const worstTier =
                              worst === 2 ? "excluded" : worst === 1 ? "warned" : "normal";
                            const ratios = detail.groups
                              .map((g) => slot.get(g.group)?.ratioBp)
                              .filter((r): r is number => r != null);
                            return (
                              <tr key={country} className="border-b">
                                <td className="py-2 pr-3 font-medium">{country}</td>
                                {detail.groups.map((g) => {
                                  const r = slot.get(g.group);
                                  return (
                                    <td key={g.group} className="py-2 pr-3 whitespace-nowrap">
                                      {r ? (
                                        <span className={r.shippable ? "" : "line-through opacity-60"}>
                                          {usd(r.firstItemCents)} / {usd(r.additionalCents)}
                                        </span>
                                      ) : (
                                        "—"
                                      )}
                                    </td>
                                  );
                                })}
                                <td className="py-2 pr-3">{anyRate ? tierBadge(worstTier) : "—"}</td>
                                <td className="py-2 text-muted-foreground text-xs">
                                  {ratios.length
                                    ? `${Math.min(...ratios) / 100}–${Math.max(...ratios) / 100}%`
                                    : "—"}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Overrides + rules */}
                  <div className="grid gap-6 md:grid-cols-2">
                    <div className="space-y-3">
                      <div className="font-medium text-sm">Per-class overrides</div>
                      <label className="block text-sm">
                        <div className="text-muted-foreground mb-1">Absolute cap (USD, blank = default)</div>
                        <Input
                          className="w-40"
                          type="number"
                          value={capDraft}
                          onChange={(e) => setCapDraft(e.target.value)}
                        />
                      </label>
                      <label className="block text-sm">
                        <div className="text-muted-foreground mb-1">
                          Typical retail (USD, blank = COGS fallback)
                        </div>
                        <Input
                          className="w-40"
                          type="number"
                          value={retailDraft}
                          onChange={(e) => setRetailDraft(e.target.value)}
                        />
                      </label>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={overrideMutation.isPending}
                        onClick={() =>
                          overrideMutation.mutate({
                            classId: detail.class.id,
                            absoluteCapCentsOverride: capDraft.trim()
                              ? Math.round(parseFloat(capDraft) * 100)
                              : null,
                            typicalRetailCentsOverride: retailDraft.trim()
                              ? Math.round(parseFloat(retailDraft) * 100)
                              : null,
                          })
                        }
                      >
                        {overrideMutation.isPending && (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        )}
                        Save overrides
                      </Button>
                      <div className="text-xs text-muted-foreground max-w-sm">
                        Profile-merge lever: <code>group_delta_split_threshold_cents</code> (DB-only
                        for now) merges a multi-group class into fewer delivery profiles at the cost
                        of overcharging mixed-size carts. 493:36 (framed posters) stays 6-way split —
                        monitor mixed-size framed cart frequency post-launch before merging.
                      </div>
                    </div>

                    <div className="space-y-3">
                      <div className="font-medium text-sm">Manual zone rules</div>
                      <div className="flex items-center gap-2">
                        <Input
                          className="w-24"
                          placeholder="CC (AU)"
                          value={ruleCountry}
                          onChange={(e) => setRuleCountry(e.target.value.toUpperCase())}
                          maxLength={3}
                        />
                        <select
                          className="h-9 rounded-md border bg-background px-2 text-sm"
                          value={ruleAction}
                          onChange={(e) => setRuleAction(e.target.value as "block" | "allow")}
                        >
                          <option value="block">block</option>
                          <option value="allow">allow</option>
                        </select>
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={ruleMutation.isPending || !ruleCountry.trim()}
                          onClick={() =>
                            ruleMutation.mutate({
                              shippingClassId: detail.class.id,
                              countryCode: ruleCountry.trim(),
                              action: ruleAction,
                            })
                          }
                        >
                          Add rule
                        </Button>
                      </div>
                      <div className="space-y-1">
                        {detail.rules.map((r) => (
                          <div key={r.id} className="flex items-center gap-2 text-sm">
                            <Badge variant={r.action === "block" ? "destructive" : "secondary"}>
                              {r.action}
                            </Badge>
                            <span className="font-mono">{r.countryCode}</span>
                            <span className="text-muted-foreground text-xs">
                              {r.shippingClassId === 0 ? "(global)" : "(this class)"}
                            </span>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 px-1"
                              onClick={() => ruleDeleteMutation.mutate(r.id)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        ))}
                        {detail.rules.length === 0 && (
                          <div className="text-xs text-muted-foreground">No manual rules.</div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Products + audits */}
                  <div className="grid gap-6 md:grid-cols-2">
                    <div>
                      <div className="font-medium text-sm mb-2">
                        Products in this class ({detail.products.length})
                      </div>
                      <div className="space-y-1 text-sm">
                        {detail.products.map((p) => (
                          <div key={p.id} className="text-muted-foreground">
                            #{p.id} — {p.name}
                          </div>
                        ))}
                      </div>
                    </div>
                    <div>
                      <div className="font-medium text-sm mb-2">Recent changes</div>
                      <div className="space-y-1 text-xs max-h-64 overflow-y-auto">
                        {detail.audits.map((a) => (
                          <div key={a.id} className="text-muted-foreground">
                            <span className="font-mono">
                              {new Date(a.createdAt).toLocaleString()}
                            </span>{" "}
                            <Badge variant="outline" className="mx-1">
                              {a.changeType}
                            </Badge>
                            {a.countryCode ? `${a.countryCode} ` : ""}
                            {a.variantGroup ? `${a.variantGroup} ` : ""}
                            {a.oldValue ? `${a.oldValue} → ` : ""}
                            {a.newValue || ""}
                          </div>
                        ))}
                        {detail.audits.length === 0 && (
                          <div className="text-muted-foreground">No audit entries yet.</div>
                        )}
                      </div>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        )}

        <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">IP geolocation</CardTitle>
          </CardHeader>
          <CardContent>
            {overviewQ.isLoading ? (
              <Skeleton className="h-16 w-full" />
            ) : (
              <GeoIpStatusPanel geo={overviewQ.data?.geo} />
            )}
          </CardContent>
        </Card>
        {/* Sync runs */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Sync runs</CardTitle>
          </CardHeader>
          <CardContent>
            {runsQ.isLoading ? (
              <Skeleton className="h-16 w-full" />
            ) : (
              <div className="space-y-1 text-sm">
                {(runsQ.data?.runs || []).map((r) => (
                  <div key={r.id} className="flex items-center gap-3">
                    <Badge variant={r.status === "failed" ? "destructive" : "secondary"}>
                      {r.status}
                    </Badge>
                    <span className="text-muted-foreground">{r.source}</span>
                    <span>
                      checked {r.classesChecked}, changed {r.classesChanged}, failed{" "}
                      {r.classesFailed}
                    </span>
                    <span className="text-muted-foreground text-xs">
                      {new Date(r.startedAt).toLocaleString()}
                    </span>
                  </div>
                ))}
                {(runsQ.data?.runs || []).length === 0 && (
                  <div className="text-muted-foreground">No sync runs yet.</div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
        </div>
      </div>
    </AdminLayout>
  );
}

function GeoIpStatusPanel({ geo }: { geo?: GeoIpStatus }) {
  if (!geo) {
    return <p className="text-sm text-muted-foreground">GeoLite2 status unavailable.</p>;
  }
  const tone =
    geo.status === "ok"
      ? "secondary"
      : geo.status === "stale"
        ? "secondary"
        : "destructive";
  const label =
    geo.status === "ok"
      ? "IP-geo ready"
      : geo.status === "no_license"
        ? "IP-geo off — no license key"
        : geo.status === "db_missing"
          ? "IP-geo off — DB missing"
          : geo.status === "stale"
            ? "GeoLite2 stale (14+ days)"
            : "IP-geo error";
  const detail =
    geo.status === "no_license"
      ? "MAXMIND_LICENSE_KEY is not set. Visitors without a ship_country cookie fall through to US."
      : geo.status === "db_missing"
        ? "GeoLite2 DB is missing. Fail-to-US until the file is downloaded. Consider a volume on GEOIP_DB_PATH."
        : geo.status === "stale"
          ? `DB is ${geo.ageDays ?? "?"} days old. Lookups still run; refresh or mount a volume on GEOIP_DB_PATH so deploys do not re-download.`
          : geo.status === "error"
            ? geo.lastError || "GeoLite2 reader failed to open."
            : `DB age ${geo.ageDays ?? "—"} days${geo.readerOpen ? " · reader open" : ""}.`;
  return (
    <div className="space-y-2 text-sm" data-testid="geoip-status">
      <div className="flex flex-wrap items-center gap-2">
        <Badge
          variant={tone}
          className={
            geo.status === "stale" ? "bg-amber-100 text-amber-900" : undefined
          }
        >
          {label}
        </Badge>
        {geo.licenseKeyPresent ? (
          <span className="text-muted-foreground">license present</span>
        ) : (
          <span className="text-amber-800">license missing</span>
        )}
      </div>
      <p>{detail}</p>
      <p className="text-xs text-muted-foreground break-all">{geo.path}</p>
    </div>
  );
}
