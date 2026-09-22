// Per-doctor queue ordering. Position is never a stored field — always derived from the
// ordered list on read. Payment status never appears in the comparator: money must never buy
// clinical priority.

import type { EngineState } from "./state";
import type { QueueEntry } from "./types";

export function compareQueueEntries(a: QueueEntry, b: QueueEntry): number {
  if (a.priorityTier !== b.priorityTier) return b.priorityTier - a.priorityTier; // higher tier first
  if (a.effectiveReadyTime !== b.effectiveReadyTime) return a.effectiveReadyTime - b.effectiveReadyTime;
  if (a.enteredAt !== b.enteredAt) return a.enteredAt - b.enteredAt;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Every still-active (waiting or being seen) queue entry for one doctor, in queue order. */
export function activeQueueForDoctor(state: EngineState, doctorId: string): QueueEntry[] {
  return Object.values(state.queueEntries)
    .filter((q) => q.doctorId === doctorId && (q.status === "WAITING" || q.status === "IN_PROGRESS"))
    .sort(compareQueueEntries);
}

export function computeEffectiveReadyTime(params: {
  queueType: "CONSULT" | "REVIEW";
  arrivedAt: number;
  slotTime?: number;
  resultedAt?: number;
  reviewCreditMinutes?: number;
}): number {
  if (params.queueType === "REVIEW") {
    return (params.resultedAt ?? params.arrivedAt) - (params.reviewCreditMinutes ?? 0);
  }
  if (params.slotTime !== undefined) {
    // Booked: arriving early must not move you up; arriving late costs you your place.
    return Math.max(params.slotTime, params.arrivedAt);
  }
  return params.arrivedAt; // walk-in
}

/** How many active queue entries precede this one — 0 if it's at the head or not found. */
export function patientsAhead(state: EngineState, queueEntryId: string): number {
  const entry = state.queueEntries[queueEntryId];
  if (!entry) return 0;
  const ordered = activeQueueForDoctor(state, entry.doctorId);
  const idx = ordered.findIndex((q) => q.id === queueEntryId);
  return idx < 0 ? 0 : idx;
}

/** The median of current likely-OPD-time deltas for a doctor's waiting patients, or the
 * session's slot length when the queue is empty. */
export function averageWaitMinutes(params: {
  state: EngineState;
  doctorId: string;
  now: number;
  likelyOpdTimeForEntry: (entry: QueueEntry) => number;
  emptyQueueDefaultMinutes: number;
}): number {
  const { state, doctorId, now, likelyOpdTimeForEntry, emptyQueueDefaultMinutes } = params;
  const waiting = Object.values(state.queueEntries).filter((q) => q.doctorId === doctorId && q.status === "WAITING");
  if (waiting.length === 0) return emptyQueueDefaultMinutes;
  const deltas = waiting.map((q) => Math.max(0, likelyOpdTimeForEntry(q) - now)).sort((a, b) => a - b);
  const mid = Math.floor(deltas.length / 2);
  return deltas.length % 2 === 0 ? (deltas[mid - 1] + deltas[mid]) / 2 : deltas[mid];
}
