import { describe, expect, it } from "vitest";
import { runAutopilotDay } from "../autopilot";
import { createInitialState, reduce, replay } from "../../engine/reducer";
import { dateToDayNumber, dayNumberToDate } from "../../engine/time";
import type { Event } from "../../engine/events";

const BASE_MONDAY = "2026-01-05";
const SEEDS = [1, 2, 3, 4, 5, 6];

function dateForSeed(seed: number): string {
  return dayNumberToDate(dateToDayNumber(BASE_MONDAY) + (seed - 1)); // MON..SAT across the 6 seeds
}

/** Folds the log manually so we can inspect state *before* each CapacityReclaimed is applied —
 * the moment that matters for proving nothing booked was ever displaced. */
function auditNoDisplacement(events: Event[]): string[] {
  let state = createInitialState();
  const violations: string[] = [];
  for (const event of events) {
    if (event.type === "CapacityReclaimed") {
      for (const slotId of event.slotIds) {
        const slot = state.slots[slotId];
        if (slot && (slot.state === "BOOKED" || slot.state === "CONSUMED")) {
          violations.push(`${slotId} was ${slot.state} when reclaimed`);
        }
      }
    }
    state = reduce(state, event);
  }
  return violations;
}

/** No doctor was ever mid-consultation (or mid-review) with two patients at once. Tracked via
 * queueEntryId, since Started/Completed events pair up through it. */
function auditNoDoctorOverlap(events: Event[]): string[] {
  const busyDoctorByQueueEntry = new Map<string, string>(); // queueEntryId -> doctorId
  const busyDoctors = new Set<string>();
  const violations: string[] = [];
  for (const event of events) {
    if (event.type === "ConsultationStarted") {
      if (busyDoctors.has(event.doctorId)) violations.push(`${event.doctorId} started a second consultation while one was active`);
      busyDoctors.add(event.doctorId);
      busyDoctorByQueueEntry.set(event.queueEntryId, event.doctorId);
    }
    if (event.type === "ConsultationCompleted" || event.type === "ReviewCompleted") {
      const doctorId = busyDoctorByQueueEntry.get(event.queueEntryId);
      if (doctorId) {
        busyDoctors.delete(doctorId);
        busyDoctorByQueueEntry.delete(event.queueEntryId);
      }
    }
  }
  return violations;
}

describe("stage 9 soak test — six full clinic days on six seeds", () => {
  for (const seed of SEEDS) {
    const date = dateForSeed(seed);

    it(`seed ${seed} (${date}) holds every invariant`, () => {
      const { state, events } = runAutopilotDay(seed, date);

      // The day actually did something — otherwise the invariants below are vacuous.
      expect(events.length).toBeGreaterThan(20);

      // 1. No displacement: a CapacityReclaimed event never targeted a BOOKED/CONSUMED slot.
      expect(auditNoDisplacement(events)).toEqual([]);

      // 2. At most one CONSULTATION charge per visit, ever.
      const consultationChargesByVisit = new Map<string, number>();
      for (const c of Object.values(state.charges)) {
        if (c.kind === "CONSULTATION") consultationChargesByVisit.set(c.visitId, (consultationChargesByVisit.get(c.visitId) ?? 0) + 1);
      }
      for (const count of consultationChargesByVisit.values()) expect(count).toBeLessThanOrEqual(1);

      // 3. A doctor_running_late change never moves a time earlier.
      for (const change of state.opdChanges) {
        if (change.cause === "doctor_running_late") expect(change.to).toBeGreaterThan(change.from);
      }

      // 4. Token numbers are unique for the day (appointments + walk-in visits together).
      const tokens = [
        ...Object.values(state.appointments).map((a) => a.tokenNumber),
        ...Object.values(state.visits).filter((v) => v.appointmentId === null).map((v) => v.tokenNumber),
      ];
      expect(new Set(tokens).size).toBe(tokens.length);

      // 5. The hysteresis invariant.
      expect(state.policy.reclaimMargin).toBeLessThan(state.policy.releaseMargin);

      // 6. No doctor was ever double-booked into two concurrent consultations.
      expect(auditNoDoctorOverlap(events)).toEqual([]);

      // 7. Rebuild: replaying the event log from scratch matches the live-folded state exactly.
      const rebuilt = replay(events);
      expect(JSON.stringify(rebuilt)).toEqual(JSON.stringify(state));
    });
  }
});
