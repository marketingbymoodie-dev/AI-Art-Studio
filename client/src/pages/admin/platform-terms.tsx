import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import AdminLayout from "@/components/admin-layout";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  DEFAULT_TERMS_CONTENT,
  TERMS_CHECKBOX_FIELDS,
  TERMS_SECTION_IDS,
  TERMS_SECTION_META,
  formatTermsDate,
  type TermsContent,
  type TermsSectionId,
} from "@shared/termsContent";
import { Copy, Loader2 } from "lucide-react";

type Tab = "page" | TermsSectionId | "checkboxes" | "addendum";

export default function PlatformTermsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("page");
  const [draft, setDraft] = useState<TermsContent>(DEFAULT_TERMS_CONTENT);

  const { data, isLoading } = useQuery<{ content: TermsContent }>({
    queryKey: ["/api/platform/terms"],
  });

  useEffect(() => {
    if (data?.content) setDraft(data.content);
  }, [data]);

  const save = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PUT", "/api/platform/terms", { content: draft });
      return res.json() as Promise<{ content: TermsContent }>;
    },
    onSuccess: (body) => {
      setDraft(body.content);
      qc.invalidateQueries({ queryKey: ["/api/platform/terms"] });
      qc.invalidateQueries({ queryKey: ["/api/terms"] });
      toast({
        title: "Terms saved",
        description: `Public /terms, apply checkboxes, and the storefront accept line now use revision ${body.content.revision} (${formatTermsDate(body.content.lastUpdated)}).`,
      });
    },
    onError: (err: Error) => {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    },
  });

  const copyAddendum = async () => {
    try {
      await navigator.clipboard.writeText(draft.merchantStoreAddendum);
      toast({ title: "Copied", description: "Paste this into a merchant’s Shopify Terms of service yourself." });
    } catch {
      toast({ title: "Copy failed", description: "Select the text and copy it manually.", variant: "destructive" });
    }
  };

  const tabs: Array<[Tab, string]> = [
    ["page", "Page intro"],
    ...TERMS_SECTION_IDS.map((id) => [id, TERMS_SECTION_META[id].nav] as [Tab, string]),
    ["checkboxes", "Checkboxes"],
    ["addendum", "Merchant paste-in"],
  ];

  return (
    <AdminLayout>
      <div className="space-y-6 p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Terms of Use</h1>
            <p className="text-sm text-muted-foreground max-w-2xl">
              Edit the live AI Art Studio terms. Saving updates `/terms`, creator/merchant apply
              checkboxes, and the storefront generate accept line, and stamps today’s date. The
              merchant paste-in block is a copy helper only — it does not change text already on
              their Shopify policy pages.
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              Current public version: {formatTermsDate(draft.lastUpdated)} · revision {draft.revision}
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" asChild>
              <a href="/terms" target="_blank" rel="noreferrer">
                Preview /terms
              </a>
            </Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {tabs.map(([id, label]) => (
            <Button key={id} variant={tab === id ? "default" : "outline"} size="sm" onClick={() => setTab(id)}>
              {label}
            </Button>
          ))}
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : tab === "page" ? (
          <div className="grid gap-4 max-w-3xl">
            <div className="space-y-2">
              <Label htmlFor="pageTitle">Page title</Label>
              <Input
                id="pageTitle"
                value={draft.pageTitle}
                onChange={(e) => setDraft((d) => ({ ...d, pageTitle: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="intro">Intro</Label>
              <Textarea
                id="intro"
                rows={8}
                value={draft.intro}
                onChange={(e) => setDraft((d) => ({ ...d, intro: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">
                Use a blank line between paragraphs. `## Heading` and `- bullet` are supported.
              </p>
            </div>
          </div>
        ) : tab === "checkboxes" ? (
          <div className="grid gap-4 max-w-3xl">
            {TERMS_CHECKBOX_FIELDS.map(([key, label]) => (
              <div key={key} className="space-y-2">
                <Label htmlFor={key}>{label}</Label>
                <Textarea
                  id={key}
                  rows={key === "readFullTermsLabel" ? 2 : 4}
                  value={draft.checkboxes[key]}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      checkboxes: { ...d.checkboxes, [key]: e.target.value },
                    }))
                  }
                />
              </div>
            ))}
          </div>
        ) : tab === "addendum" ? (
          <div className="grid gap-3 max-w-3xl">
            <p className="text-sm text-muted-foreground">
              Reference only. Merchants (and the platform shop) must paste this into Shopify →
              Settings → Policies → Terms of service. Saving here updates this helper and the
              merchant Settings copy button. It does not rewrite their live store policy.
            </p>
            <div className="flex justify-end">
              <Button type="button" variant="outline" size="sm" onClick={copyAddendum}>
                <Copy className="mr-2 h-4 w-4" />
                Copy addendum
              </Button>
            </div>
            <Textarea
              rows={22}
              value={draft.merchantStoreAddendum}
              onChange={(e) => setDraft((d) => ({ ...d, merchantStoreAddendum: e.target.value }))}
            />
          </div>
        ) : (
          <SectionEditor
            sectionId={tab}
            section={draft.sections[tab]}
            onChange={(section) =>
              setDraft((d) => ({
                ...d,
                sections: { ...d.sections, [tab]: section },
              }))
            }
          />
        )}
      </div>
    </AdminLayout>
  );
}

function SectionEditor({
  sectionId,
  section,
  onChange,
}: {
  sectionId: TermsSectionId;
  section: TermsContent["sections"][TermsSectionId];
  onChange: (next: TermsContent["sections"][TermsSectionId]) => void;
}) {
  return (
    <div className="grid gap-4 max-w-3xl">
      <div className="space-y-2">
        <Label htmlFor={`${sectionId}-title`}>Section title</Label>
        <Input
          id={`${sectionId}-title`}
          value={section.title}
          onChange={(e) => onChange({ ...section, title: e.target.value })}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${sectionId}-body`}>Body</Label>
        <Textarea
          id={`${sectionId}-body`}
          rows={22}
          value={section.body}
          onChange={(e) => onChange({ ...section, body: e.target.value })}
        />
        <p className="text-xs text-muted-foreground">
          `## Heading`, `- bullet`, blank-line paragraphs, and `[label](/privacy)` links.
        </p>
      </div>
    </div>
  );
}
