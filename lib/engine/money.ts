// Fees are effective-dated; a charge stores the fee it resolved to at charge time, so
// changing a fee later never rewrites an existing charge or invoice.

import type { EngineState } from "./state";
import type { ChargeKind, InvoiceLine } from "./types";

export function currentFee(state: EngineState, doctorId: string, now: number): number {
  const rows = state.feeHistory.filter((r) => r.doctorId === doctorId && r.effectiveFrom <= now);
  if (rows.length === 0) return 0;
  return rows.reduce((latest, row) => (row.effectiveFrom > latest.effectiveFrom ? row : latest)).fee;
}

function describeCharge(kind: ChargeKind): string {
  switch (kind) {
    case "CONSULTATION":
      return "Consultation";
    case "REVIEW":
      return "Review (same visit, no new consultation charge)";
    case "INVESTIGATION":
      return "Investigation";
  }
}

export function buildInvoiceLines(state: EngineState, visitId: string): InvoiceLine[] {
  return Object.values(state.charges)
    .filter((c) => c.visitId === visitId)
    .map((c) => ({ chargeId: c.id, kind: c.kind, description: describeCharge(c.kind), amount: c.amount }));
}
