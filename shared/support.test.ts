import { describe, expect, it } from "vitest";
import {
  formatTicketRef,
  helpDemoShareUrl,
  isSupportCategory,
  isSupportStatus,
  normalizeHelpDemoUrl,
  slugifyHelpTitle,
  ticketNeedsErrorContext,
  ticketNeedsGenerationId,
} from "./support";

describe("support helpers", () => {
  it("accepts known categories including setup help", () => {
    expect(isSupportCategory("setup_help")).toBe(true);
    expect(isSupportCategory("bad_generation")).toBe(true);
    expect(isSupportCategory("not-a-category")).toBe(false);
  });

  it("formats ticket refs", () => {
    expect(formatTicketRef(1842)).toBe("T-1842");
  });

  it("flags category-specific fields", () => {
    expect(ticketNeedsGenerationId("bad_generation")).toBe(true);
    expect(ticketNeedsGenerationId("feature")).toBe(false);
    expect(ticketNeedsErrorContext("persistent_error")).toBe(true);
    expect(ticketNeedsErrorContext("bug")).toBe(true);
  });

  it("slugifies How To titles", () => {
    expect(slugifyHelpTitle("Connect Printify & create a page")).toBe(
      "connect-printify-create-a-page",
    );
    expect(isSupportStatus("waiting_on_operator")).toBe(true);
  });

  it("normalizes Supademo share, embed, and iframe snippets", () => {
    const id = "cmsy43d9r0ddqqmlambts1iec";
    const embed = `https://app.supademo.com/embed/${id}`;
    expect(normalizeHelpDemoUrl(`https://app.supademo.com/demo/${id}?utm_source=link`)).toBe(embed);
    expect(normalizeHelpDemoUrl(embed)).toBe(embed);
    expect(
      normalizeHelpDemoUrl(`<iframe src="https://app.supademo.com/embed/${id}" allow="clipboard-write"></iframe>`),
    ).toBe(embed);
    expect(normalizeHelpDemoUrl("")).toBe(null);
    expect(helpDemoShareUrl(embed)).toBe(`https://app.supademo.com/demo/${id}`);
    expect(() => normalizeHelpDemoUrl("https://example.com/demo/abc")).toThrow(/app.supademo.com/);
  });
});
