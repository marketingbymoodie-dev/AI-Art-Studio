import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import AdminLayout from "@/components/admin-layout";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  HELP_ARTICLE_CATEGORIES,
  HELP_ARTICLE_CATEGORY_LABELS,
  HELP_AUDIENCE_LABELS,
  HELP_AUDIENCES,
  type HelpArticleCategory,
  type HelpArticlePublic,
  type HelpAudience,
} from "@shared/support";
import { Loader2, Plus, Trash2 } from "lucide-react";

const emptyDraft = {
  title: "",
  summary: "",
  body: "",
  audience: "both" as HelpAudience,
  category: "setup" as HelpArticleCategory,
  published: false,
  sortOrder: 0,
};

export default function PlatformHowToPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [editingId, setEditingId] = useState<string | "new" | null>("new");
  const [draft, setDraft] = useState(emptyDraft);

  const list = useQuery({
    queryKey: ["/api/platform/help/articles"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/platform/help/articles");
      return res.json() as Promise<{ articles: HelpArticlePublic[] }>;
    },
  });

  const saveMut = useMutation({
    mutationFn: async () => {
      if (editingId && editingId !== "new") {
        const res = await apiRequest("PATCH", `/api/platform/help/articles/${editingId}`, draft);
        return res.json();
      }
      const res = await apiRequest("POST", "/api/platform/help/articles", draft);
      return res.json();
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["/api/platform/help/articles"] });
      qc.invalidateQueries({ queryKey: ["/api/help/articles"] });
      const article = data.article as HelpArticlePublic;
      setEditingId(article.id);
      toast({ title: "How To saved" });
    },
    onError: (err) => {
      toast({
        title: "Could not save",
        description: err instanceof Error ? err.message : "Save failed",
        variant: "destructive",
      });
    },
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/platform/help/articles/${id}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/platform/help/articles"] });
      qc.invalidateQueries({ queryKey: ["/api/help/articles"] });
      setEditingId("new");
      setDraft(emptyDraft);
      toast({ title: "Article deleted" });
    },
  });

  const articles = list.data?.articles || [];

  function startEdit(article: HelpArticlePublic) {
    setEditingId(article.id);
    setDraft({
      title: article.title,
      summary: article.summary || "",
      body: article.body,
      audience: article.audience,
      category: article.category,
      published: article.published,
      sortOrder: article.sortOrder,
    });
  }

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">How To library</h1>
          <p className="text-muted-foreground">
            Add guides as you discover things that need explaining. Creators and merchants see
            published items. Search is already on their How To pages.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-[20rem_1fr]">
          <div className="space-y-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setEditingId("new");
                setDraft(emptyDraft);
              }}
            >
              <Plus className="mr-2 h-4 w-4" />
              New article
            </Button>
            {list.isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ul className="space-y-1">
                {articles.map((a) => (
                  <li key={a.id}>
                    <button
                      type="button"
                      onClick={() => startEdit(a)}
                      className={
                        editingId === a.id
                          ? "w-full rounded-md bg-muted px-3 py-2 text-left"
                          : "w-full rounded-md px-3 py-2 text-left hover:bg-muted/60"
                      }
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium">{a.title}</span>
                        <Badge variant={a.published ? "default" : "secondary"}>
                          {a.published ? "Live" : "Draft"}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {HELP_AUDIENCE_LABELS[a.audience]} · {HELP_ARTICLE_CATEGORY_LABELS[a.category]}
                      </p>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <form
            className="space-y-4 rounded-lg border p-5"
            onSubmit={(e) => {
              e.preventDefault();
              saveMut.mutate();
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="howto-title">Title</Label>
              <Input
                id="howto-title"
                required
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Audience</Label>
                <Select
                  value={draft.audience}
                  onValueChange={(v) => setDraft({ ...draft, audience: v as HelpAudience })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {HELP_AUDIENCES.map((a) => (
                      <SelectItem key={a} value={a}>
                        {HELP_AUDIENCE_LABELS[a]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Category</Label>
                <Select
                  value={draft.category}
                  onValueChange={(v) => setDraft({ ...draft, category: v as HelpArticleCategory })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {HELP_ARTICLE_CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {HELP_ARTICLE_CATEGORY_LABELS[c]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="howto-summary">Summary</Label>
              <Input
                id="howto-summary"
                value={draft.summary}
                onChange={(e) => setDraft({ ...draft, summary: e.target.value })}
                placeholder="One-line preview"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="howto-body">Body</Label>
              <Textarea
                id="howto-body"
                required
                rows={12}
                value={draft.body}
                onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                placeholder="Write the steps in plain language."
              />
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <Switch
                  checked={draft.published}
                  onCheckedChange={(published) => setDraft({ ...draft, published })}
                />
                <Label>Published</Label>
              </div>
              <div className="flex items-center gap-2">
                <Label htmlFor="howto-sort">Sort</Label>
                <Input
                  id="howto-sort"
                  type="number"
                  className="w-20"
                  value={draft.sortOrder}
                  onChange={(e) => setDraft({ ...draft, sortOrder: Number(e.target.value) || 0 })}
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={saveMut.isPending}>
                {saveMut.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Save
              </Button>
              {editingId && editingId !== "new" ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={deleteMut.isPending}
                  onClick={() => {
                    if (confirm("Delete this How To article?")) deleteMut.mutate(editingId);
                  }}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete
                </Button>
              ) : null}
            </div>
          </form>
        </div>
      </div>
    </AdminLayout>
  );
}
