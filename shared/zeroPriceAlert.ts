import { hasPositiveRetailPrice } from "./shopifyVariantPriceSync";

export type ZeroPriceAlertPage = {
  id: string;
  shop: string;
  title: string;
  handle: string;
  status?: string | null;
  baseProductPrice?: string | null;
  zeroPriceAlertSentAt?: Date | string | null;
};

export function pagesNeedingZeroPriceAlert(pages: ZeroPriceAlertPage[]): ZeroPriceAlertPage[] {
  return pages.filter(
    (p) =>
      p.status !== "disabled" &&
      !hasPositiveRetailPrice(p.baseProductPrice) &&
      !p.zeroPriceAlertSentAt,
  );
}

export function formatZeroPriceAlertEmail(pages: ZeroPriceAlertPage[]): {
  subject: string;
  text: string;
} {
  const lines = [
    "These customizer products were hidden from the catalog because they have no retail price ($0.00).",
    "They will stay hidden until you set prices via Resync Prices on Customizer Pages.",
    "",
  ];
  for (const p of pages) {
    const status = p.status === "active" ? "Live" : p.status === "preview" ? "Preview" : p.status || "unknown";
    lines.push(`  - ${p.title} (/pages/${p.handle}) — ${status} — shop ${p.shop}`);
  }
  const subject =
    pages.length === 1
      ? `[AppAI] "${pages[0].title}" hidden — $0.00 price`
      : `[AppAI] ${pages.length} products hidden — $0.00 price`;
  return { subject, text: lines.join("\n") };
}

export function clearZeroPriceAlertIfPriced<T extends Record<string, unknown>>(
  updates: T,
  price: string | number | null | undefined,
): T & { zeroPriceAlertSentAt?: null } {
  if (!hasPositiveRetailPrice(price)) return updates;
  return { ...updates, zeroPriceAlertSentAt: null };
}
