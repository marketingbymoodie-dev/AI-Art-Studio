import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  formatShipCountryLabel,
  SHIP_COUNTRY_OPTIONS,
  type ShipCountrySource,
} from "@shared/ship-country";
import { API_BASE } from "@/lib/urlBase";
import { apiFetch } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

export const SHIP_COUNTRY_EVENT = "appai:ship-country";

type ShipCountryResponse = {
  shipCountry: string;
  source: ShipCountrySource;
  options?: Array<{ code: string; name: string }>;
};

export function useShipCountry() {
  return useQuery<ShipCountryResponse>({
    queryKey: ["/api/storefront/ship-country"],
    queryFn: async () => {
      const res = await apiFetch(`${API_BASE}/api/storefront/ship-country`);
      if (!res.ok) throw new Error("Could not load shipping country");
      return res.json();
    },
    staleTime: 30_000,
  });
}

export function ShipCountrySelector({
  compact = false,
  className,
}: {
  compact?: boolean;
  className?: string;
}) {
  const queryClient = useQueryClient();
  const { data, isLoading } = useShipCountry();
  const country = data?.shipCountry || "US";
  const source = data?.source || "default";
  const options = data?.options?.length ? data.options : SHIP_COUNTRY_OPTIONS;
  const prominent = source === "default";

  const save = useMutation({
    mutationFn: async (next: string) => {
      const res = await apiFetch(`${API_BASE}/api/storefront/ship-country`, {
        method: "PUT",
        body: JSON.stringify({ country: next }),
      });
      if (!res.ok) throw new Error("Could not save shipping country");
      return (await res.json()) as ShipCountryResponse;
    },
    onSuccess: (json) => {
      queryClient.setQueryData(["/api/storefront/ship-country"], json);
      void queryClient.invalidateQueries({
        predicate: (q) =>
          typeof q.queryKey[0] === "string" &&
          String(q.queryKey[0]).includes("/api/creators/storefront/"),
      });
      window.dispatchEvent(
        new CustomEvent(SHIP_COUNTRY_EVENT, { detail: json }),
      );
    },
  });

  return (
    <label
      className={cn(
        "flex min-w-0 flex-col gap-0.5 text-left",
        prominent && "rounded-md ring-2 ring-amber-400 ring-offset-2",
        className,
      )}
    >
      <span
        className={cn(
          "text-[11px] font-medium uppercase tracking-wide",
          prominent ? "text-amber-800" : "text-muted-foreground",
        )}
      >
        {prominent ? "Confirm shipping country" : "Shipping to"}
      </span>
      <select
        aria-label="Shipping country"
        disabled={isLoading || save.isPending}
        value={country}
        onChange={(e) => save.mutate(e.target.value)}
        className={cn(
          "max-w-full rounded-md border bg-background px-2 py-1 text-sm",
          compact ? "h-8" : "h-9",
          prominent && "border-amber-500 font-medium",
        )}
      >
        {options.map((o) => (
          <option key={o.code} value={o.code}>
            {formatShipCountryLabel(o.code)}
          </option>
        ))}
        {options.some((o) => o.code === country) ? null : (
          <option value={country}>{formatShipCountryLabel(country)}</option>
        )}
      </select>
    </label>
  );
}
