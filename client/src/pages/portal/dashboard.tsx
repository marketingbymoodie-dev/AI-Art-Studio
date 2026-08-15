import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  clearCreatorPortalToken,
  creatorPortalFetch,
  formatCents,
  getCreatorPortalToken,
  type CreatorPortalProfile,
} from "@/lib/creator-portal-auth";
import { Switch } from "@/components/ui/switch";
import { CreatorPortalProfileForm } from "@/components/creators/CreatorPortalProfileForm";
import { creatorPublicName } from "@shared/creatorMarketplace";
import { Loader2 } from "lucide-react";

type StatsPayload = {
  days: Array<{
    day: string;
    visitors: number;
    generations: number;
    orders: number;
    grossCents: number;
    netContributionCents: number;
    atcCount: number;
    pageViews: number;
    genCostCents: number;
    productProfitCents: number;
  }>;
  today: StatsPayload["days"][number] | null;
  periodTotals: {
    visitors: number;
    generations: number;
    orders: number;
    grossCents: number;
    netContributionCents: number;
    atcCount: number;
    genCostCents: number;
    productProfitCents: number;
  };
  periodDays: number;
};

type OrdersPayload = {
  orders: Array<{
    id: string;
    shopifyOrderName: string | null;
    status: string;
    grossCents: number;
    productProfitCents: number;
    netContributionCents: number;
    creatorShareCents: number;
    refundCents: number;
    createdAt: string;
  }>;
};

type PerformancePayload = {
  periodDays: number;
  daily: Array<{
    day: string;
    visitors: number;
    generations: number;
    orders: number;
    grossCents: number;
    netContributionCents: number;
    atcCount: number;
  }>;
  topStyles: Array<{ name: string; count: number }>;
  topPages: Array<{ id: string; name: string; count: number }>;
  topProducts: Array<{ id: number; name: string; count: number }>;
  trafficSources: Array<{ source: string; count: number }>;
};

type RankPeriod = {
  periodType: string;
  periodKey: string;
  rank: number | null;
  ofCount: number;
  percentile: number | null;
  sharePct: number | null;
  valueCents: number;
  title: string;
  computedAt: string | null;
};

type RankPayload = {
  metricKey: string;
  periods: RankPeriod[];
};

type PortalStyle = {
  stylePresetId: number;
  name: string;
  category: string;
  creatorScope: string;
  enabled: boolean;
  available: boolean;
  currentlyAvailable: boolean;
};

function periodLabel(periodType: string): string {
  if (periodType === "daily") return "Today";
  if (periodType === "weekly") return "This week";
  if (periodType === "monthly") return "This month";
  if (periodType === "lifetime") return "Lifetime";
  return periodType;
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white px-4 py-3">
      <p className="text-xs font-medium uppercase tracking-wide text-stone-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-stone-900">{value}</p>
      {hint ? <p className="mt-1 text-xs text-stone-500">{hint}</p> : null}
    </div>
  );
}

function RankList({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ name: string; count: number }>;
}) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-stone-800">{title}</h3>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-stone-500">No data in this period yet.</p>
      ) : (
        <ol className="mt-3 space-y-2">
          {rows.map((r, i) => (
            <li key={`${r.name}-${i}`} className="flex items-center justify-between gap-3 text-sm">
              <span className="truncate text-stone-700">
                <span className="mr-2 text-stone-400">{i + 1}.</span>
                {r.name}
              </span>
              <span className="shrink-0 tabular-nums text-stone-500">{r.count}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export default function CreatorPortalDashboardPage() {
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const [days, setDays] = useState("14");
  const hasToken = !!getCreatorPortalToken();

  const meQuery = useQuery({
    queryKey: ["creator-portal-me"],
    enabled: hasToken,
    queryFn: async () => {
      const res = await creatorPortalFetch("/api/creator/me");
      if (res.status === 401 || res.status === 403) {
        clearCreatorPortalToken();
        throw new Error("auth");
      }
      if (!res.ok) throw new Error("Failed to load profile");
      const data = await res.json();
      return data.creator as CreatorPortalProfile;
    },
    retry: false,
  });

  useEffect(() => {
    if (!hasToken || meQuery.error) {
      setLocation("/portal/login");
    }
  }, [hasToken, meQuery.error, setLocation]);

  const statsQuery = useQuery({
    queryKey: ["creator-portal-stats", days],
    enabled: !!meQuery.data,
    queryFn: async () => {
      const res = await creatorPortalFetch(`/api/creator/stats?days=${days}`);
      if (!res.ok) throw new Error("Failed to load stats");
      return (await res.json()) as StatsPayload;
    },
  });

  const ordersQuery = useQuery({
    queryKey: ["creator-portal-orders"],
    enabled: !!meQuery.data,
    queryFn: async () => {
      const res = await creatorPortalFetch("/api/creator/orders?limit=20");
      if (!res.ok) throw new Error("Failed to load orders");
      return (await res.json()) as OrdersPayload;
    },
  });

  const perfQuery = useQuery({
    queryKey: ["creator-portal-performance", days],
    enabled: !!meQuery.data,
    queryFn: async () => {
      const res = await creatorPortalFetch(`/api/creator/performance?days=${days}`);
      if (!res.ok) throw new Error("Failed to load performance");
      return (await res.json()) as PerformancePayload;
    },
  });

  const rankQuery = useQuery({
    queryKey: ["creator-portal-rank"],
    enabled: !!meQuery.data,
    queryFn: async () => {
      const res = await creatorPortalFetch("/api/creator/rank");
      if (!res.ok) throw new Error("Failed to load ranks");
      return (await res.json()) as RankPayload;
    },
  });

  const stylesQuery = useQuery({
    queryKey: ["creator-portal-styles"],
    enabled: !!meQuery.data,
    queryFn: async () => {
      const res = await creatorPortalFetch("/api/creator/styles");
      if (!res.ok) throw new Error("Failed to load styles");
      return (await res.json()) as { styles: PortalStyle[] };
    },
  });

  const styleToggle = useMutation({
    mutationFn: async (params: { stylePresetId: number; enabled: boolean }) => {
      const res = await creatorPortalFetch(`/api/creator/styles/${params.stylePresetId}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: params.enabled }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to update style");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["creator-portal-styles"] });
    },
  });

  const chartData = useMemo(() => {
    const rows = [...(perfQuery.data?.daily || [])];
    return rows.map((d) => ({
      ...d,
      label: d.day.slice(5),
      net: (d.netContributionCents || 0) / 100,
    }));
  }, [perfQuery.data]);

  if (!hasToken || meQuery.isLoading || meQuery.error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-stone-50">
        <Loader2 className="h-6 w-6 animate-spin text-stone-400" />
      </div>
    );
  }

  const creator = meQuery.data!;
  const today = statsQuery.data?.today;
  const period = statsQuery.data?.periodTotals;

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-4">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-stone-500">Creator Portal</p>
            <h1 className="truncate font-serif text-xl">
              {creatorPublicName({
                username: creator.username,
                branding: creator.branding,
              })}
            </h1>
            <p className="truncate text-sm text-stone-500">@{creator.username}</p>
          </div>
          <div className="flex items-center gap-2">
            <Select value={days} onValueChange={setDays}>
              <SelectTrigger className="w-[120px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">7 days</SelectItem>
                <SelectItem value="14">14 days</SelectItem>
                <SelectItem value="30">30 days</SelectItem>
                <SelectItem value="90">90 days</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                await creatorPortalFetch("/api/creator/auth/logout", { method: "POST" }).catch(() => {});
                clearCreatorPortalToken();
                setLocation("/portal/login");
              }}
            >
              Sign out
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6">
        <Tabs defaultValue="today">
          <TabsList className="mb-6 flex h-auto flex-wrap gap-1 bg-stone-200/60 p-1">
            <TabsTrigger value="today">Today</TabsTrigger>
            <TabsTrigger value="rank">Rank</TabsTrigger>
            <TabsTrigger value="network">Network</TabsTrigger>
            <TabsTrigger value="performance">Performance</TabsTrigger>
            <TabsTrigger value="styles">Styles</TabsTrigger>
            <TabsTrigger value="profile">Profile</TabsTrigger>
          </TabsList>

          <TabsContent value="today" className="space-y-6">
            <section>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-stone-500">Today</h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Stat label="Visitors" value={String(today?.visitors ?? 0)} />
                <Stat label="Generations" value={String(today?.generations ?? 0)} />
                <Stat label="Orders" value={String(today?.orders ?? 0)} />
                <Stat
                  label="Net contribution"
                  value={formatCents(today?.netContributionCents ?? 0)}
                  hint="After COGS, fees, and AI cost"
                />
              </div>
            </section>

            <section>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-stone-500">
                Last {days} days
              </h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Stat label="Visitors" value={String(period?.visitors ?? 0)} />
                <Stat label="Sales" value={formatCents(period?.grossCents ?? 0)} />
                <Stat label="Product profit" value={formatCents(period?.productProfitCents ?? 0)} />
                <Stat label="Net contribution" value={formatCents(period?.netContributionCents ?? 0)} />
              </div>
              <p className="mt-3 text-sm text-stone-500">
                Monthly allowance: {creator.monthlyGenerationsUsed}/{creator.monthlyGenerationAllowance}
                {creator.generationMonth ? ` · ${creator.generationMonth}` : ""}
              </p>
            </section>

            <section>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-stone-500">
                Recent orders
              </h2>
              {ordersQuery.isLoading ? (
                <Loader2 className="h-5 w-5 animate-spin text-stone-400" />
              ) : (ordersQuery.data?.orders.length || 0) === 0 ? (
                <p className="text-sm text-stone-500">No attributed orders yet.</p>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
                  <table className="w-full text-left text-sm">
                    <thead className="border-b border-stone-100 text-xs uppercase text-stone-500">
                      <tr>
                        <th className="px-3 py-2 font-medium">Order</th>
                        <th className="px-3 py-2 font-medium">Status</th>
                        <th className="px-3 py-2 font-medium">Gross</th>
                        <th className="px-3 py-2 font-medium">Net</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ordersQuery.data!.orders.map((o) => (
                        <tr key={o.id} className="border-b border-stone-50 last:border-0">
                          <td className="px-3 py-2">{o.shopifyOrderName || o.id.slice(0, 8)}</td>
                          <td className="px-3 py-2 capitalize text-stone-600">{o.status.replace(/_/g, " ")}</td>
                          <td className="px-3 py-2 tabular-nums">{formatCents(o.grossCents)}</td>
                          <td className="px-3 py-2 tabular-nums">{formatCents(o.netContributionCents)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </TabsContent>

          <TabsContent value="rank" className="space-y-4">
            <p className="text-sm text-stone-600">
              Ranked by Net Creator Contribution. Only your position is shown — never other creators&apos; figures.
            </p>
            {rankQuery.isLoading ? (
              <Loader2 className="h-5 w-5 animate-spin text-stone-400" />
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {(rankQuery.data?.periods || []).map((p) => (
                  <div key={`${p.periodType}-${p.periodKey}`} className="rounded-xl border border-stone-200 bg-white p-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-stone-500">
                      {periodLabel(p.periodType)}
                    </p>
                    {p.rank != null && p.ofCount > 0 ? (
                      <>
                        <p className="mt-2 font-serif text-2xl text-stone-900">
                          #{p.rank}{" "}
                          <span className="text-base font-sans font-normal text-stone-500">
                            of {p.ofCount}
                          </span>
                        </p>
                        <p className="mt-1 text-sm font-medium text-stone-700">{p.title}</p>
                        <p className="mt-2 text-xs text-stone-500">
                          {p.percentile != null ? `Top ${Math.max(1, Math.round(p.percentile))}% · ` : ""}
                          {formatCents(p.valueCents)} contribution
                        </p>
                      </>
                    ) : (
                      <p className="mt-2 text-sm text-stone-500">No rank yet for this period.</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="network" className="space-y-4">
            {rankQuery.isLoading ? (
              <Loader2 className="h-5 w-5 animate-spin text-stone-400" />
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {(rankQuery.data?.periods || [])
                  .filter((p) => p.periodType === "monthly" || p.periodType === "lifetime")
                  .map((p) => (
                    <div key={`net-${p.periodType}`} className="rounded-xl border border-stone-200 bg-white p-4">
                      <p className="text-xs font-medium uppercase tracking-wide text-stone-500">
                        {periodLabel(p.periodType)} network share
                      </p>
                      {p.sharePct != null && p.ofCount > 0 ? (
                        <>
                          <p className="mt-2 font-serif text-2xl tabular-nums text-stone-900">
                            {p.sharePct.toFixed(1)}%
                          </p>
                          <p className="mt-1 text-sm text-stone-600">
                            of Creator Network contribution
                            {p.rank != null ? ` · rank #${p.rank} of ${p.ofCount}` : ""}
                          </p>
                          {p.percentile != null ? (
                            <p className="mt-2 text-xs text-stone-500">
                              Top {p.percentile.toFixed(1)}% of the network
                            </p>
                          ) : null}
                        </>
                      ) : (
                        <p className="mt-2 text-sm text-stone-500">No network share yet.</p>
                      )}
                    </div>
                  ))}
              </div>
            )}
            <RankList
              title="Traffic sources (this period)"
              rows={(perfQuery.data?.trafficSources || []).map((t) => ({
                name: t.source,
                count: t.count,
              }))}
            />
          </TabsContent>

          <TabsContent value="performance" className="space-y-6">
            <section className="rounded-xl border border-stone-200 bg-white p-4">
              <h2 className="text-sm font-semibold text-stone-800">Visitors over time</h2>
              <div className="mt-4 h-64 w-full">
                {perfQuery.isLoading ? (
                  <div className="flex h-full items-center justify-center">
                    <Loader2 className="h-5 w-5 animate-spin text-stone-400" />
                  </div>
                ) : chartData.length === 0 ? (
                  <p className="text-sm text-stone-500">No traffic in this period yet.</p>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="#a8a29e" />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11 }} stroke="#a8a29e" />
                      <Tooltip />
                      <Line type="monotone" dataKey="visitors" stroke="#292524" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>
            </section>

            <section className="rounded-xl border border-stone-200 bg-white p-4">
              <h2 className="text-sm font-semibold text-stone-800">Net contribution ($)</h2>
              <div className="mt-4 h-56 w-full">
                {chartData.length === 0 ? (
                  <p className="text-sm text-stone-500">No sales in this period yet.</p>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="#a8a29e" />
                      <YAxis tick={{ fontSize: 11 }} stroke="#a8a29e" />
                      <Tooltip />
                      <Bar dataKey="net" fill="#57534e" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </section>

            <div className="grid gap-4 md:grid-cols-2">
              <RankList title="Top AI styles" rows={perfQuery.data?.topStyles || []} />
              <RankList title="Top customizer pages" rows={perfQuery.data?.topPages || []} />
              <RankList title="Top products" rows={perfQuery.data?.topProducts || []} />
              <RankList
                title="Traffic sources"
                rows={(perfQuery.data?.trafficSources || []).map((t) => ({
                  name: t.source,
                  count: t.count,
                }))}
              />
            </div>
          </TabsContent>

          <TabsContent value="styles" className="space-y-4">
            <p className="text-sm text-stone-600">
              These are the styles assigned to your shop. Turning one off hides it from customers.
              Greyed styles are <span className="font-medium">Currently Unavailable</span> — that
              is an operator change, not the same as you toggling a style off.
            </p>
            {stylesQuery.isLoading ? (
              <Loader2 className="h-5 w-5 animate-spin text-stone-400" />
            ) : (stylesQuery.data?.styles.length || 0) === 0 ? (
              <p className="text-sm text-stone-500">No styles have been assigned yet.</p>
            ) : (
              <div className="space-y-3">
                {["apparel", "decor", "graphics", "all"].map((cat) => {
                  const rows = (stylesQuery.data?.styles || []).filter(
                    (s) => (s.category || "all") === cat,
                  );
                  if (rows.length === 0) return null;
                  return (
                    <section
                      key={cat}
                      className="rounded-xl border border-stone-200 bg-white p-4"
                    >
                      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-stone-500">
                        {cat}
                      </h3>
                      <ul className="space-y-3">
                        {rows.map((s) => (
                          <li
                            key={s.stylePresetId}
                            className={`flex items-center justify-between gap-3 ${
                              s.currentlyAvailable ? "" : "opacity-50"
                            }`}
                          >
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-stone-800">
                                {s.name}
                              </p>
                              {s.currentlyAvailable ? (
                                <p className="text-xs text-stone-500">
                                  {s.enabled ? "Shown to customers" : "Hidden from customers"}
                                </p>
                              ) : (
                                <p className="text-xs font-medium text-stone-500">
                                  Currently Unavailable
                                </p>
                              )}
                            </div>
                            <Switch
                              checked={s.enabled}
                              disabled={styleToggle.isPending}
                              onCheckedChange={(enabled) =>
                                styleToggle.mutate({
                                  stylePresetId: s.stylePresetId,
                                  enabled,
                                })
                              }
                            />
                          </li>
                        ))}
                      </ul>
                    </section>
                  );
                })}
              </div>
            )}
          </TabsContent>

          <TabsContent value="profile" className="rounded-xl border border-stone-200 bg-white p-5">
            <CreatorPortalProfileForm creator={creator} />
          </TabsContent>
        </Tabs>

        <p className="mt-8 text-center text-xs text-stone-400">
          Storefront:{" "}
          <Link href={`/c/${creator.username}`} className="underline-offset-2 hover:underline">
            /c/{creator.username}
          </Link>
        </p>
      </main>
    </div>
  );
}
