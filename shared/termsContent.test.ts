import { describe, expect, it } from "vitest";
import {
  DEFAULT_TERMS_CONTENT,
  escapeHtml,
  formatTermsDate,
  isSafeTermsHref,
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
    expect(html).toContain("<h3>Safety</h3>");
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

describe("escapeHtml", () => {
  it("escapes markup", () => {
    expect(escapeHtml(`<b>"x" & y</b>`)).toBe("&lt;b&gt;&quot;x&quot; &amp; y&lt;/b&gt;");
  });
});
