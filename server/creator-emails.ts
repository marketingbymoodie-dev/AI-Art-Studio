/**
 * Creator Marketplace Phase 9 — email templates + log.
 * Auto-send is OFF unless CREATOR_EMAILS_ENABLED=true and the per-creator toggle is on.
 */
import { and, eq, gte } from "drizzle-orm";
import {
  CREATOR_EMAIL_TEMPLATE_KEYS,
  type CreatorEmailTemplateKey,
} from "@shared/creatorMarketplace";
import { creatorEmailLog, creators, type Creator } from "@shared/schema";
import { db } from "./db";

export function isCreatorEmailsEnabled(): boolean {
  const v = (process.env.CREATOR_EMAILS_ENABLED || "").trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}

export function isCreatorEmailTemplateKey(v: string): v is CreatorEmailTemplateKey {
  return (CREATOR_EMAIL_TEMPLATE_KEYS as readonly string[]).includes(v);
}

function subjectAndHtml(
  templateKey: CreatorEmailTemplateKey,
  creator: Pick<Creator, "displayName" | "username" | "betaEndAt">,
): { subject: string; html: string } {
  const name = creator.displayName || creator.username;
  const end =
    creator.betaEndAt instanceof Date
      ? creator.betaEndAt.toISOString().slice(0, 10)
      : creator.betaEndAt
        ? String(creator.betaEndAt).slice(0, 10)
        : "soon";
  switch (templateKey) {
    case "beta_ending_7d":
      return {
        subject: `Your Creator Beta ends in 7 days`,
        html: `<p>Hi ${name},</p><p>Your Creator Beta for @${creator.username} ends around <strong>${end}</strong> (7 days). Keep sharing your shop!</p>`,
      };
    case "beta_ending_3d":
      return {
        subject: `Your Creator Beta ends in 3 days`,
        html: `<p>Hi ${name},</p><p>Your Creator Beta ends around <strong>${end}</strong> (3 days). Log into the Creator Portal to review performance.</p>`,
      };
    case "beta_ending_1d":
      return {
        subject: `Your Creator Beta ends tomorrow`,
        html: `<p>Hi ${name},</p><p>Tomorrow is the last day of your Creator Beta (@${creator.username}). We'll be in touch about next steps.</p>`,
      };
    case "beta_ended":
      return {
        subject: `Your Creator Beta has ended`,
        html: `<p>Hi ${name},</p><p>Your Creator Beta for @${creator.username} has ended. Thanks for participating — our team will review next steps (extend, Partner Program, or pause).</p>`,
      };
    case "partner_welcome":
      return {
        subject: `Welcome to the AI Art Studio Partner Program`,
        html: `<p>Hi ${name},</p><p>You're now on the Partner Program for @${creator.username}. Revenue share settings are configured by the Studio team.</p>`,
      };
    case "application_accepted":
      return {
        subject: `You're in — Creator Beta onboarding`,
        html: `<p>Hi ${name},</p><p>Your application was accepted. Your shop preview: /c/${creator.username}. Sign in at /portal/login with this email.</p>`,
      };
    default:
      return { subject: "AI Art Studio Creators", html: `<p>Hi ${name},</p>` };
  }
}

/**
 * Log (and optionally send) a creator email. Idempotent within 20h per creator+template.
 * Returns status: sent | skipped | logged (skipped = feature off or toggle off).
 */
export async function queueCreatorEmail(params: {
  creatorId: string;
  templateKey: CreatorEmailTemplateKey;
  applicationId?: string | null;
  forceSend?: boolean;
}): Promise<{ status: "sent" | "skipped" | "duplicate" | "error"; error?: string }> {
  const [creator] = await db
    .select()
    .from(creators)
    .where(eq(creators.id, params.creatorId))
    .limit(1);
  if (!creator) return { status: "error", error: "creator_not_found" };

  const since = new Date(Date.now() - 20 * 60 * 60 * 1000);
  const [dup] = await db
    .select({ id: creatorEmailLog.id })
    .from(creatorEmailLog)
    .where(
      and(
        eq(creatorEmailLog.creatorId, creator.id),
        eq(creatorEmailLog.templateKey, params.templateKey),
        gte(creatorEmailLog.createdAt, since),
      ),
    )
    .limit(1);
  if (dup) return { status: "duplicate" };

  const toggles =
    creator.emailAutomationToggles && typeof creator.emailAutomationToggles === "object"
      ? (creator.emailAutomationToggles as Record<string, boolean>)
      : {};
  const toggleOn = toggles[params.templateKey] !== false; // default allow when global on
  const shouldSend =
    (params.forceSend || isCreatorEmailsEnabled()) && toggleOn && !!creator.email;

  const { subject, html } = subjectAndHtml(params.templateKey, creator);

  if (!shouldSend) {
    await db.insert(creatorEmailLog).values({
      creatorId: creator.id,
      applicationId: params.applicationId || creator.applicationId || null,
      templateKey: params.templateKey,
      recipient: creator.email,
      status: "skipped",
      error: isCreatorEmailsEnabled() ? null : "CREATOR_EMAILS_ENABLED off",
      sentAt: null,
    });
    return { status: "skipped" };
  }

  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    await db.insert(creatorEmailLog).values({
      creatorId: creator.id,
      applicationId: params.applicationId || null,
      templateKey: params.templateKey,
      recipient: creator.email,
      status: "error",
      error: "RESEND_API_KEY missing",
    });
    return { status: "error", error: "RESEND_API_KEY missing" };
  }

  try {
    const from =
      process.env.CREATOR_EMAIL_FROM ||
      process.env.RESEND_FROM ||
      "AI Art Studio <onboarding@resend.dev>";
    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [creator.email],
        subject,
        html,
      }),
    });
    if (!emailRes.ok) {
      const t = await emailRes.text();
      await db.insert(creatorEmailLog).values({
        creatorId: creator.id,
        applicationId: params.applicationId || null,
        templateKey: params.templateKey,
        recipient: creator.email,
        status: "error",
        error: t.slice(0, 400),
      });
      return { status: "error", error: t.slice(0, 200) };
    }
    await db.insert(creatorEmailLog).values({
      creatorId: creator.id,
      applicationId: params.applicationId || null,
      templateKey: params.templateKey,
      recipient: creator.email,
      status: "sent",
      sentAt: new Date(),
    });
    return { status: "sent" };
  } catch (e: any) {
    await db.insert(creatorEmailLog).values({
      creatorId: creator.id,
      applicationId: params.applicationId || null,
      templateKey: params.templateKey,
      recipient: creator.email,
      status: "error",
      error: String(e?.message || e).slice(0, 400),
    });
    return { status: "error", error: String(e?.message || e) };
  }
}
