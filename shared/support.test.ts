import { describe, expect, it } from "vitest";
import {
  formatTicketRef,
  isSupportCategory,
  isSupportStatus,
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
});
