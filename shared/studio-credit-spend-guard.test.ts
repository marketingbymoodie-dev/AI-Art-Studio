import { describe, expect, it } from "vitest";
import {
  canSpendStudioCreditOnJob,
  isForbiddenGenerationLedgerDebit,
} from "./studio-credit-spend-guard";

describe("canSpendStudioCreditOnJob", () => {
  it("refuses missing, pending, running, and failed jobs", () => {
    expect(canSpendStudioCreditOnJob(null, "cust")).toBe(false);
    expect(canSpendStudioCreditOnJob({ status: "pending" }, "cust")).toBe(false);
    expect(canSpendStudioCreditOnJob({ status: "running" }, "cust")).toBe(false);
    expect(canSpendStudioCreditOnJob({ status: "failed" }, "cust")).toBe(false);
  });

  it("allows a completed job owned by the customer (or unattributed)", () => {
    expect(canSpendStudioCreditOnJob({ status: "complete", customerId: "cust" }, "cust")).toBe(true);
    expect(canSpendStudioCreditOnJob({ status: "complete", customerId: null }, "cust")).toBe(true);
  });

  it("refuses a completed job owned by someone else", () => {
    expect(canSpendStudioCreditOnJob({ status: "complete", customerId: "other" }, "cust")).toBe(false);
  });
});

describe("isForbiddenGenerationLedgerDebit", () => {
  it("blocks generation-reason debits on the generic ledger writer", () => {
    expect(isForbiddenGenerationLedgerDebit({ deltaCredits: -1, reason: "generation" })).toBe(true);
  });

  it("allows grants and non-generation clawbacks", () => {
    expect(isForbiddenGenerationLedgerDebit({ deltaCredits: 10, reason: "coupon" })).toBe(false);
    expect(isForbiddenGenerationLedgerDebit({ deltaCredits: -1, reason: "refund" })).toBe(false);
  });
});
