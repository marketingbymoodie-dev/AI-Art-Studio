/**
 * AI Art Studio Terms of Use — stored as JSON in platform_config.TERMS_CONTENT.
 * Operator admin edits; /terms, apply checkboxes, and storefront accept copy read the same record.
 * The merchant store addendum is a copy-only helper and is never pushed to Shopify policies.
 */

export const TERMS_SECTION_IDS = ["general", "customers", "merchants", "creators"] as const;
export type TermsSectionId = (typeof TERMS_SECTION_IDS)[number];

export const TERMS_SECTION_META: Record<TermsSectionId, { title: string; nav: string }> = {
  general: { title: "General", nav: "General" },
  customers: { title: "End customers", nav: "Customers" },
  merchants: { title: "Merchants", nav: "Merchants" },
  creators: { title: "Creators", nav: "Creators" },
};

export const TERMS_CHECKBOX_FIELDS = [
  ["applyCreator", "Creator apply checkbox"],
  ["applyMerchant", "Merchant apply checkbox"],
  ["storefrontAccept", "Storefront generate checkbox"],
  ["readFullTermsLabel", "Read-full-terms link label"],
] as const;

export type TermsCheckboxKey = (typeof TERMS_CHECKBOX_FIELDS)[number][0];

export type TermsCheckboxes = Record<TermsCheckboxKey, string>;

export type TermsSection = {
  title: string;
  body: string;
};

export type TermsContent = {
  lastUpdated: string;
  revision: number;
  pageTitle: string;
  intro: string;
  sections: Record<TermsSectionId, TermsSection>;
  checkboxes: TermsCheckboxes;
  /** Reference text for merchants to paste into their own Shopify Terms. Not auto-synced. */
  merchantStoreAddendum: string;
};

const MAX_TITLE = 160;
const MAX_INTRO = 4_000;
const MAX_SECTION = 24_000;
const MAX_CHECKBOX = 800;
const MAX_ADDENDUM = 12_000;

export function todayUtcDate(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function formatTermsDate(isoDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate.trim());
  if (!m) return isoDate.trim() || todayUtcDate();
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (Number.isNaN(d.getTime())) return isoDate.trim();
  return d.toLocaleDateString("en-AU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function clip(raw: unknown, max: number): string {
  return String(raw ?? "")
    .replace(/\r\n/g, "\n")
    .trim()
    .slice(0, max);
}

function clipKeepNewlines(raw: unknown, max: number): string {
  return String(raw ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim()
    .slice(0, max);
}

export const DEFAULT_TERMS_CONTENT: TermsContent = {
  lastUpdated: "2026-08-16",
  revision: 1,
  pageTitle: "AI Art Studio Terms of Use",
  intro:
    "These Terms of Use (“Terms”) govern AI Art Studio (also referred to as AppAI): AI artwork generation, product customisation, cart and checkout mockups, Studio Credits, merchant Shopify app features, and hosted creator storefronts.\n\nBy installing the app, applying as a creator or merchant, generating artwork, buying credits, or placing an order, you agree to these Terms and to the Privacy Policy.",
  sections: {
    general: {
      title: "General",
      body: `## Who you are dealing with
- Merchant store: the Shopify merchant is the seller of the physical product. AI Art Studio provides the customizer and related software.
- Creator storefront: checkout is on the AI Art Studio platform shop. We (or our nominated entity) are the seller of record; print partners fulfil the order. The creator promotes the storefront and may earn profit after fulfilment costs.

## Accounts
You must be able to form a contract. We may suspend or terminate access for breach, fraud, abuse, or legal risk.

## Intellectual property
We and our licensors own the Studio software, models, UI, and branding. You retain rights in prompts and uploads you lawfully own. You grant us a licence to process them to generate artwork, mockups, and print files, and to operate, secure, and improve the service. Generated images may be similar to other users’ outputs. We do not guarantee uniqueness.

## Third parties
Generation, storage, payments, and printing use providers (including Shopify, print partners such as Printify, hosting, and model vendors). Their acceptable-use and production rules also apply. A provider may refuse a generation or an order.

## Disclaimer
The Studio is provided “as is.” AI output is unpredictable. We do not warrant that a prompt will succeed, that artwork will match your intent, or that a mockup will match the finished print exactly.

## Liability
To the maximum extent permitted by law (including the Australian Consumer Law if it applies), we are not liable for indirect or consequential loss, lost profits, or lost credits. Our aggregate liability for the Studio is limited to the fees you paid us for the Studio in the 3 months before the claim (or, for customers, the price of the affected unused credit pack or undelivered item, as applicable). Nothing excludes non-waivable consumer guarantees.

## Changes
We may update these Terms. The “Last updated” date and revision on this page always reflect the current version. Continued use after a change is acceptance. We will tell merchants and creators when material terms change after launch. Copy pasted into a merchant’s own Shopify Terms of service is not updated automatically — merchants must paste a new version if we ask them to.`,
    },
    customers: {
      title: "End customers",
      body: `These terms apply when you use the AI Art Studio customizer on a merchant store or a creator storefront.

## Prompts and content
The Studio, the merchant, the creator, or our providers may refuse, filter, or fail to generate artwork that is sensitive, illegal, hateful, sexual involving minors, violent, or otherwise inappropriate, or that appears to infringe someone else’s rights. A refused or failed generation is not a product defect and does not create a refund right by itself.

You must not submit prompts or uploads that are:
- illegal, or that promote crime
- sexual content involving anyone 17 or under, or any sexualisation of minors
- non-consensual intimate imagery
- hate, harassment, or extremist propaganda
- graphic violence or real-world harm instructions
- another person’s name, likeness, or brand used in a way you do not have rights to
- otherwise sensitive or inappropriate for a public retail product

## No override or manipulation
You must not try to override, jailbreak, or manipulate the Studio, safety filters, quotas, credits, pricing, or checkout. Any such attempt is malpractice and is grounds for immediate account or session removal, cancellation of undelivered orders, and forfeiture of unused Studio Credits or generation packs, with no refunds.

## Studio Credits and generation packs
Packs are prepaid digital generations, not cash and not a physical product. They are consumed when a generation is attempted or completed. We may refund a credit when a generation fails because of a platform or provider outage unrelated to your prompt. We do not refund credits used on refused, filtered, or manipulative prompts. Unused credits are forfeited if your access is terminated for breach.

## Physical products
Mockups are previews, not photographs of the finished item. Colour, scale, and placement can differ on fabric or hard goods. Review the preview before you buy.

## Production defects vs malpractice
If an item arrives with a genuine manufacturing or shipping defect (wrong item, damaged print, print error caused by production), contact the store that sold it so a reprint or refund can be arranged under that store’s returns process.

We do not reprint or refund because you dislike the AI result, because a prompt was refused, because you ordered a design that is unclear, offensive, or rights-infringing, or because the order cannot be produced or delivered due to misuse of the Studio.

## Seller
For a merchant’s Shopify store, contact that store for order issues. For a creator storefront, contact the support channel listed with the platform shop.`,
    },
    merchants: {
      title: "Merchants",
      body: `## The app
AI Art Studio is a Shopify app: customizer pages, AI generation, mockups, optional Studio Credits, and print-file / fulfilment integrations. You must have authority to install it on the shop.

## Your store, your customers
You are the merchant of record on your shop. You are responsible for your Shopify Terms, refund and shipping policies, consumer-law compliance, taxes, and customer service — except where these Terms say we will not honour a refund for Studio malpractice or refused prompts.

Paste the AI Art Studio store addendum into your Shopify Terms of service so customers see the Studio rules. That paste is yours to maintain. Editing these Terms here does not update text already published on your store.

## Acceptable use
You will not use the app to sell prohibited goods, interfere with other shops, or ask us to generate or fulfil content that violates the End customers section. You will not attempt to override safety, billing, quotas, or checkout behaviour. Breach may mean app uninstall, plan cancellation, and no refund of subscription fees already incurred through Shopify.

## Plans and overage
Paid plans and optional pay-as-you-go overage are billed in USD through Shopify. Charges already incurred stay on the Shopify bill. Unused monthly generations do not roll over unless we say otherwise in-app.

## Print production
Physical goods are printed by third-party POD partners. We do not manufacture in-house. Production times, shipping, and reprint eligibility follow the print partner and your connected Printify / Shopify setup. Keep valid credentials; a broken token can break mockups and fulfilment.

## Faulty products
If a customer receives a genuine production or shipping defect, you handle the claim under your store policy. We will reasonably help with print-file and order diagnostics. We are not obliged to fund a reprint where the customer’s prompt or upload caused the issue, the customer used the Studio in breach, the “defect” is normal POD variance, or the order was cancelled or undeliverable because of malpractice or prohibited content.

## Your content
You warrant that products, logos, and style presets you configure do not infringe third-party rights. You indemnify us for claims arising from your catalogue, your marketing, or your customers’ prompts, except to the extent caused by our wilful misconduct.`,
    },
    creators: {
      title: "Creators",
      body: `The End customers section and the operational parts of the Merchants section apply to creator storefronts, plus the following.

## Beta
The hosted storefront is invitation or application based. The current public offer is 30 days, $0 upfront, and you keep 100% of product profit after fulfilment (gross − discounts − print/shipping costs − transaction fees − refunds). A later larger storefront and ongoing revenue share are by invitation only and are not promised by applying.

## Platform shop
Orders and credit-pack checkouts run on the AI Art Studio platform Shopify shop, not a shop you own. We may pause, extend, or end beta, or promote you to partner, as shown in the creator portal.

## Payouts
Product profit (and, if invited, partner share) is calculated on our ledger. Payouts are manual unless we say otherwise. We may withhold or claw back amounts for refunds, chargebacks, fraud, prohibited content, or malpractice. You are responsible for tax on your earnings.

## Your promotion
You promote the storefront. Do not misrepresent that customers are buying from a separate legal shop if checkout is on our platform. Public pages use your shop handle, not your legal name, unless you put that name in your About copy.

## Takedown
We may remove products, designs, or your storefront if prompts, uploads, or marketing violate these Terms, infringe IP, or create legal or brand risk. Unused customer packs and undeliverable orders tied to that breach are handled under the End customers section (no refund for malpractice).

## No circumvention
Attempts to manipulate generation, credits, rankings, analytics, or payouts are grounds for removal from the program and forfeiture of unpaid earnings tied to the breach, to the extent permitted by law.`,
    },
  },
  checkboxes: {
    applyCreator:
      "I agree to the AI Art Studio Creator Terms, including prompt rules, print and fulfilment terms, and that unused credits and undeliverable orders are not refundable if I or my audience misuse the Studio.",
    applyMerchant:
      "I agree to the AI Art Studio Merchant Terms and confirm I own this Shopify store.",
    storefrontAccept:
      "I agree that prompts may be refused for sensitive or inappropriate subject matter, and that attempts to override or manipulate the Studio can result in account removal with no refund of paid generation packs or undeliverable products.",
    readFullTermsLabel: "Read the full terms",
  },
  merchantStoreAddendum: `AI ART STUDIO — ADDITIONAL TERMS

These additional terms apply when you use the AI Art Studio customizer on this store (the “Studio”). They sit alongside this store’s general Terms of Service. If they conflict on Studio use, these terms control.

1. Acceptance
By entering a prompt, generating artwork, buying Studio Credits, or adding a custom product to your cart, you agree to these terms and to the AI Art Studio Terms of Use published by the app.

2. Prompts and content
The Studio may refuse, filter, or fail to generate artwork that is sensitive, illegal, hateful, sexual involving minors, violent, or otherwise inappropriate, or that appears to infringe someone else’s rights. A refused or failed generation is not a defect and does not create a refund right by itself.

3. No circumvention
You must not try to override, jailbreak, or manipulate the Studio, safety filters, quotas, credits, pricing, or checkout. Doing so is grounds for immediate account or session removal, cancellation of undelivered orders, and forfeiture of unused Studio Credits / generation packs, with no refund.

4. Digital credits
Studio Credits and generation packs are digital. They are not cash. Unused credits expire or are forfeited if your access is terminated for breach. Credits spent on refused, filtered, or unsuccessful generations caused by prohibited or manipulative prompts are not refundable.

5. What you are buying
You are buying a print-on-demand product made from artwork you directed. On-screen mockups are previews, not photographs of the finished item. Print placement, colour, and fabric can vary from the screen.

6. Production defects vs. your design
If an item arrives with a genuine manufacturing or shipping defect (wrong item, damaged print, print error caused by production), contact the store so a reprint or refund can be arranged under the store’s normal returns process.

We do not reprint or refund because you dislike the AI result, because a prompt was refused, because you ordered a design that is unclear, offensive, or rights-infringing, or because the order cannot be produced or delivered due to your misuse of the Studio (“malpractice”).

7. Your responsibility
You are responsible for your prompts and uploaded images. Do not submit content you do not have the right to use. The store and AI Art Studio may refuse fulfilment of any order that appears unlawful or in breach.`,
};

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Apex Railway host that serves /terms. Shopify storefronts do not. */
export const DEFAULT_TERMS_ORIGIN = "https://aiartstudio.app";

/** Origins that can serve the React /terms page (Railway), not a Shopify theme. */
export function isAppHostedTermsOrigin(origin: string): boolean {
  try {
    const host = new URL(origin.includes("://") ? origin : `https://${origin}`).hostname.toLowerCase();
    if (!host) return false;
    if (host.endsWith(".myshopify.com")) return false;
    if (host === "shop.aiartstudio.app") return false;
    return true;
  } catch {
    return false;
  }
}

export function publicTermsHref(
  section: TermsSectionId | "" = "customers",
  origin?: string,
): string {
  const hash = section ? `#${section}` : "";
  const raw = String(origin || "").replace(/\/$/, "");
  const base =
    raw && isAppHostedTermsOrigin(raw)
      ? raw.includes("://")
        ? raw
        : `https://${raw}`
      : DEFAULT_TERMS_ORIGIN;
  return `${base}/terms${hash}`;
}

export function isSafeTermsHref(href: string): boolean {
  const value = href.trim();
  if (!value) return false;
  if (value.startsWith("/") && !value.startsWith("//")) return !value.includes("..");
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

function renderInline(text: string): string {
  const escaped = escapeHtml(text);
  return escaped.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    (_all, label: string, href: string) => {
      const rawHref = href
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"');
      if (!isSafeTermsHref(rawHref)) return label;
      return `<a href="${escapeHtml(rawHref)}">${label}</a>`;
    },
  );
}

/** Lightweight markup: ## heading, - bullets, blank-line paragraphs, [label](url). */
export function renderTermsBodyHtml(body: string): string {
  const lines = clipKeepNewlines(body, MAX_SECTION).split("\n");
  const out: string[] = [];
  let list: string[] = [];
  let para: string[] = [];

  const flushList = () => {
    if (!list.length) return;
    out.push(`<ul>${list.join("")}</ul>`);
    list = [];
  };
  const flushPara = () => {
    if (!para.length) return;
    out.push(`<p>${renderInline(para.join(" "))}</p>`);
    para = [];
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      flushList();
      flushPara();
      continue;
    }
    if (line.startsWith("## ")) {
      flushList();
      flushPara();
      out.push(`<h3>${escapeHtml(line.slice(3).trim())}</h3>`);
      continue;
    }
    if (line.startsWith("- ")) {
      flushPara();
      list.push(`<li>${renderInline(line.slice(2).trim())}</li>`);
      continue;
    }
    flushList();
    para.push(line);
  }
  flushList();
  flushPara();
  return out.join("\n");
}

function mergeSection(id: TermsSectionId, raw: unknown): TermsSection {
  const fallback = DEFAULT_TERMS_CONTENT.sections[id];
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    title: clip(src.title, MAX_TITLE) || fallback.title,
    body: clipKeepNewlines(src.body, MAX_SECTION) || fallback.body,
  };
}

export function mergeTermsContent(raw: unknown): TermsContent {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const sectionsSrc =
    src.sections && typeof src.sections === "object"
      ? (src.sections as Record<string, unknown>)
      : {};
  const checkSrc =
    src.checkboxes && typeof src.checkboxes === "object"
      ? (src.checkboxes as Record<string, unknown>)
      : src;
  const checkboxes = { ...DEFAULT_TERMS_CONTENT.checkboxes };
  for (const [key] of TERMS_CHECKBOX_FIELDS) {
    if (checkSrc[key] != null) {
      const next = clip(checkSrc[key], MAX_CHECKBOX);
      if (next) checkboxes[key] = next;
    }
  }
  const lastUpdated = clip(src.lastUpdated, 16);
  const revisionRaw = Number(src.revision);
  return {
    lastUpdated: /^\d{4}-\d{2}-\d{2}$/.test(lastUpdated)
      ? lastUpdated
      : DEFAULT_TERMS_CONTENT.lastUpdated,
    revision:
      Number.isFinite(revisionRaw) && revisionRaw >= 1
        ? Math.min(1_000_000, Math.floor(revisionRaw))
        : DEFAULT_TERMS_CONTENT.revision,
    pageTitle: clip(src.pageTitle, MAX_TITLE) || DEFAULT_TERMS_CONTENT.pageTitle,
    intro: clipKeepNewlines(src.intro, MAX_INTRO) || DEFAULT_TERMS_CONTENT.intro,
    sections: {
      general: mergeSection("general", sectionsSrc.general),
      customers: mergeSection("customers", sectionsSrc.customers),
      merchants: mergeSection("merchants", sectionsSrc.merchants),
      creators: mergeSection("creators", sectionsSrc.creators),
    },
    checkboxes,
    merchantStoreAddendum:
      clipKeepNewlines(src.merchantStoreAddendum, MAX_ADDENDUM) ||
      DEFAULT_TERMS_CONTENT.merchantStoreAddendum,
  };
}

export function parseTermsContentJson(json: string | null | undefined): TermsContent {
  if (!json) return structuredClone(DEFAULT_TERMS_CONTENT);
  try {
    return mergeTermsContent(JSON.parse(json));
  } catch {
    return structuredClone(DEFAULT_TERMS_CONTENT);
  }
}

export function stampTermsOnSave(
  incoming: unknown,
  previous: TermsContent,
  now = new Date(),
): TermsContent {
  const merged = mergeTermsContent(incoming);
  return {
    ...merged,
    lastUpdated: todayUtcDate(now),
    revision: Math.max(1, previous.revision) + 1,
  };
}
