import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  HELP_ARTICLE_CATEGORY_LABELS,
  type HelpArticlePublic,
} from "@shared/support";
import type { SupportFetcher } from "./SupportTicketForm";
import { BookOpen, Loader2, Search, Sparkles } from "lucide-react";

type Props = {
  audience: "creator" | "merchant";
  fetcher?: SupportFetcher;
  chrome?: "portal" | "admin";
};

export function HowToLibrary({ audience, fetcher, chrome = "admin" }: Props) {
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const load = fetcher || ((path: string) => fetch(path, { credentials: "include" }));

  const articlesQuery = useQuery({
    queryKey: ["/api/help/articles", audience],
    queryFn: async () => {
      const params = new URLSearchParams({ audience });
      const res = await load(`/api/help/articles?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to load How To");
      return res.json() as Promise<{ articles: HelpArticlePublic[] }>;
    },
  });

  const articles = useMemo(() => {
    const all = articlesQuery.data?.articles || [];
    const needle = q.trim().toLowerCase();
    if (!needle) return all;
    return all.filter((a) =>
      [a.title, a.summary, a.body, HELP_ARTICLE_CATEGORY_LABELS[a.category]]
        .filter(Boolean)
        .some((s) => String(s).toLowerCase().includes(needle)),
    );
  }, [articlesQuery.data?.articles, q]);
  const selected = useMemo(
    () => articles.find((a) => a.id === openId) || articles[0] || null,
    [articles, openId],
  );

  const shell =
    chrome === "portal"
      ? "space-y-4"
      : "space-y-4";

  return (
    <div className={shell}>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search How To…"
          className="pl-9"
        />
      </div>

      {articlesQuery.isLoading ? (
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      ) : articles.length === 0 ? (
        <div
          className={
            chrome === "portal"
              ? "rounded-xl border border-stone-200 bg-white p-5 text-sm text-stone-600"
              : "rounded-lg border p-5 text-sm text-muted-foreground"
          }
        >
          <BookOpen className="mb-2 h-5 w-5" />
          No How To articles yet. AI Art Studio will add them here as we find things that need explaining.
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
          <ul className="space-y-1">
            {articles.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => setOpenId(a.id)}
                  className={
                    selected?.id === a.id
                      ? "w-full rounded-md bg-muted px-3 py-2 text-left text-sm font-medium"
                      : "w-full rounded-md px-3 py-2 text-left text-sm hover:bg-muted/60"
                  }
                >
                  {a.title}
                </button>
              </li>
            ))}
          </ul>
          {selected ? (
            <article
              className={
                chrome === "portal"
                  ? "rounded-xl border border-stone-200 bg-white p-5"
                  : "rounded-lg border p-5"
              }
            >
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Badge variant="secondary">{HELP_ARTICLE_CATEGORY_LABELS[selected.category]}</Badge>
              </div>
              <h2 className={chrome === "portal" ? "font-serif text-2xl" : "text-2xl font-semibold"}>
                {selected.title}
              </h2>
              {selected.summary ? (
                <p className="mt-2 text-sm text-muted-foreground">{selected.summary}</p>
              ) : null}
              <div className="mt-4 whitespace-pre-wrap text-sm leading-6">{selected.body}</div>
            </article>
          ) : null}
        </div>
      )}

      <div
        className={
          chrome === "portal"
            ? "rounded-xl border border-dashed border-stone-300 bg-white/70 p-4 text-sm text-stone-600"
            : "rounded-lg border border-dashed p-4 text-sm text-muted-foreground"
        }
      >
        <p className="flex items-center gap-2 font-medium">
          <Sparkles className="h-4 w-4" />
          Coming later: in-app assistant
        </p>
        <p className="mt-1">
          Once this library is trained on how the app actually works, an assistant will be able to
          point to the right screen and suggest marketing, bundles, prompts, styles, and sub-styles.
        </p>
      </div>
    </div>
  );
}
