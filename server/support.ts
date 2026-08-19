import { and, desc, eq, ilike, or } from "drizzle-orm";
import { db } from "./db";
import {
  generationJobs,
  helpArticles,
  supportTicketReplies,
  supportTickets,
  type HelpArticleRow,
  type SupportTicketReplyRow,
  type SupportTicketRow,
} from "@shared/schema";
import {
  formatTicketRef,
  isHelpArticleCategory,
  isHelpAudience,
  isSupportCategory,
  isSupportStatus,
  normalizeHelpDemoUrl,
  slugifyHelpTitle,
  type HelpArticleCategory,
  type HelpArticlePublic,
  type HelpAudience,
  type SupportCategory,
  type SupportGenerationSnapshot,
  type SupportReplyPublic,
  type SupportReplyRole,
  type SupportSource,
  type SupportStatus,
  type SupportTicketPublic,
} from "@shared/support";

const SUBJECT_MAX = 120;
const BODY_MAX = 8000;
const ARTICLE_TITLE_MAX = 160;
const ARTICLE_BODY_MAX = 20000;

export function clipText(raw: unknown, max: number): string {
  return String(raw ?? "")
    .replace(/\0/g, "")
    .trim()
    .slice(0, max);
}

export function parseAttachmentUrls(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((u): u is string => typeof u === "string" && /^https?:\/\//i.test(u.trim()))
    .map((u) => u.trim().slice(0, 500))
    .slice(0, 5);
}

function iso(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  const date = d instanceof Date ? d : new Date(d);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function serializeTicket(row: SupportTicketRow): SupportTicketPublic {
  const snapshot =
    row.generationSnapshot && typeof row.generationSnapshot === "object"
      ? (row.generationSnapshot as SupportGenerationSnapshot)
      : null;
  return {
    id: row.id,
    ref: formatTicketRef(row.id),
    source: row.source as SupportSource,
    category: row.category as SupportCategory,
    status: row.status as SupportStatus,
    subject: row.subject,
    body: row.body,
    reporterEmail: row.reporterEmail,
    reporterName: row.reporterName,
    creatorId: row.creatorId,
    merchantId: row.merchantId,
    shopDomain: row.shopDomain,
    pageUrl: row.pageUrl,
    userAgent: row.userAgent,
    generationJobId: row.generationJobId,
    generationSnapshot: snapshot,
    attachmentUrls: Array.isArray(row.attachmentUrls) ? row.attachmentUrls : [],
    lastReplyRole: (row.lastReplyRole as SupportReplyRole | null) || null,
    lastReplyAt: iso(row.lastReplyAt),
    createdAt: iso(row.createdAt) || new Date().toISOString(),
    updatedAt: iso(row.updatedAt) || new Date().toISOString(),
    resolvedAt: iso(row.resolvedAt),
  };
}

export function serializeReply(row: SupportTicketReplyRow): SupportReplyPublic {
  return {
    id: row.id,
    ticketId: row.ticketId,
    authorRole: row.authorRole as SupportReplyRole,
    authorName: row.authorName,
    body: row.body,
    createdAt: iso(row.createdAt) || new Date().toISOString(),
  };
}

export function serializeHelpArticle(row: HelpArticleRow): HelpArticlePublic {
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    summary: row.summary,
    body: row.body,
    demoUrl: row.demoUrl || null,
    audience: row.audience as HelpAudience,
    category: row.category as HelpArticleCategory,
    published: row.published,
    sortOrder: row.sortOrder,
    createdAt: iso(row.createdAt) || new Date().toISOString(),
    updatedAt: iso(row.updatedAt) || new Date().toISOString(),
  };
}

export async function lookupGenerationSnapshot(params: {
  generationJobId: string | null;
  source: SupportSource;
  creatorId?: string | null;
  shopDomain?: string | null;
}): Promise<{ generationJobId: string | null; generationSnapshot: SupportGenerationSnapshot | null }> {
  const id = clipText(params.generationJobId, 80);
  if (!id) return { generationJobId: null, generationSnapshot: null };
  const [job] = await db
    .select({
      id: generationJobs.id,
      shop: generationJobs.shop,
      creatorId: generationJobs.creatorId,
      prompt: generationJobs.prompt,
      userPrompt: generationJobs.userPrompt,
      stylePreset: generationJobs.stylePreset,
      thumbnailUrl: generationJobs.thumbnailUrl,
      designImageUrl: generationJobs.designImageUrl,
      errorMessage: generationJobs.errorMessage,
      status: generationJobs.status,
    })
    .from(generationJobs)
    .where(eq(generationJobs.id, id))
    .limit(1);
  if (!job) return { generationJobId: id, generationSnapshot: null };
  if (params.source === "creator" && params.creatorId && job.creatorId && job.creatorId !== params.creatorId) {
    return { generationJobId: id, generationSnapshot: null };
  }
  if (params.source === "merchant" && params.shopDomain && job.shop) {
    const a = params.shopDomain.toLowerCase().replace(/\.myshopify\.com$/, "");
    const b = String(job.shop).toLowerCase().replace(/\.myshopify\.com$/, "");
    if (a && b && a !== b) {
      return { generationJobId: id, generationSnapshot: null };
    }
  }
  return {
    generationJobId: job.id,
    generationSnapshot: {
      prompt: job.prompt,
      userPrompt: job.userPrompt,
      stylePreset: job.stylePreset,
      thumbnailUrl: job.thumbnailUrl,
      designImageUrl: job.designImageUrl,
      errorMessage: job.errorMessage,
      status: job.status,
    },
  };
}

export async function createSupportTicket(input: {
  source: SupportSource;
  category: SupportCategory;
  subject: string;
  body: string;
  reporterEmail: string;
  reporterName?: string | null;
  creatorId?: string | null;
  merchantId?: string | null;
  shopDomain?: string | null;
  pageUrl?: string | null;
  userAgent?: string | null;
  generationJobId?: string | null;
  attachmentUrls?: unknown;
}): Promise<SupportTicketRow> {
  if (!isSupportCategory(input.category)) {
    throw Object.assign(new Error("Choose a valid request type."), { status: 400 });
  }
  const subject = clipText(input.subject, SUBJECT_MAX);
  const body = clipText(input.body, BODY_MAX);
  const reporterEmail = clipText(input.reporterEmail, 200).toLowerCase();
  if (!subject) throw Object.assign(new Error("Subject is required."), { status: 400 });
  if (body.length < 8) throw Object.assign(new Error("Please describe the issue in a bit more detail."), { status: 400 });
  if (!reporterEmail.includes("@")) throw Object.assign(new Error("A contact email is required."), { status: 400 });

  const gen = await lookupGenerationSnapshot({
    generationJobId: input.generationJobId || null,
    source: input.source,
    creatorId: input.creatorId,
    shopDomain: input.shopDomain,
  });

  const [row] = await db
    .insert(supportTickets)
    .values({
      source: input.source,
      category: input.category,
      status: "open",
      subject,
      body,
      reporterEmail,
      reporterName: clipText(input.reporterName, 120) || null,
      creatorId: input.creatorId || null,
      merchantId: input.merchantId || null,
      shopDomain: input.shopDomain || null,
      pageUrl: clipText(input.pageUrl, 500) || null,
      userAgent: clipText(input.userAgent, 400) || null,
      generationJobId: gen.generationJobId,
      generationSnapshot: gen.generationSnapshot,
      attachmentUrls: parseAttachmentUrls(input.attachmentUrls),
    })
    .returning();
  return row;
}

export async function addSupportReply(input: {
  ticket: SupportTicketRow;
  authorRole: SupportReplyRole;
  authorName?: string | null;
  body: string;
  nextStatus?: SupportStatus | null;
}): Promise<{ ticket: SupportTicketRow; reply: SupportTicketReplyRow }> {
  const body = clipText(input.body, BODY_MAX);
  if (body.length < 2) throw Object.assign(new Error("Reply cannot be empty."), { status: 400 });

  let status: SupportStatus = input.ticket.status as SupportStatus;
  if (input.nextStatus && isSupportStatus(input.nextStatus)) {
    status = input.nextStatus;
  } else if (input.authorRole === "reporter") {
    status = input.ticket.status === "closed" || input.ticket.status === "resolved"
      ? "waiting_on_operator"
      : "waiting_on_operator";
  } else if (input.ticket.status === "open" || input.ticket.status === "waiting_on_operator") {
    status = "in_progress";
  }

  const resolvedAt =
    status === "resolved" || status === "closed" ? new Date() : null;

  const [reply] = await db
    .insert(supportTicketReplies)
    .values({
      ticketId: input.ticket.id,
      authorRole: input.authorRole,
      authorName: clipText(input.authorName, 120) || null,
      body,
    })
    .returning();

  const [ticket] = await db
    .update(supportTickets)
    .set({
      status,
      lastReplyRole: input.authorRole,
      lastReplyAt: new Date(),
      updatedAt: new Date(),
      resolvedAt,
    })
    .where(eq(supportTickets.id, input.ticket.id))
    .returning();

  return { ticket, reply };
}

export async function updateSupportTicketStatus(
  ticketId: number,
  status: SupportStatus,
): Promise<SupportTicketRow | null> {
  if (!isSupportStatus(status)) {
    throw Object.assign(new Error("Invalid status."), { status: 400 });
  }
  const [row] = await db
    .update(supportTickets)
    .set({
      status,
      updatedAt: new Date(),
      resolvedAt: status === "resolved" || status === "closed" ? new Date() : null,
    })
    .where(eq(supportTickets.id, ticketId))
    .returning();
  return row || null;
}

export async function getSupportTicketById(id: number): Promise<SupportTicketRow | null> {
  if (!Number.isFinite(id) || id < 1) return null;
  const [row] = await db.select().from(supportTickets).where(eq(supportTickets.id, id)).limit(1);
  return row || null;
}

export async function listRepliesForTicket(ticketId: number): Promise<SupportTicketReplyRow[]> {
  return db
    .select()
    .from(supportTicketReplies)
    .where(eq(supportTicketReplies.ticketId, ticketId))
    .orderBy(supportTicketReplies.createdAt);
}

export async function listTicketsForCreator(creatorId: string): Promise<SupportTicketRow[]> {
  return db
    .select()
    .from(supportTickets)
    .where(eq(supportTickets.creatorId, creatorId))
    .orderBy(desc(supportTickets.updatedAt))
    .limit(100);
}

export async function listTicketsForMerchant(params: {
  merchantId?: string | null;
  shopDomain?: string | null;
}): Promise<SupportTicketRow[]> {
  const clauses = [];
  if (params.merchantId) clauses.push(eq(supportTickets.merchantId, params.merchantId));
  if (params.shopDomain) clauses.push(eq(supportTickets.shopDomain, params.shopDomain));
  if (clauses.length === 0) return [];
  return db
    .select()
    .from(supportTickets)
    .where(or(...clauses))
    .orderBy(desc(supportTickets.updatedAt))
    .limit(100);
}

export async function listTicketsForPlatform(filters: {
  source?: string;
  category?: string;
  status?: string;
}): Promise<SupportTicketRow[]> {
  const clauses = [];
  if (filters.source && filters.source !== "all") clauses.push(eq(supportTickets.source, filters.source));
  if (filters.category && filters.category !== "all") clauses.push(eq(supportTickets.category, filters.category));
  if (filters.status && filters.status !== "all") clauses.push(eq(supportTickets.status, filters.status));
  if (clauses.length === 0) {
    return db.select().from(supportTickets).orderBy(desc(supportTickets.updatedAt)).limit(200);
  }
  return db
    .select()
    .from(supportTickets)
    .where(and(...clauses))
    .orderBy(desc(supportTickets.updatedAt))
    .limit(200);
}

export async function uniqueHelpSlug(title: string, excludeId?: string): Promise<string> {
  const base = slugifyHelpTitle(title);
  for (let i = 0; i < 20; i++) {
    const slug = i === 0 ? base : `${base}-${i + 1}`;
    const [existing] = await db
      .select({ id: helpArticles.id })
      .from(helpArticles)
      .where(eq(helpArticles.slug, slug))
      .limit(1);
    if (!existing || existing.id === excludeId) return slug;
  }
  return `${base}-${Date.now().toString(36)}`;
}

export async function listPublishedHelpArticles(params: {
  audience: "creator" | "merchant";
  q?: string;
}): Promise<HelpArticleRow[]> {
  const audienceMatch = or(
    eq(helpArticles.audience, "both"),
    eq(helpArticles.audience, params.audience),
  );
  const clauses = [eq(helpArticles.published, true), audienceMatch];
  const q = clipText(params.q, 80);
  if (q) {
    const like = `%${q.replace(/[%_]/g, "")}%`;
    clauses.push(
      or(
        ilike(helpArticles.title, like),
        ilike(helpArticles.summary, like),
        ilike(helpArticles.body, like),
      )!,
    );
  }
  return db
    .select()
    .from(helpArticles)
    .where(and(...clauses))
    .orderBy(helpArticles.sortOrder, helpArticles.title)
    .limit(100);
}

export async function listAllHelpArticles(): Promise<HelpArticleRow[]> {
  return db
    .select()
    .from(helpArticles)
    .orderBy(helpArticles.sortOrder, desc(helpArticles.updatedAt))
    .limit(200);
}

export async function createHelpArticle(input: {
  title: string;
  summary?: string | null;
  body: string;
  demoUrl?: string | null;
  audience: HelpAudience;
  category: HelpArticleCategory;
  published?: boolean;
  sortOrder?: number;
}): Promise<HelpArticleRow> {
  if (!isHelpAudience(input.audience)) {
    throw Object.assign(new Error("Invalid audience."), { status: 400 });
  }
  if (!isHelpArticleCategory(input.category)) {
    throw Object.assign(new Error("Invalid How To category."), { status: 400 });
  }
  const title = clipText(input.title, ARTICLE_TITLE_MAX);
  const body = clipText(input.body, ARTICLE_BODY_MAX);
  if (!title) throw Object.assign(new Error("Title is required."), { status: 400 });
  if (body.length < 8) throw Object.assign(new Error("Write a bit more so this is useful later."), { status: 400 });
  const slug = await uniqueHelpSlug(title);
  const [row] = await db
    .insert(helpArticles)
    .values({
      title,
      slug,
      summary: clipText(input.summary, 280) || null,
      body,
      demoUrl: normalizeHelpDemoUrl(input.demoUrl),
      audience: input.audience,
      category: input.category,
      published: !!input.published,
      sortOrder: Number.isFinite(input.sortOrder) ? Number(input.sortOrder) : 0,
    })
    .returning();
  return row;
}

export async function updateHelpArticle(
  id: string,
  input: Partial<{
    title: string;
    summary: string | null;
    body: string;
    demoUrl: string | null;
    audience: HelpAudience;
    category: HelpArticleCategory;
    published: boolean;
    sortOrder: number;
  }>,
): Promise<HelpArticleRow | null> {
  const [existing] = await db.select().from(helpArticles).where(eq(helpArticles.id, id)).limit(1);
  if (!existing) return null;
  const patch: Partial<HelpArticleRow> = { updatedAt: new Date() };
  if (input.title != null) {
    patch.title = clipText(input.title, ARTICLE_TITLE_MAX);
    if (!patch.title) throw Object.assign(new Error("Title is required."), { status: 400 });
    patch.slug = await uniqueHelpSlug(patch.title, id);
  }
  if (input.summary !== undefined) patch.summary = clipText(input.summary, 280) || null;
  if (input.body != null) {
    patch.body = clipText(input.body, ARTICLE_BODY_MAX);
    if (patch.body.length < 8) throw Object.assign(new Error("Body is too short."), { status: 400 });
  }
  if (input.demoUrl !== undefined) patch.demoUrl = normalizeHelpDemoUrl(input.demoUrl);
  if (input.audience != null) {
    if (!isHelpAudience(input.audience)) throw Object.assign(new Error("Invalid audience."), { status: 400 });
    patch.audience = input.audience;
  }
  if (input.category != null) {
    if (!isHelpArticleCategory(input.category)) {
      throw Object.assign(new Error("Invalid How To category."), { status: 400 });
    }
    patch.category = input.category;
  }
  if (input.published != null) patch.published = !!input.published;
  if (input.sortOrder != null && Number.isFinite(input.sortOrder)) patch.sortOrder = Number(input.sortOrder);
  const [row] = await db.update(helpArticles).set(patch).where(eq(helpArticles.id, id)).returning();
  return row || null;
}

export async function deleteHelpArticle(id: string): Promise<boolean> {
  const deleted = await db.delete(helpArticles).where(eq(helpArticles.id, id)).returning({ id: helpArticles.id });
  return deleted.length > 0;
}

export function httpErrorStatus(err: unknown): number {
  const status = (err as { status?: number })?.status;
  return typeof status === "number" && status >= 400 && status < 600 ? status : 500;
}
