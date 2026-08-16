/**
 * Founder email when a customizer page is hidden for a $0 / missing retail price.
 * Same Resend inbox as the daily OOS catalogue report. Deduped per page until
 * a positive price is written back (then a later regression can alert again).
 */
import { storage } from "./storage";
import {
  formatZeroPriceAlertEmail,
  pagesNeedingZeroPriceAlert,
  type ZeroPriceAlertPage,
} from "@shared/zeroPriceAlert";

export {
  clearZeroPriceAlertIfPriced,
  formatZeroPriceAlertEmail,
  pagesNeedingZeroPriceAlert,
} from "@shared/zeroPriceAlert";
export type { ZeroPriceAlertPage } from "@shared/zeroPriceAlert";

const TAG = "[zero-price-alert]";
const inFlight = new Set<string>();

async function sendZeroPriceEmail(pages: ZeroPriceAlertPage[]): Promise<boolean> {
  const to = (process.env.OOS_REPORT_EMAIL || process.env.FOUNDER_ALERT_EMAIL)?.trim();
  const resendKey = process.env.RESEND_API_KEY;
  if (!to || !resendKey) {
    console.warn(`${TAG} OOS_REPORT_EMAIL/FOUNDER_ALERT_EMAIL or RESEND_API_KEY not set — skipping email`);
    return false;
  }

  const { subject, text } = formatZeroPriceAlertEmail(pages);

  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "AppAI Alerts <onboarding@resend.dev>",
        to: [to],
        subject,
        text,
      }),
    });
    if (!resp.ok) {
      console.error(`${TAG} Resend error ${resp.status}:`, await resp.text());
      return false;
    }
    return true;
  } catch (err: any) {
    console.error(`${TAG} email send failed:`, err?.message ?? err);
    return false;
  }
}

/** Email once per page the first time it is hidden for a missing/$0 price. */
export async function notifyZeroRetailPricePages(pages: ZeroPriceAlertPage[]): Promise<void> {
  const pending = pagesNeedingZeroPriceAlert(pages).filter((p) => {
    if (inFlight.has(p.id)) return false;
    inFlight.add(p.id);
    return true;
  });
  if (pending.length === 0) return;

  const emailSent = await sendZeroPriceEmail(pending);
  if (emailSent) {
    const now = new Date();
    for (const p of pending) {
      try {
        await storage.updateCustomizerPage(p.id, { zeroPriceAlertSentAt: now } as any);
      } catch (e: any) {
        console.warn(`${TAG} could not mark page ${p.id} notified:`, e?.message ?? e);
        inFlight.delete(p.id);
      }
    }
  }

  try {
    await storage.insertFounderAlert({
      installationId: null,
      shopDomain: pending[0].shop,
      alertType: "zero_retail_price",
      attempts: pending.length,
      emailSent,
    });
  } catch (e: any) {
    console.warn(`${TAG} audit insert failed:`, e?.message ?? e);
  }

  console.log(
    `${TAG} ${pending.length} page(s) hidden for $0 price; emailSent=${emailSent} shop=${pending[0].shop}`,
  );
}
