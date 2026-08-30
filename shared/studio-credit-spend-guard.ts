/**
 * Pack/earned spend is debit-on-success only.
 * A completed generation_job is required — load / resolve / reconcile / gate must never spend.
 */
export function canSpendStudioCreditOnJob(
  job: { status?: string | null; customerId?: string | null } | null | undefined,
  customerId: string,
): boolean {
  if (!job || job.status !== "complete") return false;
  if (!customerId) return false;
  if (job.customerId && job.customerId !== customerId) return false;
  return true;
}

/** Generation-reason ledger rows must come from spendStudioCredit, never applyCreditLedgerEntry. */
export function isForbiddenGenerationLedgerDebit(entry: {
  deltaCredits: number;
  reason?: string | null;
}): boolean {
  return entry.deltaCredits < 0 && entry.reason === "generation";
}
