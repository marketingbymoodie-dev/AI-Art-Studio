import { useEffect, useMemo, useState } from "react";
import { useSearch } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import AdminLayout from "@/components/admin-layout";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
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
import { CREATOR_APPLICATION_STATUSES, shopNameToHandle } from "@shared/creatorMarketplace";
import { Loader2 } from "lucide-react";
import PlatformCreatorDetailDialog from "./platform-creator-detail";

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
  shopName?: string | null;
  creatorId: string | null;
  adminNotes: string | null;
  followerCount: number | null;
  whyParticipate: string | null;
  shopifyStoreUrl: string | null;
  applyTrack?: string | null;
  payoutMethod?: string | null;
  payoutDetail?: string | null;
  termsAcceptedAt?: string | null;
  createdAt: string;
};

export default function PlatformCreatorsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [status, setStatus] = useState<string>("all");
  const [q, setQ] = useState("");
  const [boardPeriod, setBoardPeriod] = useState("monthly");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [shopNameCheck, setShopNameCheck] = useState("");
  const [notes, setNotes] = useState("");

  const { data: config } = useQuery<{
    enabled: boolean;
    aiGenerationCostUsd: number;
    applicationCount: number;
    creatorCount: number;
    platformShopDomain: string | null;
    storefrontTokenConfigured?: boolean;
    emailsEnabled?: boolean;
  }>({
    queryKey: ["/api/platform/creators/config"],
  });

  const [creatorEditId, setCreatorEditId] = useState<string | null>(null);
  const [search, setSearch] = useSearch();
  const urlParams = new URLSearchParams(search);
  const urlCreator = urlParams.get("creator");
  const urlTab = urlParams.get("tab") || "overview";

  useEffect(() => {
    if (urlCreator) setCreatorEditId(urlCreator);
  }, [urlCreator]);

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
      branding: Record<string, unknown> | null;
      revenueShareCreatorPct?: number;
      shareBasis?: string;
      stats30d?: {
        visitors: number;
        generations: number;
        orders: number;
        grossCents: number;
        productProfitCents: number;
        netContributionCents: number;
      };
    }>;
  }>({
    queryKey: ["/api/platform/creators"],
  });

  const { data: leaderboard, isLoading: boardLoading } = useQuery<{
    periodType: string;
    periodKey: string;
    leaders: Array<{
      rank: number;
      ofCount: number;
      username: string | null;
      displayName: string | null;
      valueCents: number;
      sharePct: number | null;
      title: string;
    }>;
  }>({
    queryKey: ["/api/platform/creators/leaderboard", boardPeriod],
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/platform/creators/leaderboard?periodType=${encodeURIComponent(boardPeriod)}&limit=25`,
      );
      return res.json();
    },
    enabled: !!config?.enabled,
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

  useEffect(() => {
    const t = window.setTimeout(() => setShopNameCheck(username.trim()), 350);
    return () => window.clearTimeout(t);
  }, [username]);

  const previewHandle = shopNameToHandle(username);
  const { data: shopAvail } = useQuery<{
    available: boolean;
    handle?: string | null;
    error?: string;
    takenHandle?: string | null;
  }>({
    queryKey: ["/api/creators/shop-name-available", shopNameCheck, selectedId],
    queryFn: async () => {
      const params = new URLSearchParams({ name: shopNameCheck });
      if (selectedId) params.set("applicationId", selectedId);
      const res = await fetch(`/api/creators/shop-name-available?${params}`);
      return res.json();
    },
    enabled: !!selectedId && shopNameCheck.length >= 2,
  });
  const shopNameBlocked = shopAvail?.available === false;

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

  const apps = data?.applications ?? [];
  const creatorRows = creatorsData?.creators ?? [];

  return (
    <AdminLayout>
      <div className="space-y-6 p-6">
        <div>
          <h1 className="text-2xl font-bold">Creator Marketplace</h1>
          <p className="mt-1 text-sm">
            <a href="/admin/platform/landing" className="underline underline-offset-2">
              Edit public landing copy
            </a>
          </p>
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
                {config.emailsEnabled ? " · creator emails ON" : " · creator emails off"}
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

        {config?.enabled && (
          <div className="rounded-md border p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold">Creator Network leaderboard</h2>
                <p className="text-xs text-muted-foreground">
                  Net Creator Contribution · {leaderboard?.periodKey || boardPeriod}
                </p>
              </div>
              <Select value={boardPeriod} onValueChange={setBoardPeriod}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="weekly">Weekly</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="lifetime">Lifetime</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {boardLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (leaderboard?.leaders.length || 0) === 0 ? (
              <p className="text-sm text-muted-foreground">No rank snapshots yet.</p>
            ) : (
              <div className="rounded-md border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-16">Rank</TableHead>
                      <TableHead>Creator</TableHead>
                      <TableHead>Title</TableHead>
                      <TableHead>Net</TableHead>
                      <TableHead>Share</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {leaderboard!.leaders.map((row) => (
                      <TableRow key={`${row.rank}-${row.username}`}>
                        <TableCell>#{row.rank}</TableCell>
                        <TableCell>
                          {row.displayName || "—"}
                          {row.username ? (
                            <span className="ml-1 text-muted-foreground">@{row.username}</span>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-muted-foreground">{row.title}</TableCell>
                        <TableCell>
                          ${((row.valueCents || 0) / 100).toFixed(2)}
                        </TableCell>
                        <TableCell>
                          {row.sharePct != null ? `${row.sharePct.toFixed(1)}%` : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
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
                      setUsername(a.assignedUsername || a.shopName || "");
                    }}
                    data-testid={`creator-app-row-${a.id}`}
                  >
                    <TableCell>
                      <div className="font-medium">
                        {a.shopName || `${a.firstName} ${a.lastName}`}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {a.shopName
                          ? `${a.firstName} ${a.lastName} · ${a.email}`
                          : a.email}
                      </div>
                    </TableCell>
                    <TableCell>{a.niche}</TableCell>
                    <TableCell>
                      {a.applyTrack === "shopify" || a.hasShopifyStore
                        ? "Shopify merchant"
                        : "Creator"}
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
          <h2 className="text-lg font-semibold">Creators (30d rollup)</h2>
          <div className="rounded-md border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Creator</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Visitors</TableHead>
                  <TableHead>Gens</TableHead>
                  <TableHead>Orders</TableHead>
                  <TableHead>Net</TableHead>
                  <TableHead>Share</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {creatorRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-muted-foreground">
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
                      <TableCell>{c.stats30d?.visitors ?? 0}</TableCell>
                      <TableCell>
                        {c.stats30d?.generations ?? 0}
                        <span className="text-xs text-muted-foreground">
                          {" "}
                          ({c.monthlyGenerationsUsed}/{c.monthlyGenerationAllowance})
                        </span>
                      </TableCell>
                      <TableCell>{c.stats30d?.orders ?? 0}</TableCell>
                      <TableCell>
                        ${(((c.stats30d?.netContributionCents ?? 0) as number) / 100).toFixed(2)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {c.revenueShareCreatorPct ?? 100}% / {c.shareBasis || "net"}
                      </TableCell>
                      <TableCell className="text-right space-x-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setCreatorEditId(c.id)}
                        >
                          Manage
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

        <PlatformCreatorDetailDialog
          creatorId={creatorEditId}
          platformShopDomain={config?.platformShopDomain}
          initialTab={urlCreator && creatorEditId === urlCreator ? urlTab : "overview"}
          onClose={() => {
            setCreatorEditId(null);
            const next = new URLSearchParams(search);
            next.delete("creator");
            next.delete("tab");
            setSearch(next.toString());
          }}
        />

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
                  {detail.application.shopName ? (
                    <div className="mt-1">
                      Requested shop: <span className="font-medium">{detail.application.shopName}</span>
                    </div>
                  ) : null}
                  {detail.application.shopifyStoreUrl ? (
                    <div className="mt-1">Store: {detail.application.shopifyStoreUrl}</div>
                  ) : null}
                  {detail.application.payoutMethod ? (
                    <div className="mt-1">
                      Payout: {detail.application.payoutMethod}
                      {detail.application.payoutDetail ? ` · ${detail.application.payoutDetail}` : ""}
                    </div>
                  ) : null}
                  {detail.application.termsAcceptedAt ? (
                    <div className="mt-1 text-muted-foreground">
                      Terms accepted {new Date(detail.application.termsAcceptedAt).toLocaleString()}
                    </div>
                  ) : null}
                  {detail.application.whyParticipate ? (
                    <p className="mt-2 text-muted-foreground">{detail.application.whyParticipate}</p>
                  ) : null}
                </div>

                <div className="space-y-2">
                  <Label>Shop name (URL handle)</Label>
                  <Input
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Mad Clown Core"
                  />
                  <p className="text-xs text-muted-foreground">
                    Public store name — not their personal name unless that is the store name.
                    Becomes{" "}
                    <span className="font-medium">
                      {previewHandle || "…"}.aiartstudio.app
                    </span>
                    . If taken, they must pick a different name — we will not add numbers.
                  </p>
                  {shopNameBlocked ? (
                    <p className="text-xs text-destructive">{shopAvail?.error}</p>
                  ) : previewHandle ? (
                    <p className="text-xs text-muted-foreground">Handle available: {previewHandle}</p>
                  ) : null}
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={patchMutation.isPending || shopNameBlocked || !previewHandle}
                    onClick={() =>
                      patchMutation.mutate({
                        assignedUsername: username,
                        shopName: username,
                        status: "under_review",
                      })
                    }
                  >
                    Save shop name + mark under review
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
                    disabled={
                      onboardMutation.isPending ||
                      !!detail.application.creatorId ||
                      shopNameBlocked ||
                      !previewHandle
                    }
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
      </div>
    </AdminLayout>
  );
}
