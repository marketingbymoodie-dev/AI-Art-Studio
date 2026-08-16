import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  ticketNeedsErrorContext,
  ticketNeedsGenerationId,
  type SupportCategory,
  type SupportTicketPublic,
} from "@shared/support";
import { Loader2 } from "lucide-react";

export type SupportFetcher = (path: string, init?: RequestInit) => Promise<Response>;

type Props = {
  createPath: string;
  fetcher: SupportFetcher;
  chrome?: "portal" | "admin";
  defaultEmail?: string;
  emailLocked?: boolean;
  onCreated: (ticket: SupportTicketPublic) => void;
};

export function SupportTicketForm({
  createPath,
  fetcher,
  chrome = "admin",
  defaultEmail = "",
  emailLocked = false,
  onCreated,
}: Props) {
  const [category, setCategory] = useState<SupportCategory>("setup_help");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [email, setEmail] = useState(defaultEmail);
  const [pageUrl, setPageUrl] = useState("");
  const [generationJobId, setGenerationJobId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const box =
    chrome === "portal"
      ? "rounded-xl border border-stone-200 bg-white p-5 space-y-4"
      : "space-y-4";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const res = await fetcher(createPath, {
        method: "POST",
        body: JSON.stringify({
          category,
          subject,
          body,
          reporterEmail: email || defaultEmail,
          pageUrl: pageUrl || (typeof window !== "undefined" ? window.location.href : ""),
          userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
          generationJobId: generationJobId.trim() || null,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not send request");
      onCreated(json.ticket as SupportTicketPublic);
      setSubject("");
      setBody("");
      setPageUrl("");
      setGenerationJobId("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send request");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className={box} onSubmit={submit}>
      <div>
        <h2 className={chrome === "portal" ? "font-serif text-lg" : "text-lg font-semibold"}>
          New request
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          We can see and reply to each other in this thread. You will also get an email when we answer.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="support-category">Type</Label>
          <Select value={category} onValueChange={(v) => setCategory(v as SupportCategory)}>
            <SelectTrigger id="support-category">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SUPPORT_CATEGORIES.map((c) => (
                <SelectItem key={c} value={c}>
                  {SUPPORT_CATEGORY_LABELS[c]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="support-email">Contact email</Label>
          <Input
            id="support-email"
            type="email"
            required
            value={email || defaultEmail}
            onChange={(e) => setEmail(e.target.value)}
            disabled={emailLocked}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="support-subject">Subject</Label>
        <Input
          id="support-subject"
          required
          maxLength={120}
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Short summary"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="support-body">Details</Label>
        <Textarea
          id="support-body"
          required
          minLength={8}
          rows={6}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="What happened, what you expected, and how to reproduce it if you can."
        />
      </div>

      {ticketNeedsErrorContext(category) ? (
        <div className="space-y-2">
          <Label htmlFor="support-page">Page or screen</Label>
          <Input
            id="support-page"
            value={pageUrl}
            onChange={(e) => setPageUrl(e.target.value)}
            placeholder="Which page were you on?"
          />
        </div>
      ) : null}

      {ticketNeedsGenerationId(category) ? (
        <div className="space-y-2">
          <Label htmlFor="support-job">Generation job ID (optional)</Label>
          <Input
            id="support-job"
            value={generationJobId}
            onChange={(e) => setGenerationJobId(e.target.value)}
            placeholder="Paste a job id if you have one — not required"
          />
          <p className="text-xs text-muted-foreground">
            Form-only for now. There is no customer-facing “Report this result” button.
          </p>
        </div>
      ) : null}

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <Button type="submit" disabled={saving}>
        {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
        Send request
      </Button>
    </form>
  );
}
