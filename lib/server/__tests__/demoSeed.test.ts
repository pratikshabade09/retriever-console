// The demo identities and the small pre-existing history the prototype starts with (see
// demoSeed.ts). These assertions are what keeps the seeded history honest: it has to be real
// events folded through the ordinary reducer, it has to leave the live queue empty, and it must
// not leave the clinic with a nonsensical consultation-duration estimate.

import { describe, expect, it } from "vitest";
import { buildDemoHistoryEvents, DEMO_PATIENT, DEMO_STAFF } from "../demoSeed";
import { createInitialState, reduce } from "../../engine/reducer";
import { dayNumberToDate, weekdayFromDayNumber } from "../../engine/time";
import type { EngineState } from "../../engine/state";

// 1117 days after the epoch is a Monday, 11:00 — a day the clinic is open.
const MONDAY_11AM = 1117 * 1440 + 11 * 60;

function formatDateOf(absoluteMinutes: number): string {
  return dayNumberToDate(Math.floor(absoluteMinutes / 1440));
}

function stateFrom(now: number): EngineState {
  return buildDemoHistoryEvents(now).reduce(reduce, createInitialState());
}

function demoPatientId(state: EngineState): string {
  const patient = Object.values(state.patients).find((p) => p.phone === DEMO_PATIENT.phone);
  if (!patient) throw new Error("demo patient was not registered");
  return patient.id;
}

describe("demo history", () => {
  it("registers the demo patient once and books exactly twice", () => {
    const state = stateFrom(MONDAY_11AM);
    expect(Object.keys(state.patients)).toHaveLength(1);
    const patientId = demoPatientId(state);
    expect(Object.values(state.appointments).filter((a) => a.patientId === patientId)).toHaveLength(2);
  });

  it("closes out a visit in the past", () => {
    const state = stateFrom(MONDAY_11AM);
    const patientId = demoPatientId(state);
    const visits = Object.values(state.visits).filter((v) => v.patientId === patientId);

    expect(visits).toHaveLength(1);
    expect(visits[0].status).toBe("CLOSED");

    const pastAppt = state.appointments[visits[0].appointmentId!];
    expect(pastAppt.status).toBe("ARRIVED");
    expect(pastAppt.slotTime).toBeLessThan(MONDAY_11AM);
    expect(weekdayFromDayNumber(Math.floor(pastAppt.slotTime / 1440))).not.toBe("SUN");

    // Nothing from that old day is still sitting in a doctor's queue, and the day's session
    // was closed out rather than left dangling open behind us.
    expect(Object.values(state.queueEntries).map((q) => q.status)).toEqual(["DONE"]);
    const pastDay = Math.floor(pastAppt.slotTime / 1440);
    const pastSessions = Object.values(state.sessions).filter((s) => Math.floor(s.startAt / 1440) === pastDay);
    expect(pastSessions.map((s) => s.status)).toEqual(["ENDED"]);
    expect(Object.values(state.invoices)).toHaveLength(1);
  });

  it("leaves one appointment still to come", () => {
    const state = stateFrom(MONDAY_11AM);
    const upcoming = Object.values(state.appointments).filter((a) => a.slotTime > MONDAY_11AM);

    expect(upcoming).toHaveLength(1);
    expect(upcoming[0].status).toBe("BOOKED");
    expect(upcoming[0].paymentStatus).toBe("PREPAID");
    expect(weekdayFromDayNumber(Math.floor(upcoming[0].slotTime / 1440))).not.toBe("SUN");
    // The slot it holds was taken out of circulation, not left bookable twice.
    expect(state.slots[upcoming[0].slotId].state).toBe("BOOKED");
    // Its day was materialized early, which is how the public booking API offers days ahead.
    const session = state.sessions[state.slots[upcoming[0].slotId].sessionId];
    expect(session.status).toBe("OPEN");
    expect(session.date).toBe(formatDateOf(upcoming[0].slotTime));
  });

  it("leaves the doctor a realistic consultation-duration sample", () => {
    const state = stateFrom(MONDAY_11AM);
    // 20 minutes — the slot length — not 0, which is what "just now" would have produced.
    expect(state.ewmaConsultMinutes.sharma).toBe(20);
  });

  it("is deterministic and never books the walk-in reserve", () => {
    const first = buildDemoHistoryEvents(MONDAY_11AM);
    const second = buildDemoHistoryEvents(MONDAY_11AM);
    expect(second).toEqual(first);

    const state = stateFrom(MONDAY_11AM);
    for (const appt of Object.values(state.appointments)) {
      const slot = state.slots[appt.slotId];
      expect(slot.state).not.toBe("PROTECTED");
      expect(appt.doctorId).toBe("sharma");
    }
  });

  it("only ever uses staff roles the auth store accepts", () => {
    expect(DEMO_STAFF.map((s) => s.email)).toEqual(["reception@demo.clinic", "admin@demo.clinic", "doctor@demo.clinic"]);
    expect(DEMO_STAFF.find((s) => s.role === "DOCTOR")?.doctorId).toBe("sharma");
    expect(DEMO_STAFF.filter((s) => s.role !== "DOCTOR").every((s) => s.doctorId === null)).toBe(true);
  });
});
