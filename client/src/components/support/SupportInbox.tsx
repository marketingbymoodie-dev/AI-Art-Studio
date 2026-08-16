import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import {
  SUPPORT_CATEGORY_LABELS,
  SUPPORT_STATUS_LABELS,
  type SupportTicketPublic,
} from "@shared/support";
import { SupportTicketForm, type SupportFetcher } from "./SupportTicketForm";
import { SupportTicketThread } from "./SupportTicketThread";
import { Loader2 } from "lucide-react";

type Props = {
  listPath: string;
  createPath: string;
  detailPath: (id: number) => string;
  replyPath: (id: number) => string;
  fetcher: SupportFetcher;
  queryKey: unknown[];
  chrome?: "portal" | "admin";
  defaultEmail?: string;
  emailLocked?: boolean;
  canSetStatus?: boolean;
};

export function SupportInbox({
  listPath,
  createPath,
  detailPath,
  replyPath,
  fetcher,
  queryKey,
  chrome = "admin",
  defaultEmail,
  emailLocked,
  canSetStatus,
}: Props) {
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<number | "new" | null>("new");

  const list = useQuery({
    queryKey,
    queryFn: async () => {
      const res = await fetcher(listPath);
      if (!res.ok) throw new Error("Failed to load tickets");
      return res.json() as Promise<{ tickets: SupportTicketPublic[] }>;
    },
  });

  const tickets = list.data?.tickets || [];

  return (
    <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
      <div className="space-y-2">
        <button
          type="button"
          onClick={() => setSelectedId("new")}
          className={
            selectedId === "new"
              ? "w-full rounded-md bg-muted px-3 py-2 text-left text-sm font-medium"
              : "w-full rounded-md px-3 py-2 text-left text-sm hover:bg-muted/60"
          }
        >
          + New request
        </button>
        {list.isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : tickets.length === 0 ? (
          <p className="px-3 text-sm text-muted-foreground">No requests yet.</p>
        ) : (
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
                    {SUPPORT_CATEGORY_LABELS[t.category]}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        {selectedId === "new" || selectedId == null ? (
          <SupportTicketForm
            createPath={createPath}
            fetcher={fetcher}
            chrome={chrome}
            defaultEmail={defaultEmail}
            emailLocked={emailLocked}
            onCreated={(ticket) => {
              qc.invalidateQueries({ queryKey });
              setSelectedId(ticket.id);
            }}
          />
        ) : (
          <SupportTicketThread
            ticketId={selectedId}
            detailPath={detailPath}
            replyPath={replyPath}
            fetcher={fetcher}
            queryKey={queryKey}
            chrome={chrome}
            canSetStatus={canSetStatus}
          />
        )}
      </div>
    </div>
  );
}
