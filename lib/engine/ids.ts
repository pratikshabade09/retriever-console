// Deterministic id generation. No random number generator — an id is derived from how many
// entities of that kind already exist in state, so replaying the same event log always
// assigns the same ids. Fine even though it means the same seed always yields the same
// booking id for the first booking of the day: that's the point of determinism, not a bug.

import type { EngineState } from "./state";

const COUNTERS: Record<string, (state: EngineState) => number> = {
  patient: (s) => Object.keys(s.patients).length,
  appt: (s) => Object.keys(s.appointments).length,
  visit: (s) => Object.keys(s.visits).length,
  queue: (s) => Object.keys(s.queueEntries).length,
  inv: (s) => Object.keys(s.investigations).length,
  charge: (s) => Object.keys(s.charges).length,
  invoice: (s) => Object.keys(s.invoices).length,
  ledger: (s) => s.capacityLedger.length,
  notif: (s) => s.notifications.length,
  opdchg: (s) => s.opdChanges.length,
  session: (s) => Object.keys(s.sessions).length,
};

/** Generates the next id of `kind`, offset by how many this same decide() call has already
 * minted (`extra`) so a single command can safely create more than one of the same kind. */
export function makeId(state: EngineState, kind: keyof typeof COUNTERS, extra = 0): string {
  const count = COUNTERS[kind](state) + extra;
  return `${kind}-${count + 1}`;
}
