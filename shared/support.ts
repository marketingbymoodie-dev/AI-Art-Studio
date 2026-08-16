/** Shared support-ticket + How To library constants. */

export const SUPPORT_SOURCES = ["creator", "merchant"] as const;
export type SupportSource = (typeof SUPPORT_SOURCES)[number];

export const SUPPORT_CATEGORIES = [
  "bug",
  "feature",
  "persistent_error",
  "bad_generation",
  "setup_help",
  "billing",
  "printify",
  "other",
] as const;
export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number];

export const SUPPORT_CATEGORY_LABELS: Record<SupportCategory, string> = {
  bug: "Code bug found",
  feature: "Feature request",
  persistent_error: "Persistent error",
  bad_generation: "Unsatisfactory generation results",
  setup_help: "Setup help",
  billing: "Billing / credits / plan",
  printify: "Printify / fulfillment",
  other: "Other",
};

export const SUPPORT_STATUSES = [
  "open",
  "in_progress",
  "waiting_on_reporter",
  "waiting_on_operator",
  "resolved",
  "closed",
] as const;
export type SupportStatus = (typeof SUPPORT_STATUSES)[number];

export const SUPPORT_STATUS_LABELS: Record<SupportStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  waiting_on_reporter: "Waiting on you",
  waiting_on_operator: "Waiting on AppAI",
  resolved: "Resolved",
  closed: "Closed",
};

export const SUPPORT_REPLY_ROLES = ["reporter", "operator"] as const;
export type SupportReplyRole = (typeof SUPPORT_REPLY_ROLES)[number];

export const HELP_AUDIENCES = ["creator", "merchant", "both"] as const;
export type HelpAudience = (typeof HELP_AUDIENCES)[number];

export const HELP_ARTICLE_CATEGORIES = [
  "setup",
  "products",
  "styles",
  "billing",
  "generation",
  "marketing",
  "fulfillment",
  "other",
] as const;
export type HelpArticleCategory = (typeof HELP_ARTICLE_CATEGORIES)[number];

export const HELP_ARTICLE_CATEGORY_LABELS: Record<HelpArticleCategory, string> = {
  setup: "Setup",
  products: "Products & customizer pages",
  styles: "Styles & prompts",
  billing: "Billing & credits",
  generation: "Generations",
  marketing: "Marketing & bundles",
  fulfillment: "Printify & fulfillment",
  other: "Other",
};

export const HELP_AUDIENCE_LABELS: Record<HelpAudience, string> = {
  creator: "Creators",
  merchant: "Shopify merchants",
  both: "Everyone",
};

export function isSupportSource(value: unknown): value is SupportSource {
  return SUPPORT_SOURCES.includes(value as SupportSource);
}

export function isSupportCategory(value: unknown): value is SupportCategory {
  return SUPPORT_CATEGORIES.includes(value as SupportCategory);
}

export function isSupportStatus(value: unknown): value is SupportStatus {
  return SUPPORT_STATUSES.includes(value as SupportStatus);
}

export function isHelpAudience(value: unknown): value is HelpAudience {
  return HELP_AUDIENCES.includes(value as HelpAudience);
}

export function isHelpArticleCategory(value: unknown): value is HelpArticleCategory {
  return HELP_ARTICLE_CATEGORIES.includes(value as HelpArticleCategory);
}

export function formatTicketRef(id: number): string {
  return `T-${id}`;
}

export function slugifyHelpTitle(title: string): string {
  const slug = title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || "article";
}

export function ticketNeedsGenerationId(category: SupportCategory): boolean {
  return category === "bad_generation";
}

export function ticketNeedsErrorContext(category: SupportCategory): boolean {
  return category === "persistent_error" || category === "bug";
}

export type SupportGenerationSnapshot = {
  prompt?: string | null;
  userPrompt?: string | null;
  stylePreset?: string | null;
  thumbnailUrl?: string | null;
  designImageUrl?: string | null;
  errorMessage?: string | null;
  status?: string | null;
};

export type SupportTicketPublic = {
  id: number;
  ref: string;
  source: SupportSource;
  category: SupportCategory;
  status: SupportStatus;
  subject: string;
  body: string;
  reporterEmail: string;
  reporterName: string | null;
  creatorId: string | null;
  merchantId: string | null;
  shopDomain: string | null;
  pageUrl: string | null;
  userAgent: string | null;
  generationJobId: string | null;
  generationSnapshot: SupportGenerationSnapshot | null;
  attachmentUrls: string[];
  lastReplyRole: SupportReplyRole | null;
  lastReplyAt: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
};

export type SupportReplyPublic = {
  id: number;
  ticketId: number;
  authorRole: SupportReplyRole;
  authorName: string | null;
  body: string;
  createdAt: string;
};

export type HelpArticlePublic = {
  id: string;
  title: string;
  slug: string;
  summary: string | null;
  body: string;
  audience: HelpAudience;
  category: HelpArticleCategory;
  published: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};
