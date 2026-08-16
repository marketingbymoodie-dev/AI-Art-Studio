import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  SUPPORT_CATEGORY_LABELS,
  SUPPORT_STATUS_LABELS,
  type SupportReplyPublic,
  type SupportTicketPublic,
} from "@shared/support";
import type { SupportFetcher } from "./SupportTicketForm";
import { Loader2 } from "lucide-react";

type Props = {
  ticketId: number;
  detailPath: (id: number) => string;
  replyPath: (id: number) => string;
  fetcher: SupportFetcher;
  queryKey: unknown[];
  chrome?: "portal" | "admin";
  canSetStatus?: boolean;
};

function statusVariant(status: SupportTicketPublic["status"]): "default" | "secondary" | "outline" {
  if (status === "resolved" || status === "closed") return "secondary";
  if (status === "open" || status === "waiting_on_operator") return "default";
  return "outline";
}

export function SupportTicketThread({
  ticketId,
  detailPath,
  replyPath,
  fetcher,
  queryKey,
  chrome = "admin",
  canSetStatus = false,
}: Props) {
  const qc = useQueryClient();
  const [body, setBody] = useState("");
  const [status, setStatus] = useState<string>("");

  const detail = useQuery({
    queryKey: [...queryKey, ticketId],
    queryFn: async () => {
      const res = await fetcher(detailPath(ticketId));
      if (!res.ok) throw new Error("Failed to load ticket");
      return res.json() as Promise<{ ticket: SupportTicketPublic; replies: SupportReplyPublic[] }>;
    },
  });

  const replyMut = useMutation({
    mutationFn: async () => {
      const res = await fetcher(replyPath(ticketId), {
        method: "POST",
        body: JSON.stringify({ body, status: status || undefined }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Failed to send reply");
      return json;
    },
    onSuccess: () => {
      setBody("");
      qc.invalidateQueries({ queryKey });
    },
  });

  const box =
    chrome === "portal"
      ? "rounded-xl border border-stone-200 bg-white p-5 space-y-4"
      : "space-y-4";

  if (detail.isLoading) {
    return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />;
  }
  if (!detail.data) {
    return <p className="text-sm text-muted-foreground">Could not load this request.</p>;
  }

  const { ticket, replies } = detail.data;
  const snap = ticket.generationSnapshot;

  return (
    <div className={box}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {ticket.ref}
          </p>
          <h2 className={chrome === "portal" ? "font-serif text-xl" : "text-xl font-semibold"}>
            {ticket.subject}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {SUPPORT_CATEGORY_LABELS[ticket.category]}
          </p>
        </div>
        <Badge variant={statusVariant(ticket.status)}>{SUPPORT_STATUS_LABELS[ticket.status]}</Badge>
      </div>

      <article className="rounded-lg border bg-muted/40 p-3 text-sm whitespace-pre-wrap">
        {ticket.body}
      </article>

      {ticket.pageUrl ? (
        <p className="text-xs text-muted-foreground">Page: {ticket.pageUrl}</p>
      ) : null}
      {ticket.generationJobId ? (
        <p className="text-xs text-muted-foreground">Generation job: {ticket.generationJobId}</p>
      ) : null}
      {snap?.userPrompt || snap?.stylePreset ? (
        <p className="text-xs text-muted-foreground">
          {snap.stylePreset ? `Style: ${snap.stylePreset}. ` : ""}
          {snap.userPrompt ? `Prompt: ${snap.userPrompt}` : ""}
        </p>
      ) : null}

      <div className="space-y-3">
        {replies.map((r) => (
          <div
            key={r.id}
            className={
              r.authorRole === "operator"
                ? "rounded-lg border border-stone-200 bg-stone-50 p-3 text-sm"
                : "rounded-lg border p-3 text-sm"
            }
          >
            <p className="mb-1 text-xs font-medium text-muted-foreground">
              {r.authorRole === "operator" ? r.authorName || "AI Art Studio Support" : r.authorName || "You"}
              {" · "}
              {new Date(r.createdAt).toLocaleString()}
            </p>
            <p className="whitespace-pre-wrap">{r.body}</p>
          </div>
        ))}
        {replies.length === 0 ? (
          <p className="text-sm text-muted-foreground">No replies yet. Add a message below.</p>
        ) : null}
      </div>

      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (body.trim()) replyMut.mutate();
        }}
      >
        <Textarea
          rows={4}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Write a reply…"
        />
        {canSetStatus ? (
          <select
            className="h-9 rounded-md border bg-background px-3 text-sm"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">Keep current status</option>
            <option value="in_progress">In progress</option>
            <option value="waiting_on_reporter">Waiting on reporter</option>
            <option value="resolved">Resolved</option>
            <option value="closed">Closed</option>
          </select>
        ) : null}
        {replyMut.error ? (
          <p className="text-sm text-destructive">
            {replyMut.error instanceof Error ? replyMut.error.message : "Reply failed"}
          </p>
        ) : null}
        <Button type="submit" disabled={replyMut.isPending || !body.trim()}>
          {replyMut.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Send reply
        </Button>
      </form>
    </div>
  );
}
