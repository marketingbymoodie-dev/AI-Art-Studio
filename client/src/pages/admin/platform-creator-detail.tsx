import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import {
  CREATOR_SHARE_BASES,
  CREATOR_STATUSES,
} from "@shared/creatorMarketplace";
import { CreatorProfileImageField } from "@/components/creators/CreatorProfileImageField";
import { Loader2 } from "lucide-react";

type AssignablePage = {
  id: string;
  shop: string;
  handle: string;
  title: string;
  baseProductTitle: string | null;
};

type Props = {
  creatorId: string | null;
  platformShopDomain?: string | null;
  onClose: () => void;
};

function cents(n: number | null | undefined) {
  return `$${((n || 0) / 100).toFixed(2)}`;
}

export default function PlatformCreatorDetailDialog({
  creatorId,
  platformShopDomain,
  onClose,
}: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [freeGens, setFreeGens] = useState("2");
  const [monthlyAllowance, setMonthlyAllowance] = useState("250");
  const [creatorStatus, setCreatorStatus] = useState("onboarding");
  const [merchantShop, setMerchantShop] = useState("");
  const [shopName, setShopName] = useState("");
  const [shopDescription, setShopDescription] = useState("");
  const [bio, setBio] = useState("");
  const [profileImageUrl, setProfileImageUrl] = useState("");
  const [backgroundImageUrl, setBackgroundImageUrl] = useState("");
  const [shareBasis, setShareBasis] = useState("net_contribution");
  const [creatorPct, setCreatorPct] = useState("100");
  const [aasPct, setAasPct] = useState("0");
  const [betaEnd, setBetaEnd] = useState("");
  const [selectedPageIds, setSelectedPageIds] = useState<string[]>([]);
  const [noteBody, setNoteBody] = useState("");
  const [payoutDollars, setPayoutDollars] = useState("");
  const [payoutMethod, setPayoutMethod] = useState("manual");
  const [payoutNote, setPayoutNote] = useState("");
  const [catalogPickIds, setCatalogPickIds] = useState<number[]>([]);

  const { data, isLoading } = useQuery<{
    creator: any;
    assigned: Array<{ customizerPageId: string }>;
    payoutSummary: {
      earnedShareCents: number;
      paidOutCents: number;
      pendingPayoutCents: number;
      outstandingCents: number;
    };
    notes: Array<{ id: number; body: string; author: string | null; createdAt: string }>;
    emails: Array<{
      id: number;
      templateKey: string;
      status: string;
      recipient: string;
      createdAt: string;
    }>;
  }>({
    queryKey: [`/api/platform/creators/${creatorId}`],
    enabled: !!creatorId,
  });

  const { data: assignable } = useQuery<{
    pages: AssignablePage[];
    assigned: Array<{ customizerPageId: string }>;
  }>({
    queryKey: [`/api/platform/creators/${creatorId}/assignable-pages`, merchantShop],
    queryFn: async () => {
      const qs = merchantShop.trim()
        ? `?merchantShop=${encodeURIComponent(merchantShop.trim())}`
        : "";
      const res = await apiRequest(
        "GET",
        `/api/platform/creators/${creatorId}/assignable-pages${qs}`,
      );
      return res.json();
    },
    enabled: !!creatorId,
  });

  const { data: ordersData } = useQuery<{
    orders: Array<{
      id: string;
      shopifyOrderId: string;
      grossCents: number;
      productProfitCents: number;
      netContributionCents: number;
      creatorShareCents: number;
      aasShareCents: number;
      refundCents: number;
      createdAt: string;
      lines: Array<{ quantity: number; unitRevenueCents: number }>;
    }>;
  }>({
    queryKey: [`/api/platform/creators/${creatorId}/orders`],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/platform/creators/${creatorId}/orders?limit=20`);
      return res.json();
    },
    enabled: !!creatorId,
  });

  const { data: payoutsData, refetch: refetchPayouts } = useQuery<{
    summary: {
      earnedShareCents: number;
      paidOutCents: number;
      pendingPayoutCents: number;
      outstandingCents: number;
    };
    payouts: Array<{
      id: string;
      amountCents: number;
      method: string | null;
      status: string;
      adminNote: string | null;
      paidAt: string | null;
      createdAt: string;
    }>;
  }>({
    queryKey: [`/api/platform/creators/${creatorId}/payouts`],
    enabled: !!creatorId,
  });

  const {
    data: styleCatalog,
    isLoading: catalogLoading,
    isError: catalogError,
  } = useQuery<{
    shop: string | null;
    merchantId: string | null;
    styles: Array<{
      id: number;
      name: string;
      category: string;
      creatorScope: string;
      isActive: boolean;
    }>;
  }>({
    queryKey: ["/api/platform/style-catalog", "v2"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/platform/style-catalog");
      return res.json();
    },
    enabled: !!creatorId,
  });

  const { data: assignedStyles, refetch: refetchStyles } = useQuery<{
    styles: Array<{
      stylePresetId: number;
      name: string;
      category: string;
      creatorScope: string;
      enabled: boolean;
      available: boolean;
      currentlyAvailable: boolean;
      isActive: boolean;
    }>;
  }>({
    queryKey: [`/api/platform/creators/${creatorId}/styles`],
    enabled: !!creatorId,
  });

  useEffect(() => {
    const c = data?.creator;
    if (!c) return;
    setFreeGens(String(c.freeGensPerCustomer ?? 2));
    setMonthlyAllowance(String(c.monthlyGenerationAllowance ?? 250));
    setCreatorStatus(c.status || "onboarding");
    setMerchantShop(c.shopDomain || "");
    setShareBasis(c.shareBasis || "net_contribution");
    setCreatorPct(String(c.revenueShareCreatorPct ?? 100));
    setAasPct(String(c.revenueShareAasPct ?? 0));
    setBetaEnd(c.betaEndAt ? String(c.betaEndAt).slice(0, 10) : "");
    const b = c.branding || {};
    setShopName(typeof b.headline === "string" ? b.headline : "");
    setShopDescription(typeof b.description === "string" ? b.description : "");
    setBio(typeof c.bio === "string" ? c.bio : "");
    setProfileImageUrl(typeof c.profileImageUrl === "string" ? c.profileImageUrl : "");
    setBackgroundImageUrl(
      typeof b.backgroundImageUrl === "string" ? b.backgroundImageUrl : "",
    );
    setSelectedPageIds((data.assigned || []).map((a) => a.customizerPageId));
  }, [data?.creator?.id, data?.assigned]);

  useEffect(() => {
    if (!assignable?.assigned?.length) return;
    setSelectedPageIds((prev) =>
      prev.length > 0 ? prev : assignable.assigned.map((a) => a.customizerPageId),
    );
  }, [assignable?.assigned]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("PATCH", `/api/platform/creators/${creatorId}`, {
        freeGensPerCustomer: Number(freeGens),
        monthlyGenerationAllowance: Number(monthlyAllowance),
        status: creatorStatus,
        shopDomain: merchantShop || null,
        shopName,
        shopDescription,
        bio,
        profileImageUrl: profileImageUrl || null,
        backgroundImageUrl: backgroundImageUrl || null,
        shareBasis,
        revenueShareCreatorPct: Number(creatorPct),
        revenueShareAasPct: Number(aasPct),
        betaEndAt: betaEnd || null,
      });
      await apiRequest("PUT", `/api/platform/creators/${creatorId}/pages`, {
        customizerPageIds: selectedPageIds,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/platform/creators"] });
      qc.invalidateQueries({ queryKey: [`/api/platform/creators/${creatorId}`] });
      toast({ title: "Creator saved" });
    },
    onError: (err: Error) =>
      toast({ title: "Save failed", description: err.message, variant: "destructive" }),
  });

  const actionMutation = useMutation({
    mutationFn: async (action: string) => {
      const res = await apiRequest("POST", `/api/platform/creators/${creatorId}/actions`, {
        action,
        extendDays: action === "extend_beta" ? 30 : undefined,
      });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/platform/creators"] });
      qc.invalidateQueries({ queryKey: [`/api/platform/creators/${creatorId}`] });
      toast({ title: "Status updated" });
    },
    onError: (err: Error) =>
      toast({ title: "Action failed", description: err.message, variant: "destructive" }),
  });

  const payoutMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/platform/creators/${creatorId}/payouts`, {
        amountDollars: Number(payoutDollars),
        method: payoutMethod,
        adminNote: payoutNote || null,
        markPaid: true,
      });
      return res.json();
    },
    onSuccess: () => {
      setPayoutDollars("");
      setPayoutNote("");
      refetchPayouts();
      qc.invalidateQueries({ queryKey: [`/api/platform/creators/${creatorId}`] });
      toast({ title: "Payout recorded" });
    },
    onError: (err: Error) =>
      toast({ title: "Payout failed", description: err.message, variant: "destructive" }),
  });

  const noteMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/platform/creators/${creatorId}/notes`, {
        body: noteBody,
      });
      return res.json();
    },
    onSuccess: () => {
      setNoteBody("");
      qc.invalidateQueries({ queryKey: [`/api/platform/creators/${creatorId}`] });
    },
  });

  const invalidateStyles = () => {
    qc.invalidateQueries({ queryKey: [`/api/platform/creators/${creatorId}/styles`] });
    qc.invalidateQueries({ queryKey: ["/api/platform/style-catalog"] });
  };

  const assignStylesMutation = useMutation({
    mutationFn: async (stylePresetIds: number[]) => {
      const res = await apiRequest("POST", `/api/platform/creators/${creatorId}/styles/assign`, {
        stylePresetIds,
      });
      return res.json();
    },
    onSuccess: () => {
      setCatalogPickIds([]);
      invalidateStyles();
      toast({ title: "Styles assigned" });
    },
    onError: (err: Error) =>
      toast({ title: "Assign failed", description: err.message, variant: "destructive" }),
  });

  const retireStylesMutation = useMutation({
    mutationFn: async (stylePresetIds: number[]) => {
      const res = await apiRequest("POST", `/api/platform/creators/${creatorId}/styles/retire`, {
        stylePresetIds,
      });
      return res.json();
    },
    onSuccess: () => {
      refetchStyles();
      toast({ title: "Style marked unavailable" });
    },
    onError: (err: Error) =>
      toast({ title: "Retire failed", description: err.message, variant: "destructive" }),
  });

  const duplicateStyleMutation = useMutation({
    mutationFn: async (sourceStylePresetId: number) => {
      const res = await apiRequest("POST", `/api/platform/creators/${creatorId}/styles/duplicate`, {
        sourceStylePresetId,
      });
      return res.json();
    },
    onSuccess: () => {
      invalidateStyles();
      toast({ title: "Custom style created and assigned" });
    },
    onError: (err: Error) =>
      toast({ title: "Duplicate failed", description: err.message, variant: "destructive" }),
  });

  const c = data?.creator;
  const summary = data?.payoutSummary || payoutsData?.summary;

  return (
    <Dialog open={!!creatorId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {c ? (
              <span>
                {c.displayName}{" "}
                <span className="text-muted-foreground font-normal">@{c.username}</span>
              </span>
            ) : (
              "Creator detail"
            )}
          </DialogTitle>
        </DialogHeader>

        {isLoading || !c ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : (
          <Tabs defaultValue="overview" className="space-y-3">
            <TabsList className="flex h-auto flex-wrap gap-1">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="partner">Partner / beta</TabsTrigger>
              <TabsTrigger value="financials">Financials</TabsTrigger>
              <TabsTrigger value="payouts">Payouts</TabsTrigger>
              <TabsTrigger value="notes">Notes</TabsTrigger>
              <TabsTrigger value="styles">Styles</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="space-y-4 text-sm">
              <div className="flex flex-wrap gap-2 items-center">
                <Badge variant="outline">{c.status}</Badge>
                <Badge variant="secondary">{c.creatorType}</Badge>
                <Button size="sm" variant="ghost" asChild>
                  <a href={`/c/${c.username}`} target="_blank" rel="noreferrer">
                    Preview shop
                  </a>
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Public pages show the shop name (handle), never the legal name, unless it is
                typed into About.
              </p>
              <div className="space-y-1">
                <Label>Shop name (public handle)</Label>
                <Input
                  value={shopName}
                  onChange={(e) => setShopName(e.target.value)}
                  placeholder={c.username}
                />
              </div>
              <div className="space-y-1">
                <Label>Shop description</Label>
                <Textarea
                  rows={2}
                  value={shopDescription}
                  onChange={(e) => setShopDescription(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label>About</Label>
                <Textarea
                  rows={4}
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  placeholder="Shown on the About page. Legal name only appears if typed here."
                />
              </div>
              <CreatorProfileImageField
                label="Profile avatar"
                hint="Shown in the shop header and home page."
                value={profileImageUrl}
                onChange={setProfileImageUrl}
                previewClassName="h-16 w-16 rounded-full object-cover border"
              />
              <CreatorProfileImageField
                label="Home background"
                hint="Wide image behind the shop name on the main page."
                value={backgroundImageUrl}
                onChange={setBackgroundImageUrl}
                previewClassName="h-16 w-28 rounded-md object-cover border"
              />
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
                <Label>Merchant shop (Path A)</Label>
                <Input
                  placeholder="their-store.myshopify.com"
                  value={merchantShop}
                  onChange={(e) => setMerchantShop(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Assign customizer pages</Label>
                {!assignable ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (assignable.pages || []).length === 0 ? (
                  <p className="text-muted-foreground">
                    No pages on platform shop
                    {platformShopDomain ? ` (${platformShopDomain})` : ""}.
                  </p>
                ) : (
                  <div className="max-h-48 space-y-2 overflow-y-auto rounded border p-2">
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
                            </span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
              <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
                {saveMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                Save overview
              </Button>
            </TabsContent>

            <TabsContent value="partner" className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Share basis</Label>
                  <Select value={shareBasis} onValueChange={setShareBasis}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CREATOR_SHARE_BASES.map((b) => (
                        <SelectItem key={b} value={b}>
                          {b}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Beta end (UTC date)</Label>
                  <Input
                    type="date"
                    value={betaEnd}
                    onChange={(e) => setBetaEnd(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label>Creator share %</Label>
                  <Input value={creatorPct} onChange={(e) => setCreatorPct(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label>AppAI share %</Label>
                  <Input value={aasPct} onChange={(e) => setAasPct(e.target.value)} />
                </div>
              </div>
              <Button
                size="sm"
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending}
              >
                Save partner settings
              </Button>
              <div className="flex flex-wrap gap-2 pt-2">
                {(
                  [
                    ["reactivate_beta", "Start / reactivate beta"],
                    ["extend_beta", "Extend +30d"],
                    ["end_beta", "End beta"],
                    ["promote_partner", "Promote to partner"],
                    ["pause", "Pause"],
                    ["archive", "Archive"],
                  ] as const
                ).map(([action, label]) => (
                  <Button
                    key={action}
                    size="sm"
                    variant="outline"
                    disabled={actionMutation.isPending}
                    onClick={() => actionMutation.mutate(action)}
                  >
                    {label}
                  </Button>
                ))}
              </div>
              <div>
                <p className="text-xs font-medium mb-2">Recent emails (log)</p>
                {(data.emails || []).length === 0 ? (
                  <p className="text-muted-foreground text-xs">No emails logged yet.</p>
                ) : (
                  <ul className="space-y-1 text-xs text-muted-foreground">
                    {data.emails.map((e) => (
                      <li key={e.id}>
                        {e.templateKey} · {e.status} · {new Date(e.createdAt).toLocaleString()}
                      </li>
                    ))}
                  </ul>
                )}
                <p className="text-xs text-muted-foreground mt-2">
                  Auto-send requires <code>CREATOR_EMAILS_ENABLED=true</code> on Railway.
                </p>
              </div>
            </TabsContent>

            <TabsContent value="financials" className="space-y-3 text-sm">
              {summary ? (
                <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                  <div className="rounded border p-2">
                    <div className="text-muted-foreground">Earned share</div>
                    <div className="font-semibold">{cents(summary.earnedShareCents)}</div>
                  </div>
                  <div className="rounded border p-2">
                    <div className="text-muted-foreground">Paid out</div>
                    <div className="font-semibold">{cents(summary.paidOutCents)}</div>
                  </div>
                  <div className="rounded border p-2">
                    <div className="text-muted-foreground">Pending</div>
                    <div className="font-semibold">{cents(summary.pendingPayoutCents)}</div>
                  </div>
                  <div className="rounded border p-2">
                    <div className="text-muted-foreground">Outstanding</div>
                    <div className="font-semibold">{cents(summary.outstandingCents)}</div>
                  </div>
                </div>
              ) : null}
              <div className="rounded-md border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Order</TableHead>
                      <TableHead>Gross</TableHead>
                      <TableHead>Product $</TableHead>
                      <TableHead>Net</TableHead>
                      <TableHead>Creator</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(ordersData?.orders || []).length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-muted-foreground">
                          No ledger orders yet.
                        </TableCell>
                      </TableRow>
                    ) : (
                      ordersData!.orders.map((o) => (
                        <TableRow key={o.id}>
                          <TableCell className="text-xs max-w-[120px] truncate">
                            {o.shopifyOrderId}
                          </TableCell>
                          <TableCell>{cents(o.grossCents)}</TableCell>
                          <TableCell>{cents(o.productProfitCents)}</TableCell>
                          <TableCell>{cents(o.netContributionCents)}</TableCell>
                          <TableCell>{cents(o.creatorShareCents)}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </TabsContent>

            <TabsContent value="payouts" className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Amount (USD)</Label>
                  <Input
                    value={payoutDollars}
                    onChange={(e) => setPayoutDollars(e.target.value)}
                    placeholder="25.00"
                  />
                </div>
                <div className="space-y-1">
                  <Label>Method</Label>
                  <Input
                    value={payoutMethod}
                    onChange={(e) => setPayoutMethod(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label>Note</Label>
                <Input value={payoutNote} onChange={(e) => setPayoutNote(e.target.value)} />
              </div>
              <Button
                size="sm"
                disabled={!payoutDollars || payoutMutation.isPending}
                onClick={() => payoutMutation.mutate()}
              >
                Record paid payout
              </Button>
              <div className="rounded-md border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Amount</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Method</TableHead>
                      <TableHead>When</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(payoutsData?.payouts || []).length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4} className="text-muted-foreground">
                          No payouts recorded.
                        </TableCell>
                      </TableRow>
                    ) : (
                      payoutsData!.payouts.map((p) => (
                        <TableRow key={p.id}>
                          <TableCell>{cents(p.amountCents)}</TableCell>
                          <TableCell>
                            <Badge variant="outline">{p.status}</Badge>
                          </TableCell>
                          <TableCell>{p.method || "—"}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {new Date(p.paidAt || p.createdAt).toLocaleDateString()}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </TabsContent>

            <TabsContent value="styles" className="space-y-4 text-sm">
              <p className="text-muted-foreground text-xs">
                Hand-pick globals and customs for this creator. Unassign sets{" "}
                <span className="font-medium">Currently Unavailable</span> — the row stays so
                they can see it greyed out. Re-assign restores the offer without resetting
                their on/off.
              </p>
              <div className="space-y-2">
                <Label>Assigned</Label>
                {(assignedStyles?.styles || []).length === 0 ? (
                  <p className="text-muted-foreground text-xs">None yet — assign from the catalog below.</p>
                ) : (
                  <div className="max-h-56 space-y-2 overflow-y-auto rounded border p-2">
                    {(assignedStyles?.styles || []).map((s) => (
                      <div
                        key={s.stylePresetId}
                        className={`flex items-start justify-between gap-2 rounded px-1 py-1 ${
                          s.currentlyAvailable ? "" : "opacity-60"
                        }`}
                      >
                        <div>
                          <div className="font-medium">{s.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {s.category} · {s.creatorScope}
                            {s.currentlyAvailable ? "" : " · Currently Unavailable"}
                            {s.enabled ? "" : " · creator off"}
                          </div>
                        </div>
                        <div className="flex shrink-0 gap-1">
                          {s.currentlyAvailable ? (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={retireStylesMutation.isPending}
                              onClick={() => retireStylesMutation.mutate([s.stylePresetId])}
                            >
                              Unassign
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={assignStylesMutation.isPending}
                              onClick={() => assignStylesMutation.mutate([s.stylePresetId])}
                            >
                              Re-offer
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={duplicateStyleMutation.isPending}
                            onClick={() => duplicateStyleMutation.mutate(s.stylePresetId)}
                          >
                            Duplicate exclusive
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <Label>Catalog</Label>
                {catalogLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : catalogError ? (
                  <p className="text-muted-foreground text-xs">
                    Could not load the style catalog.
                  </p>
                ) : (styleCatalog?.styles || []).length === 0 ? (
                  <p className="text-muted-foreground text-xs">
                    No styles found
                    {styleCatalog?.shop ? ` for ${styleCatalog.shop}` : ""}.
                    Open Styles on the platform shop and confirm presets exist, then
                    refresh this tab.
                  </p>
                ) : (
                  <>
                    <div className="max-h-48 space-y-2 overflow-y-auto rounded border p-2">
                      {(styleCatalog?.styles || []).map((s) => {
                        const already = (assignedStyles?.styles || []).some(
                          (a) => Number(a.stylePresetId) === Number(s.id),
                        );
                        const checked = catalogPickIds.includes(s.id);
                        return (
                          <label
                            key={s.id}
                            className={`flex items-start gap-2 rounded px-1 py-1 ${
                              already ? "opacity-60" : "cursor-pointer hover:bg-muted/40"
                            }`}
                          >
                            <Checkbox
                              checked={already || checked}
                              disabled={already}
                              onCheckedChange={(v) => {
                                setCatalogPickIds((prev) =>
                                  v ? [...prev, s.id] : prev.filter((id) => id !== s.id),
                                );
                              }}
                            />
                            <span>
                              <span className="font-medium">{s.name}</span>
                              <span className="block text-xs text-muted-foreground">
                                {s.category} · {s.creatorScope}
                                {already ? " · assigned" : ""}
                                {s.isActive ? "" : " · catalog inactive"}
                              </span>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                    <Button
                      size="sm"
                      disabled={
                        catalogPickIds.length === 0 || assignStylesMutation.isPending
                      }
                      onClick={() => assignStylesMutation.mutate(catalogPickIds)}
                    >
                      Assign selected
                    </Button>
                  </>
                )}
              </div>
            </TabsContent>

            <TabsContent value="notes" className="space-y-3 text-sm">
              <Textarea
                rows={3}
                value={noteBody}
                onChange={(e) => setNoteBody(e.target.value)}
                placeholder="Internal note…"
              />
              <Button
                size="sm"
                disabled={!noteBody.trim() || noteMutation.isPending}
                onClick={() => noteMutation.mutate()}
              >
                Add note
              </Button>
              <ul className="space-y-2 text-xs text-muted-foreground">
                {(data.notes || []).map((n) => (
                  <li key={n.id} className="rounded border px-2 py-1">
                    {n.body}
                    <span className="ml-2 opacity-70">
                      — {n.author} · {new Date(n.createdAt).toLocaleString()}
                    </span>
                  </li>
                ))}
              </ul>
            </TabsContent>
          </Tabs>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
