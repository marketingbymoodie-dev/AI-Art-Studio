import { describe, expect, it } from "vitest";
import {
  CUSTOMER_RETURNS_BLOCK,
  CUSTOMER_SHIPPING_BLOCK,
  DEFAULT_TERMS_CONTENT,
  DEFAULT_TERMS_ORIGIN,
  ensureCustomerCommerceTerms,
  escapeHtml,
  formatTermsDate,
  isAppHostedTermsOrigin,
  isSafeTermsHref,
  publicTermsHref,
  mergeTermsContent,
  parseTermsContentJson,
  renderTermsBodyHtml,
  stampTermsOnSave,
  todayUtcDate,
} from "./termsContent";

describe("formatTermsDate", () => {
  it("formats ISO dates in en-AU UTC", () => {
    expect(formatTermsDate("2026-08-16")).toBe("16 August 2026");
  });
});

describe("publicTermsHref", () => {
  it("uses the Railway app origin and ignores Shopify storefront hosts", () => {
    expect(publicTermsHref("customers")).toBe(`${DEFAULT_TERMS_ORIGIN}/terms#customers`);
    expect(publicTermsHref("customers", "https://ai-art-studio-staging.up.railway.app")).toBe(
      "https://ai-art-studio-staging.up.railway.app/terms#customers",
    );
    expect(publicTermsHref("customers", "https://shop.aiartstudio.app")).toBe(
      `${DEFAULT_TERMS_ORIGIN}/terms#customers`,
    );
    expect(publicTermsHref("customers", "https://aiartstudio-gizsmzs2.myshopify.com")).toBe(
      `${DEFAULT_TERMS_ORIGIN}/terms#customers`,
    );
    expect(isAppHostedTermsOrigin("https://max.aiartstudio.app")).toBe(true);
    expect(isAppHostedTermsOrigin("https://shop.aiartstudio.app")).toBe(false);
  });
});

describe("isSafeTermsHref", () => {
  it("allows relative app paths and https", () => {
    expect(isSafeTermsHref("/privacy")).toBe(true);
    expect(isSafeTermsHref("/terms#customers")).toBe(true);
    expect(isSafeTermsHref("https://aiartstudio.app/terms")).toBe(true);
  });

  it("rejects unsafe schemes and traversal", () => {
    expect(isSafeTermsHref("javascript:alert(1)")).toBe(false);
    expect(isSafeTermsHref("/terms/../admin")).toBe(false);
    expect(isSafeTermsHref("//evil.example")).toBe(false);
  });
});

describe("renderTermsBodyHtml", () => {
  it("renders headings, bullets, and escaped text", () => {
    const html = renderTermsBodyHtml("## Safety\n- No <script>\n\nSee [Privacy](/privacy).");
    expect(html).toContain('<h3 id="safety">Safety</h3>');
    expect(html).toContain("<li>No &lt;script&gt;</li>");
    expect(html).toContain('<a href="/privacy">Privacy</a>');
    expect(html).not.toContain("<script>");
  });

  it("drops unsafe links", () => {
    const html = renderTermsBodyHtml("Go [here](javascript:alert(1)).");
    expect(html).toContain("here");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("<a ");
  });
});

describe("mergeTermsContent", () => {
  it("returns defaults for empty input", () => {
    const merged = mergeTermsContent(null);
    expect(merged.pageTitle).toBe(DEFAULT_TERMS_CONTENT.pageTitle);
    expect(merged.sections.customers.body).toContain("Prompts and content");
  });

  it("overrides a section and keeps other defaults", () => {
    const merged = mergeTermsContent({
      pageTitle: "Studio Terms",
      sections: { customers: { title: "Shoppers", body: "Prompts may be refused." } },
    });
    expect(merged.pageTitle).toBe("Studio Terms");
    expect(merged.sections.customers.title).toBe("Shoppers");
    expect(merged.sections.merchants.title).toBe(DEFAULT_TERMS_CONTENT.sections.merchants.title);
  });
});

describe("stampTermsOnSave", () => {
  it("bumps revision and sets lastUpdated to today", () => {
    const stamped = stampTermsOnSave(
      { pageTitle: "Updated" },
      DEFAULT_TERMS_CONTENT,
      new Date("2026-09-01T12:00:00.000Z"),
    );
    expect(stamped.pageTitle).toBe("Updated");
    expect(stamped.lastUpdated).toBe("2026-09-01");
    expect(stamped.revision).toBe(DEFAULT_TERMS_CONTENT.revision + 1);
    expect(todayUtcDate(new Date("2026-09-01T12:00:00.000Z"))).toBe("2026-09-01");
  });
});

describe("parseTermsContentJson", () => {
  it("falls back on invalid JSON", () => {
    expect(parseTermsContentJson("{not json").pageTitle).toBe(DEFAULT_TERMS_CONTENT.pageTitle);
  });
});

describe("ensureCustomerCommerceTerms", () => {
  it("appends shipping and returns to an older customer section", () => {
    const upgraded = ensureCustomerCommerceTerms({
      ...DEFAULT_TERMS_CONTENT,
      sections: {
        ...DEFAULT_TERMS_CONTENT.sections,
        customers: {
          title: "End customers",
          body: "These terms apply when you use the customizer.\n\n## Seller\nContact the store.",
        },
      },
      merchantStoreAddendum: "AI ART STUDIO — ADDITIONAL TERMS\n\n1. Acceptance\nBy generating you agree.",
    });
    expect(upgraded.sections.customers.body).toContain(CUSTOMER_RETURNS_BLOCK);
    expect(upgraded.sections.customers.body).toContain(CUSTOMER_SHIPPING_BLOCK);
    expect(upgraded.merchantStoreAddendum).toContain("8. Custom / made-to-order");
  });

  it("does not duplicate blocks already present", () => {
    const once = ensureCustomerCommerceTerms(DEFAULT_TERMS_CONTENT);
    const twice = ensureCustomerCommerceTerms(once);
    expect(twice.sections.customers.body).toBe(once.sections.customers.body);
  });

  it("upgrades stored JSON that predates the commerce clauses", () => {
    const parsed = parseTermsContentJson(
      JSON.stringify({
        revision: 1,
        lastUpdated: "2026-08-16",
        sections: {
          customers: { title: "End customers", body: "Prompts may be refused." },
        },
      }),
    );
    expect(parsed.sections.customers.body).toContain("## Custom products and returns");
    expect(parsed.sections.customers.body).toContain("## Shipping and delivery");
  });
});

describe("escapeHtml", () => {
  it("escapes markup", () => {
    expect(escapeHtml(`<b>"x" & y</b>`)).toBe("&lt;b&gt;&quot;x&quot; &amp; y&lt;/b&gt;");
  });
});
