import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { PricingModellerPanel } from "@/pages/admin/platform-pricing-modeller";
import PlanPicker from "@/pages/admin/plan-picker";
import { Toaster } from "@/components/ui/toaster";
import { OVERAGE_PRICE_USD } from "@shared/customizerPlans";
import "@/index.css";

function InsightsOverageProbe() {
  const { data: planCatalog } = useQuery<{ overagePriceUsd: number }>({
    queryKey: ["/api/appai/billing/plan-catalog"],
  });
  const rate = planCatalog?.overagePriceUsd ?? OVERAGE_PRICE_USD;
  return (
    <div data-testid="insights-offer-probe">
      Insights overage:{" "}
      <span data-testid="insights-overage-rate">${rate.toFixed(2)}</span>
    </div>
  );
}

function Harness() {
  return (
    <div className="p-4 space-y-10 bg-background text-foreground min-h-screen">
      <section>
        <h2 className="text-lg font-semibold mb-2">Modeller</h2>
        <PricingModellerPanel />
      </section>
      <section data-testid="plan-picker-section">
        <h2 className="text-lg font-semibold mb-2">Plan picker (offer)</h2>
        <PlanPicker inline />
      </section>
      <section>
        <h2 className="text-lg font-semibold mb-2">Insights offer probe</h2>
        <InsightsOverageProbe />
      </section>
      <Toaster />
    </div>
  );
}

const qc = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      staleTime: 0,
      queryFn: async ({ queryKey }) => {
        const url = queryKey[0] as string;
        const res = await fetch(url, { credentials: "include" });
        if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
        return res.json();
      },
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <Harness />
    </QueryClientProvider>
  </StrictMode>,
);
