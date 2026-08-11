import { useMemo, useState } from "react";
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
import { CREATOR_APPLICATION_STATUSES } from "@shared/creatorMarketplace";
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
  }>({
    queryKey: ["/api/platform/creators/config"],
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [listUrl] });
      toast({ title: "Onboarding started", description: "Creator record created." });
      setSelectedId(null);
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
      </div>
    </AdminLayout>
  );
}
