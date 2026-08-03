import { useQuery } from "@tanstack/react-query";
import { isShopifyEmbedded } from "@/lib/shopify";
import { useAuth } from "@/hooks/use-auth";

export type SetupNextStep = "enable_embed" | "choose_product" | "connect_printify" | "done";

export interface MerchantSetupStatus {
  trialActive: boolean;
  embedEnabledGuess: boolean;
  printifyConnected: boolean;
  pagesCount: number;
  activePagesCount: number;
  planName: string | null;
  planStatus: string | null;
  quota: { used: number; limit: number | null; plan: string | null };
  nextStep: SetupNextStep;
}

/** Shared setup-rail status query — used by both /admin/setup and the daily Printify nag modal. */
export function useSetupStatus() {
  const { isAuthenticated } = useAuth();
  const embedded = isShopifyEmbedded();
  return useQuery<MerchantSetupStatus>({
    queryKey: ["/api/appai/setup/status"],
    enabled: isAuthenticated || embedded,
    staleTime: 15_000,
  });
}
