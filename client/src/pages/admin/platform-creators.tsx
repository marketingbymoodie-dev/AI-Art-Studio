import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import AdminLayout from "@/components/admin-layout";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { CREATOR_APPLICATION_STATUSES, CREATOR_STATUSES } from "@shared/creatorMarketplace";
import { Loader2 } from "lucide-react";

type Application = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  socialPlatform: string;
  socialUsername: string;
  niche: string;
  hasShopifyStore: boolean;
  status: string;
  assignedUsername: string | null;
  creatorId: string | null;
  adminNotes: string | null;
  followerCount: number | null;
  whyParticipate: string | null;
  shopifyStoreUrl: string | null;
  createdAt: string;
};

export default function PlatformCreatorsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [status, setStatus] = useState<string>("all");
  const [q, setQ] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [notes, setNotes] = useState("");

  const { data: config } = useQuery<{
    enabled: boolean;
    aiGenerationCostUsd: number;
    applicationCount: number;
    creatorCount: number;
    platformShopDomain: string | null;
    storefrontTokenConfigured?: boolean;
  }>({
    queryKey: ["/api/platform/creators/config"],
  });

  const [creatorEditId, setCreatorEditId] = useState<string | null>(null);
  const [selectedPageIds, setSelectedPageIds] = useState<string[]>([]);
  const [freeGens, setFreeGens] = useState("2");
  const [monthlyAllowance, setMonthlyAllowance] = useState("250");
  const [creatorStatus, setCreatorStatus] = useState("onboarding");
  const [merchantShop, setMerchantShop] = useState("");

  const { data: creatorsData } = useQuery<{
    creators: Array<{
      id: string;
      username: string;
      displayName: string;
      status: string;
      freeGensPerCustomer: number;
      monthlyGenerationAllowance: number;
      monthlyGenerationsUsed: number;
      shopDomain: string | null;
      creatorType: string;
    }>;
  }>({
    queryKey: ["/api/platform/creators"],
  });

  const { data: assignable } = useQuery<{
    pages: Array<{
      id: string;
      shop: string;
      handle: string;
      title: string;
      baseProductTitle: string | null;
    }>;
    assigned: Array<{ customizerPageId: string }>;
  }>({
    queryKey: [
      `/api/platform/creators/${creatorEditId}/assignable-pages`,
      merchantShop,
    ],
    queryFn: async () => {
      const qs = merchantShop.trim()
        ? `?merchantShop=${encodeURIComponent(merchantShop.trim())}`
        : "";
      const res = await apiRequest(
        "GET",
        `/api/platform/creators/${creatorEditId}/assignable-pages${qs}`,
      );
      return res.json();
    },
    enabled: !!creatorEditId,
  });

  const listUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (status !== "all") params.set("status", status);
    if (q.trim()) params.set("q", q.trim());
    const qs = params.toString();
    return `/api/platform/creators/applications${qs ? `?${qs}` : ""}`;
  }, [status, q]);

  const { data, isLoading } = useQuery<{ applications: Application[] }>({
    queryKey: [listUrl],
  });

  const { data: detail } = useQuery<{
    application: Application;
    notes: Array<{ id: number; body: string; author: string | null; createdAt: string }>;
  }>({
    queryKey: [`/api/platform/creators/applications/${selectedId}`],
    enabled: !!selectedId,
  });

  const patchMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await apiRequest(
        "PATCH",
        `/api/platform/creators/applications/${selectedId}`,
        body,
      );
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [listUrl] });
      if (selectedId) {
        qc.invalidateQueries({
          queryKey: [`/api/platform/creators/applications/${selectedId}`],
        });
      }
      toast({ title: "Application updated" });
    },
    onError: (err: Error) =>
      toast({ title: "Update failed", description: err.message, variant: "destructive" }),
  });

  const onboardMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest(
        "POST",
        `/api/platform/creators/applications/${selectedId}/start-onboarding`,
        { username: username || undefined },
      );
      return res.json();
    },
    onSuccess: (data: { creator?: { username?: string } }) => {
      qc.invalidateQueries({ queryKey: [listUrl] });
      const u = data?.creator?.username;
      toast({
        title: "Onboarding started",
        description: u
          ? `Creator created. Preview: /c/${u}`
          : "Creator record created.",
      });
      setSelectedId(null);
      if (u && typeof window !== "undefined") {
        window.open(`/c/${u}`, "_blank", "noopener,noreferrer");
      }
    },
    onError: (err: Error) =>
      toast({ title: "Could not start onboarding", description: err.message, variant: "destructive" }),
  });

  const noteMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest(
        "POST",
        `/api/platform/creators/applications/${selectedId}/notes`,
        { body: notes },
      );
      return res.json();
    },
    onSuccess: () => {
      setNotes("");
      if (selectedId) {
        qc.invalidateQueries({
          queryKey: [`/api/platform/creators/applications/${selectedId}`],
        });
      }
    },
  });

  const saveCreatorMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("PATCH", `/api/platform/creators/${creatorEditId}`, {
        freeGensPerCustomer: Number(freeGens),
        monthlyGenerationAllowance: Number(monthlyAllowance),
        status: creatorStatus,
        shopDomain: merchantShop || null,
      });
      const res = await apiRequest("PUT", `/api/platform/creators/${creatorEditId}/pages`, {
        customizerPageIds: selectedPageIds,
      });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/platform/creators"] });
      toast({ title: "Creator updated" });
      setCreatorEditId(null);
    },
    onError: (err: Error) =>
      toast({ title: "Save failed", description: err.message, variant: "destructive" }),
  });

  useEffect(() => {
    if (!assignable?.assigned) return;
    setSelectedPageIds((prev) =>
      prev.length > 0 ? prev : assignable.assigned.map((a) => a.customizerPageId),
    );
  }, [assignable?.assigned]);

  const apps = data?.applications ?? [];
  const creatorRows = creatorsData?.creators ?? [];

  return (
    <AdminLayout>
      <div className="space-y-6 p-6">
        <div>
          <h1 className="text-2xl font-bold">Creator Marketplace</h1>
          <p className="text-sm text-muted-foreground">
            Applications and beta creators. Feature flag:{" "}
            <Badge variant={config?.enabled ? "default" : "secondary"}>
              {config?.enabled ? "enabled" : "disabled"}
            </Badge>
            {config ? (
              <span className="ml-2">
                · AI cost ${config.aiGenerationCostUsd.toFixed(2)}/gen · {config.applicationCount}{" "}
                applications · {config.creatorCount} creators
                {config.platformShopDomain
                  ? ` · platform shop ${config.platformShopDomain}`
                  : " · CREATOR_PLATFORM_SHOP_DOMAIN not set"}
                {config.storefrontTokenConfigured
                  ? " · Storefront token OK"
                  : " · CREATOR_PLATFORM_STOREFRONT_TOKEN missing"}
              </span>
            ) : null}
          </p>
        </div>

        {!config?.enabled && (
          <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
            Set <code className="font-mono">CREATOR_MARKETPLACE_ENABLED=true</code> on Railway
            staging to accept applications and use this queue.
          </div>
        )}

        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label>Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                {CREATOR_APPLICATION_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1 flex-1 min-w-[200px]">
            <Label>Search</Label>
            <Input
              placeholder="Email, name, niche…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              data-testid="creator-apps-search"
            />
          </div>
        </div>

        <div className="rounded-md border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Applicant</TableHead>
                <TableHead>Niche</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Submitted</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={5}>
                    <Loader2 className="h-4 w-4 animate-spin" />
                  </TableCell>
                </TableRow>
              ) : apps.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground">
                    No applications yet.
                  </TableCell>
                </TableRow>
              ) : (
                apps.map((a) => (
                  <TableRow
                    key={a.id}
                    className="cursor-pointer"
                    onClick={() => {
                      setSelectedId(a.id);
                      setUsername(a.assignedUsername || a.socialUsername || "");
                    }}
                    data-testid={`creator-app-row-${a.id}`}
                  >
                    <TableCell>
                      <div className="font-medium">
                        {a.firstName} {a.lastName}
                      </div>
                      <div className="text-xs text-muted-foreground">{a.email}</div>
                    </TableCell>
                    <TableCell>{a.niche}</TableCell>
                    <TableCell>
                      {a.hasShopifyStore ? "Shopify merchant" : "Creator"}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{a.status}</Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(a.createdAt).toLocaleDateString()}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        <div className="space-y-3">
          <h2 className="text-lg font-semibold">Creators (onboarding / beta)</h2>
          <div className="rounded-md border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Creator</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Free gens</TableHead>
                  <TableHead>Monthly</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {creatorRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-muted-foreground">
                      No creators yet — accept an application to start onboarding.
                    </TableCell>
                  </TableRow>
                ) : (
                  creatorRows.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell>
                        <div className="font-medium">{c.displayName}</div>
                        <div className="text-xs text-muted-foreground">
                          @{c.username} · {c.creatorType}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{c.status}</Badge>
                      </TableCell>
                      <TableCell>{c.freeGensPerCustomer}/customer</TableCell>
                      <TableCell>
                        {c.monthlyGenerationsUsed}/{c.monthlyGenerationAllowance}
                      </TableCell>
                      <TableCell className="text-right space-x-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setCreatorEditId(c.id);
                            setFreeGens(String(c.freeGensPerCustomer));
                            setMonthlyAllowance(String(c.monthlyGenerationAllowance));
                            setCreatorStatus(c.status);
                            setMerchantShop(c.shopDomain || "");
                            setSelectedPageIds([]);
                          }}
                        >
                          Configure
                        </Button>
                        <Button size="sm" variant="ghost" asChild>
                          <a href={`/c/${c.username}`} target="_blank" rel="noreferrer">
                            Preview
                          </a>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>

        <Dialog open={!!selectedId} onOpenChange={(o) => !o && setSelectedId(null)}>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Application review</DialogTitle>
            </DialogHeader>
            {detail?.application ? (
              <div className="space-y-4 text-sm">
                <div>
                  <div className="font-semibold">
                    {detail.application.firstName} {detail.application.lastName}
                  </div>
                  <div className="text-muted-foreground">{detail.application.email}</div>
                  <div className="mt-1">
                    {detail.application.socialPlatform}/@{detail.application.socialUsername}
                    {detail.application.followerCount != null
                      ? ` · ${detail.application.followerCount.toLocaleString()} followers`
                      : ""}
                  </div>
                  <div className="mt-1">Niche: {detail.application.niche}</div>
                  {detail.application.shopifyStoreUrl ? (
                    <div className="mt-1">Store: {detail.application.shopifyStoreUrl}</div>
                  ) : null}
                  {detail.application.whyParticipate ? (
                    <p className="mt-2 text-muted-foreground">{detail.application.whyParticipate}</p>
                  ) : null}
                </div>

                <div className="space-y-2">
                  <Label>Assigned username</Label>
                  <Input value={username} onChange={(e) => setUsername(e.target.value)} />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      patchMutation.mutate({ assignedUsername: username, status: "under_review" })
                    }
                  >
                    Save username + mark under review
                  </Button>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => patchMutation.mutate({ status: "waitlisted" })}
                  >
                    Waitlist
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => patchMutation.mutate({ status: "rejected" })}
                  >
                    Reject
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => onboardMutation.mutate()}
                    disabled={onboardMutation.isPending || !!detail.application.creatorId}
                  >
                    {onboardMutation.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : null}
                    Accept & start onboarding
                  </Button>
                </div>

                <div className="space-y-2">
                  <Label>Internal note</Label>
                  <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={!notes.trim() || noteMutation.isPending}
                    onClick={() => noteMutation.mutate()}
                  >
                    Add note
                  </Button>
                  <ul className="space-y-2 text-xs text-muted-foreground">
                    {(detail.notes || []).map((n) => (
                      <li key={n.id} className="rounded border px-2 py-1">
                        {n.body}
                        <span className="ml-2 opacity-70">
                          — {n.author} · {new Date(n.createdAt).toLocaleString()}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : (
              <Loader2 className="h-5 w-5 animate-spin" />
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setSelectedId(null)}>
                Close
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog
          open={!!creatorEditId}
          onOpenChange={(o) => {
            if (!o) setCreatorEditId(null);
          }}
        >
          <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Configure creator</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Free gens / customer</Label>
                  <Input value={freeGens} onChange={(e) => setFreeGens(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label>Monthly allowance</Label>
                  <Input
                    value={monthlyAllowance}
                    onChange={(e) => setMonthlyAllowance(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label>Status</Label>
                <Select value={creatorStatus} onValueChange={setCreatorStatus}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CREATOR_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Merchant shop (Path A, optional)</Label>
                <Input
                  placeholder="their-store.myshopify.com"
                  value={merchantShop}
                  onChange={(e) => setMerchantShop(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Path B uses platform shop pages. Path A can also list pages from the
                  merchant&apos;s shop if set.
                </p>
              </div>
              <div className="space-y-2">
                <Label>Assign customizer pages</Label>
                {!assignable ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (assignable.pages || []).length === 0 ? (
                  <p className="text-muted-foreground">
                    No customizer pages found on the platform shop
                    {config?.platformShopDomain ? ` (${config.platformShopDomain})` : ""}.
                    Create Live pages under Customizer Pages on that shop first.
                  </p>
                ) : (
                  <div className="max-h-56 space-y-2 overflow-y-auto rounded border p-2">
                    {(assignable.pages || []).map((p) => {
                      const checked = selectedPageIds.includes(p.id);
                      return (
                        <label
                          key={p.id}
                          className="flex cursor-pointer items-start gap-2 rounded px-1 py-1 hover:bg-muted/40"
                        >
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(v) => {
                              setSelectedPageIds((prev) =>
                                v ? [...prev, p.id] : prev.filter((id) => id !== p.id),
                              );
                            }}
                          />
                          <span>
                            <span className="font-medium">{p.title}</span>
                            <span className="block text-xs text-muted-foreground">
                              {p.shop} · /{p.handle}
                              {p.baseProductTitle ? ` · ${p.baseProductTitle}` : ""}
                            </span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}
                {assignable?.assigned?.length && selectedPageIds.length === 0 ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() =>
                      setSelectedPageIds(assignable.assigned.map((a) => a.customizerPageId))
                    }
                  >
                    Load currently assigned
                  </Button>
                ) : null}
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreatorEditId(null)}>
                Cancel
              </Button>
              <Button
                onClick={() => saveCreatorMutation.mutate()}
                disabled={saveCreatorMutation.isPending}
              >
                {saveCreatorMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                Save
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AdminLayout>
  );
}
