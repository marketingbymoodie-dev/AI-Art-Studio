import { useQuery } from "@tanstack/react-query";
import { isShopifyEmbedded } from "@/lib/shopify";
import { useAuth } from "@/hooks/use-auth";

export type SetupNextStep = "connect_shopify" | "enable_embed" | "choose_product" | "connect_printify" | "done";

export interface MerchantSetupStatus {
  trialActive: boolean;
  embedEnabledGuess: boolean;
  printifyConnected: boolean;
  pagesCount: number;
  activePagesCount: number;
  productTypesCount?: number;
  planName: string | null;
  planStatus: string | null;
  quota: { used: number; limit: number | null; plan: string | null };
  nextStep: SetupNextStep;
  shopAuthorized?: boolean;
  reconnectUrl?: string | null;
  themeEditorUrl?: string | null;
  themeEditorShopifyUrl?: string | null;
  isCreatorCheckoutShop?: boolean;
  carrierShipping?: { ok: boolean; reason?: string } | null;
}

/** Fresh install: still need store access or the theme embed. Printify can wait. */
export function needsFirstRunSetup(status: MerchantSetupStatus | undefined): boolean {
  if (!status) return true;
  if (status.isCreatorCheckoutShop) {
    return status.shopAuthorized === false || status.nextStep === "connect_shopify";
  }
  return (
    status.shopAuthorized === false ||
    status.nextStep === "connect_shopify" ||
    status.nextStep === "enable_embed"
  );
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
