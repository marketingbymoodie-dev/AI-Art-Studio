import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import AdminLayout from "@/components/admin-layout";
import { apiRequest } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Loader2 } from "lucide-react";

type Subscriber = {
  id: string;
  email: string;
  source: string;
  sourceLabel: string;
  shopDomain: string | null;
  creatorUsername: string | null;
  customerId: string | null;
  creditGranted: boolean;
  createdAt: string;
};

export default function PlatformNewsletterPage() {
  const [q, setQ] = useState("");
  const list = useQuery({
    queryKey: ["/api/platform/newsletter"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/platform/newsletter");
      return res.json() as Promise<{ subscribers: Subscriber[] }>;
    },
  });

  const rows = useMemo(() => {
    const all = list.data?.subscribers ?? [];
    const needle = q.trim().toLowerCase();
    if (!needle) return all;
    return all.filter((row) =>
      [row.email, row.sourceLabel, row.shopDomain, row.creatorUsername]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(needle)),
    );
  }, [list.data, q]);

  return (
    <AdminLayout>
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-semibold">Newsletter</h1>
          <p className="text-sm text-muted-foreground">
            Studio Art Class signups from merchant admin, creator areas, and store customers.
            Signup credits are issued by Studio, not the merchant shop quota.
          </p>
        </div>
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter by email, source, shop…"
          className="max-w-sm"
        />
        {list.isLoading ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>From</TableHead>
                <TableHead>Shop / creator</TableHead>
                <TableHead>Credit</TableHead>
                <TableHead>Joined</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground">
                    No signups yet.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.email}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{row.sourceLabel}</Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {row.creatorUsername ? `@${row.creatorUsername}` : row.shopDomain || "—"}
                    </TableCell>
                    <TableCell>
                      {row.creditGranted ? (
                        <Badge>Issued</Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">Pending</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {row.createdAt ? new Date(row.createdAt).toLocaleString() : "—"}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        )}
      </div>
    </AdminLayout>
  );
}
