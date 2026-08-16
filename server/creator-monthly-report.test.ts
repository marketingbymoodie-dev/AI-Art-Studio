import { describe, expect, it } from "vitest";
import {
  currentUtcMonthKey,
  formatCreatorMonthReportText,
  previousUtcMonthKey,
  type CreatorMonthReport,
} from "./creator-monthly-report";

describe("creator monthly report helpers", () => {
  it("computes previous UTC month", () => {
    expect(previousUtcMonthKey(new Date("2026-08-01T00:00:00.000Z"))).toBe("2026-07");
    expect(previousUtcMonthKey(new Date("2026-01-03T12:00:00.000Z"))).toBe("2025-12");
    expect(currentUtcMonthKey(new Date("2026-08-16T10:00:00.000Z"))).toBe("2026-08");
  });

  it("formats a ranked one-line breakdown", () => {
    const report: CreatorMonthReport = {
      month: "2026-08",
      totals: {
        visitors: 24,
        generations: 7,
        atcCount: 31,
        orders: 0,
        salesCents: 0,
        productProfitCents: 0,
        netProfitCents: -35,
        payoutCents: 0,
        genCostCents: 35,
      },
      rows: [
        {
          rank: 1,
          creatorId: "c1",
          username: "madclowncore",
          displayName: "Mad Clown Core",
          visitors: 24,
          generations: 7,
          atcCount: 31,
          orders: 0,
          salesCents: 0,
          productProfitCents: 0,
          netProfitCents: -35,
          payoutCents: 0,
          genCostCents: 35,
        },
      ],
    };
    const text = formatCreatorMonthReportText(report);
    expect(text).toContain("#1 Mad Clown Core (@madclowncore)");
    expect(text).toContain("Net profit -$0.35");
    expect(text).toContain("Payout $0.00");
    expect(text).toContain("24 vis · 7 gens · 31 ATC · 0 orders");
  });
});
