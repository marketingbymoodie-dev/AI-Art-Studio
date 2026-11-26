import { useQuery } from "@tanstack/react-query";
import type { ShipsToSize } from "@shared/shipping-size-coverage";
import { API_BASE } from "@/lib/urlBase";
import { apiFetch } from "@/lib/queryClient";
import { useShipCountry } from "@/components/creators/ShipCountrySelector";

export type StorefrontSizeCoverage = {
  country: string;
  source?: string;
  productTypeId: number;
  sizes: ShipsToSize[];
};

export function useStorefrontSizeCoverage(
  productTypeId: string | number | null | undefined,
  enabled: boolean,
) {
  const ship = useShipCountry();
  const id = Number(productTypeId);
  const ready = enabled && Number.isFinite(id) && id > 0;
  return useQuery<StorefrontSizeCoverage>({
    queryKey: ["/api/storefront/size-coverage", id, ship.data?.shipCountry],
    enabled: ready,
    queryFn: async () => {
      const res = await apiFetch(
        `${API_BASE}/api/storefront/size-coverage?productTypeId=${id}`,
      );
      if (!res.ok) throw new Error("Could not load size coverage");
      return res.json();
    },
    staleTime: 30_000,
  });
}
