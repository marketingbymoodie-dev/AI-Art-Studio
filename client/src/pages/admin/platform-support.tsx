import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import AdminLayout from "@/components/admin-layout";
import { SupportTicketThread } from "@/components/support/SupportTicketThread";
import { apiFetch, apiRequest } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  SUPPORT_CATEGORIES,
  SUPPORT_CATEGORY_LABELS,
  SUPPORT_SOURCES,
  SUPPORT_STATUSES,
  SUPPORT_STATUS_LABELS,
  type SupportTicketPublic,
} from "@shared/support";

export default function PlatformSupportPage() {
  const qc = useQueryClient();
  const [source, setSource] = useState("all");
  const [category, setCategory] = useState("all");
  const [status, setStatus] = useState("all");
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const listKey = ["/api/platform/support/tickets", source, category, status];
  const list = useQuery({
    queryKey: listKey,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (source !== "all") params.set("source", source);
      if (category !== "all") params.set("category", category);
      if (status !== "all") params.set("status", status);
      const res = await apiFetch(`/api/platform/support/tickets?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to load tickets");
      return res.json() as Promise<{ tickets: SupportTicketPublic[] }>;
    },
  });

  const statusMut = useMutation({
    mutationFn: async (next: string) => {
      if (!selectedId) return;
      await apiRequest("PATCH", `/api/platform/support/tickets/${selectedId}`, { status: next });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/platform/support/tickets"] });
    },
  });

  const tickets = list.data?.tickets || [];

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Support tickets</h1>
          <p className="text-muted-foreground">
            Creator portal and Shopify merchant requests. Reply in-app — they see the same thread.
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <Select value={source} onValueChange={setSource}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Source" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sources</SelectItem>
              {SUPPORT_SOURCES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s === "creator" ? "Creators" : "Merchants"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="w-[240px]">
              <SelectValue placeholder="Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {SUPPORT_CATEGORIES.map((c) => (
                <SelectItem key={c} value={c}>
                  {SUPPORT_CATEGORY_LABELS[c]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {SUPPORT_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {SUPPORT_STATUS_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-6 lg:grid-cols-[22rem_1fr]">
          <ul className="space-y-1">
            {tickets.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(t.id)}
                  className={
                    selectedId === t.id
                      ? "w-full rounded-md bg-muted px-3 py-2 text-left"
                      : "w-full rounded-md px-3 py-2 text-left hover:bg-muted/60"
                  }
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">{t.ref}</span>
                    <Badge variant="outline">{SUPPORT_STATUS_LABELS[t.status]}</Badge>
                  </div>
                  <p className="truncate text-sm font-medium">{t.subject}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {t.source === "creator" ? t.reporterName || "Creator" : t.shopDomain || "Merchant"}
                    {" · "}
                    {SUPPORT_CATEGORY_LABELS[t.category]}
                  </p>
                </button>
              </li>
            ))}
            {tickets.length === 0 ? (
              <p className="px-1 text-sm text-muted-foreground">No tickets match these filters.</p>
            ) : null}
          </ul>

          {selectedId ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                {SUPPORT_STATUSES.map((s) => (
                  <Button
                    key={s}
                    size="sm"
                    variant="outline"
                    disabled={statusMut.isPending}
                    onClick={() => statusMut.mutate(s)}
                  >
                    {SUPPORT_STATUS_LABELS[s]}
                  </Button>
                ))}
              </div>
              <SupportTicketThread
                ticketId={selectedId}
                detailPath={(id) => `/api/platform/support/tickets/${id}`}
                replyPath={(id) => `/api/platform/support/tickets/${id}/replies`}
                fetcher={apiFetch}
                queryKey={["/api/platform/support/tickets"]}
                canSetStatus
              />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Select a ticket to read and reply.</p>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}
