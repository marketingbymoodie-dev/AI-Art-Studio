import {
  SUPPORT_CATEGORY_LABELS,
  formatTicketRef,
  type SupportCategory,
  type SupportTicketPublic,
} from "@shared/support";

const TAG = "[support-mail]";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function sendResend(params: {
  to: string;
  subject: string;
  text: string;
}): Promise<void> {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    console.warn(`${TAG} RESEND_API_KEY not set — skipping email`);
    return;
  }
  const from =
    process.env.SUPPORT_EMAIL_FROM ||
    process.env.CREATOR_EMAIL_FROM ||
    process.env.RESEND_FROM ||
    "AI Art Studio <onboarding@resend.dev>";
  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [params.to],
        subject: params.subject,
        text: params.text,
        html: `<pre style="font-family:ui-sans-serif,system-ui,sans-serif;white-space:pre-wrap">${escapeHtml(params.text)}</pre>`,
      }),
    });
    if (!resp.ok) {
      console.error(`${TAG} Resend ${resp.status}:`, await resp.text());
    }
  } catch (err: any) {
    console.error(`${TAG} send failed:`, err?.message ?? err);
  }
}

function ticketWho(ticket: SupportTicketPublic): string {
  if (ticket.source === "creator") {
    return ticket.reporterName || ticket.creatorId || ticket.reporterEmail;
  }
  return ticket.shopDomain || ticket.reporterName || ticket.reporterEmail;
}

export async function notifyFounderNewTicket(ticket: SupportTicketPublic): Promise<void> {
  const to = process.env.FOUNDER_ALERT_EMAIL?.trim();
  if (!to) return;
  const cat = SUPPORT_CATEGORY_LABELS[ticket.category as SupportCategory] || ticket.category;
  await sendResend({
    to,
    subject: `[AppAI] ${ticket.ref} · ${cat} · ${ticketWho(ticket)}`,
    text: [
      `New support ticket ${ticket.ref}`,
      `From: ${ticket.source} · ${ticketWho(ticket)} · ${ticket.reporterEmail}`,
      `Type: ${cat}`,
      `Subject: ${ticket.subject}`,
      ``,
      ticket.body,
      ticket.generationJobId ? `\nGeneration job: ${ticket.generationJobId}` : "",
      ticket.pageUrl ? `\nPage: ${ticket.pageUrl}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
  });
}

export async function notifyFounderReporterReply(params: {
  ticket: SupportTicketPublic;
  replyBody: string;
}): Promise<void> {
  const to = process.env.FOUNDER_ALERT_EMAIL?.trim();
  if (!to) return;
  await sendResend({
    to,
    subject: `[AppAI] ${params.ticket.ref} · new reply from ${ticketWho(params.ticket)}`,
    text: [
      `${params.ticket.ref} — ${params.ticket.subject}`,
      `Reply from ${ticketWho(params.ticket)}:`,
      ``,
      params.replyBody,
    ].join("\n"),
  });
}

export async function notifyReporterOperatorReply(params: {
  ticket: SupportTicketPublic;
  replyBody: string;
}): Promise<void> {
  const to = params.ticket.reporterEmail?.trim();
  if (!to || !to.includes("@")) return;
  const portalHint =
    params.ticket.source === "creator"
      ? "Open Creator Portal → Support to reply."
      : "Open AI Art Studio in Shopify Admin → Support to reply.";
  await sendResend({
    to,
    subject: `[AppAI] ${params.ticket.ref} · we replied to your request`,
    text: [
      `We replied to ${params.ticket.ref}: ${params.ticket.subject}`,
      ``,
      params.replyBody,
      ``,
      portalHint,
    ].join("\n"),
  });
}
