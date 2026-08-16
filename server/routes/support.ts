import type { Express, Response } from "express";
import { requirePlatformAdmin } from "../platformAdmin";
import {
  requireCreator,
  type CreatorAuthedRequest,
} from "../creator-auth";
import { checkCreatorRateLimit, clientIpFromReq } from "../creator-rate-limit";
import { normalizeMyshopifyShopDomain } from "../shopDomain";
import { storage } from "../storage";
import {
  addSupportReply,
  createHelpArticle,
  createSupportTicket,
  deleteHelpArticle,
  getSupportTicketById,
  httpErrorStatus,
  listAllHelpArticles,
  listPublishedHelpArticles,
  listRepliesForTicket,
  listTicketsForCreator,
  listTicketsForMerchant,
  listTicketsForPlatform,
  serializeHelpArticle,
  serializeReply,
  serializeTicket,
  updateHelpArticle,
  updateSupportTicketStatus,
} from "../support";
import {
  notifyFounderNewTicket,
  notifyFounderReporterReply,
  notifyReporterOperatorReply,
} from "../support-mail";
import {
  isHelpArticleCategory,
  isHelpAudience,
  isSupportCategory,
  isSupportStatus,
  type SupportCategory,
} from "@shared/support";

type AuthMw = any;

function rateOr429(
  res: Response,
  key: string,
  limit: number,
  windowMs: number,
): boolean {
  const rl = checkCreatorRateLimit({ key, limit, windowMs });
  if (rl.ok) return true;
  res.setHeader("Retry-After", String(rl.retryAfterSec));
  res.status(429).json({ error: "Too many requests. Try again shortly." });
  return false;
}

async function resolveMerchant(req: any): Promise<{
  merchantId: string | null;
  shopDomain: string | null;
  storeName: string | null;
}> {
  const shopDomain = normalizeMyshopifyShopDomain(req.shopDomain) || null;
  const userId = req.user?.claims?.sub as string | undefined;
  let merchant = userId ? await storage.getMerchantByUserId(userId) : undefined;
  if (!merchant && shopDomain) merchant = await storage.getMerchantByShop(shopDomain);
  return {
    merchantId: merchant?.id || null,
    shopDomain: shopDomain || merchant?.storeName || null,
    storeName: merchant?.storeName || shopDomain,
  };
}

function sendErr(res: Response, err: unknown, fallback: string) {
  const status = httpErrorStatus(err);
  const message = err instanceof Error ? err.message : fallback;
  if (status >= 500) console.error("[support]", err);
  res.status(status).json({ error: message || fallback });
}

export function registerSupportRoutes(
  app: Express,
  deps: { isAuthenticated: AuthMw },
): void {
  const { isAuthenticated } = deps;

  app.get("/api/help/articles", async (req, res) => {
    try {
      const audience = req.query.audience === "creator" ? "creator" : "merchant";
      const q = typeof req.query.q === "string" ? req.query.q : "";
      const rows = await listPublishedHelpArticles({ audience, q });
      res.json({ articles: rows.map(serializeHelpArticle) });
    } catch (err) {
      sendErr(res, err, "Failed to load How To articles");
    }
  });

  app.get("/api/creator/support/tickets", requireCreator, async (req: CreatorAuthedRequest, res) => {
    try {
      const rows = await listTicketsForCreator(req.creatorId!);
      res.json({ tickets: rows.map(serializeTicket) });
    } catch (err) {
      sendErr(res, err, "Failed to load tickets");
    }
  });

  app.get("/api/creator/support/tickets/:id", requireCreator, async (req: CreatorAuthedRequest, res) => {
    try {
      const ticket = await getSupportTicketById(parseInt(req.params.id, 10));
      if (!ticket || ticket.creatorId !== req.creatorId) {
        return res.status(404).json({ error: "Ticket not found." });
      }
      const replies = await listRepliesForTicket(ticket.id);
      res.json({ ticket: serializeTicket(ticket), replies: replies.map(serializeReply) });
    } catch (err) {
      sendErr(res, err, "Failed to load ticket");
    }
  });

  app.post("/api/creator/support/tickets", requireCreator, async (req: CreatorAuthedRequest, res) => {
    if (!rateOr429(res, `support-create-creator:${req.creatorId}`, 8, 60 * 60 * 1000)) return;
    try {
      const creator = req.creator!;
      const category = req.body?.category as SupportCategory;
      if (!isSupportCategory(category)) {
        return res.status(400).json({ error: "Choose a valid request type." });
      }
      const row = await createSupportTicket({
        source: "creator",
        category,
        subject: req.body?.subject,
        body: req.body?.body,
        reporterEmail: creator.email,
        reporterName: creator.displayName || creator.username,
        creatorId: creator.id,
        pageUrl: req.body?.pageUrl,
        userAgent: req.body?.userAgent || req.headers["user-agent"],
        generationJobId: req.body?.generationJobId,
        attachmentUrls: req.body?.attachmentUrls,
      });
      const ticket = serializeTicket(row);
      void notifyFounderNewTicket(ticket);
      res.status(201).json({ ticket });
    } catch (err) {
      sendErr(res, err, "Failed to create ticket");
    }
  });

  app.post(
    "/api/creator/support/tickets/:id/replies",
    requireCreator,
    async (req: CreatorAuthedRequest, res) => {
      if (!rateOr429(res, `support-reply-creator:${req.creatorId}`, 30, 60 * 60 * 1000)) return;
      try {
        const existing = await getSupportTicketById(parseInt(req.params.id, 10));
        if (!existing || existing.creatorId !== req.creatorId) {
          return res.status(404).json({ error: "Ticket not found." });
        }
        const { ticket, reply } = await addSupportReply({
          ticket: existing,
          authorRole: "reporter",
          authorName: req.creator?.displayName || req.creator?.username || "Creator",
          body: req.body?.body,
        });
        const publicTicket = serializeTicket(ticket);
        void notifyFounderReporterReply({ ticket: publicTicket, replyBody: reply.body });
        res.status(201).json({ ticket: publicTicket, reply: serializeReply(reply) });
      } catch (err) {
        sendErr(res, err, "Failed to send reply");
      }
    },
  );

  app.get("/api/admin/support/tickets", isAuthenticated, async (req: any, res: Response) => {
    try {
      const who = await resolveMerchant(req);
      if (!who.merchantId && !who.shopDomain) {
        return res.json({ tickets: [] });
      }
      const rows = await listTicketsForMerchant(who);
      res.json({ tickets: rows.map(serializeTicket) });
    } catch (err) {
      sendErr(res, err, "Failed to load tickets");
    }
  });

  app.get("/api/admin/support/tickets/:id", isAuthenticated, async (req: any, res: Response) => {
    try {
      const who = await resolveMerchant(req);
      const ticket = await getSupportTicketById(parseInt(req.params.id, 10));
      if (!ticket || ticket.source !== "merchant") {
        return res.status(404).json({ error: "Ticket not found." });
      }
      const owns =
        (who.merchantId && ticket.merchantId === who.merchantId) ||
        (who.shopDomain && ticket.shopDomain === who.shopDomain);
      if (!owns) return res.status(404).json({ error: "Ticket not found." });
      const replies = await listRepliesForTicket(ticket.id);
      res.json({ ticket: serializeTicket(ticket), replies: replies.map(serializeReply) });
    } catch (err) {
      sendErr(res, err, "Failed to load ticket");
    }
  });

  app.post("/api/admin/support/tickets", isAuthenticated, async (req: any, res: Response) => {
    const ip = clientIpFromReq(req);
    if (!rateOr429(res, `support-create-merchant:${ip}`, 8, 60 * 60 * 1000)) return;
    try {
      const who = await resolveMerchant(req);
      const category = req.body?.category as SupportCategory;
      if (!isSupportCategory(category)) {
        return res.status(400).json({ error: "Choose a valid request type." });
      }
      const row = await createSupportTicket({
        source: "merchant",
        category,
        subject: req.body?.subject,
        body: req.body?.body,
        reporterEmail: req.body?.reporterEmail,
        reporterName: who.storeName,
        merchantId: who.merchantId,
        shopDomain: who.shopDomain,
        pageUrl: req.body?.pageUrl,
        userAgent: req.body?.userAgent || req.headers["user-agent"],
        generationJobId: req.body?.generationJobId,
        attachmentUrls: req.body?.attachmentUrls,
      });
      const ticket = serializeTicket(row);
      void notifyFounderNewTicket(ticket);
      res.status(201).json({ ticket });
    } catch (err) {
      sendErr(res, err, "Failed to create ticket");
    }
  });

  app.post("/api/admin/support/tickets/:id/replies", isAuthenticated, async (req: any, res: Response) => {
    const ip = clientIpFromReq(req);
    if (!rateOr429(res, `support-reply-merchant:${ip}`, 30, 60 * 60 * 1000)) return;
    try {
      const who = await resolveMerchant(req);
      const existing = await getSupportTicketById(parseInt(req.params.id, 10));
      if (!existing || existing.source !== "merchant") {
        return res.status(404).json({ error: "Ticket not found." });
      }
      const owns =
        (who.merchantId && existing.merchantId === who.merchantId) ||
        (who.shopDomain && existing.shopDomain === who.shopDomain);
      if (!owns) return res.status(404).json({ error: "Ticket not found." });
      const { ticket, reply } = await addSupportReply({
        ticket: existing,
        authorRole: "reporter",
        authorName: who.storeName || who.shopDomain || "Merchant",
        body: req.body?.body,
      });
      const publicTicket = serializeTicket(ticket);
      void notifyFounderReporterReply({ ticket: publicTicket, replyBody: reply.body });
      res.status(201).json({ ticket: publicTicket, reply: serializeReply(reply) });
    } catch (err) {
      sendErr(res, err, "Failed to send reply");
    }
  });

  app.get("/api/platform/support/tickets", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const rows = await listTicketsForPlatform({
        source: String(req.query.source || ""),
        category: String(req.query.category || ""),
        status: String(req.query.status || ""),
      });
      res.json({ tickets: rows.map(serializeTicket) });
    } catch (err) {
      sendErr(res, err, "Failed to load tickets");
    }
  });

  app.get("/api/platform/support/tickets/:id", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const ticket = await getSupportTicketById(parseInt(req.params.id, 10));
      if (!ticket) return res.status(404).json({ error: "Ticket not found." });
      const replies = await listRepliesForTicket(ticket.id);
      res.json({ ticket: serializeTicket(ticket), replies: replies.map(serializeReply) });
    } catch (err) {
      sendErr(res, err, "Failed to load ticket");
    }
  });

  app.post("/api/platform/support/tickets/:id/replies", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const existing = await getSupportTicketById(parseInt(req.params.id, 10));
      if (!existing) return res.status(404).json({ error: "Ticket not found." });
      const nextStatus = isSupportStatus(req.body?.status) ? req.body.status : null;
      const { ticket, reply } = await addSupportReply({
        ticket: existing,
        authorRole: "operator",
        authorName: "AppAI Support",
        body: req.body?.body,
        nextStatus,
      });
      const publicTicket = serializeTicket(ticket);
      void notifyReporterOperatorReply({ ticket: publicTicket, replyBody: reply.body });
      res.status(201).json({ ticket: publicTicket, reply: serializeReply(reply) });
    } catch (err) {
      sendErr(res, err, "Failed to send reply");
    }
  });

  app.patch("/api/platform/support/tickets/:id", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const existing = await getSupportTicketById(parseInt(req.params.id, 10));
      if (!existing) return res.status(404).json({ error: "Ticket not found." });
      if (!isSupportStatus(req.body?.status)) {
        return res.status(400).json({ error: "Invalid status." });
      }
      const ticket = await updateSupportTicketStatus(existing.id, req.body.status);
      res.json({ ticket: ticket ? serializeTicket(ticket) : serializeTicket(existing) });
    } catch (err) {
      sendErr(res, err, "Failed to update ticket");
    }
  });

  app.get("/api/platform/help/articles", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const rows = await listAllHelpArticles();
      res.json({ articles: rows.map(serializeHelpArticle) });
    } catch (err) {
      sendErr(res, err, "Failed to load How To articles");
    }
  });

  app.post("/api/platform/help/articles", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      if (!isHelpAudience(req.body?.audience) || !isHelpArticleCategory(req.body?.category)) {
        return res.status(400).json({ error: "Audience and category are required." });
      }
      const row = await createHelpArticle({
        title: req.body?.title,
        summary: req.body?.summary,
        body: req.body?.body,
        audience: req.body.audience,
        category: req.body.category,
        published: !!req.body?.published,
        sortOrder: req.body?.sortOrder,
      });
      res.status(201).json({ article: serializeHelpArticle(row) });
    } catch (err) {
      sendErr(res, err, "Failed to create article");
    }
  });

  app.patch("/api/platform/help/articles/:id", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const row = await updateHelpArticle(String(req.params.id), {
        title: req.body?.title,
        summary: req.body?.summary,
        body: req.body?.body,
        audience: req.body?.audience,
        category: req.body?.category,
        published: req.body?.published,
        sortOrder: req.body?.sortOrder,
      });
      if (!row) return res.status(404).json({ error: "Article not found." });
      res.json({ article: serializeHelpArticle(row) });
    } catch (err) {
      sendErr(res, err, "Failed to update article");
    }
  });

  app.delete("/api/platform/help/articles/:id", isAuthenticated, async (req: any, res: Response) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const ok = await deleteHelpArticle(String(req.params.id));
      if (!ok) return res.status(404).json({ error: "Article not found." });
      res.json({ ok: true });
    } catch (err) {
      sendErr(res, err, "Failed to delete article");
    }
  });
}
