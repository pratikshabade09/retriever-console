import { describe, expect, it } from "vitest";
import { dispatch, createInitialState, MONDAY, TUESDAY } from "./helpers";
import { availabilityForDoctorDate, appointmentsForPatient } from "../projections";
import { dateToAbsoluteMinutes } from "../time";
import type { EngineState } from "../state";

const SHARMA_OPEN = dateToAbsoluteMinutes(MONDAY, 9 * 60);

function slotsOn(state: EngineState, date: string) {
  return Object.values(state.slots)
    .filter((s) => s.doctorId === "sharma" && s.state === "OPEN" && state.sessions[s.sessionId]?.date === date)
    .sort((a, b) => a.time - b.time);
}

describe("availabilityForDoctorDate", () => {
  it("excludes protected slots and anything already in the past relative to now", () => {
    let state = createInitialState();
    ({ state } = dispatch(state, { type: "OpenSession", doctorId: "sharma", date: MONDAY, windowIndex: 0 }, SHARMA_OPEN));

    // Well before the session (09:00): every non-protected slot is offered.
    const beforeAnyone = availabilityForDoctorDate(state, "sharma", MONDAY, SHARMA_OPEN);
    expect(beforeAnyone.length).toBe(8); // 12 total - 4 protected
    expect(beforeAnyone.every((s) => s.time >= SHARMA_OPEN)).toBe(true);

    // Mid-afternoon, well past the session's own end (13:00): nothing left to offer today,
    // even though several of those slots were never booked.
    const lateInTheDay = availabilityForDoctorDate(state, "sharma", MONDAY, dateToAbsoluteMinutes(MONDAY, 17 * 60));
    expect(lateInTheDay).toEqual([]);

    // Partway through the morning: only the slots at or after `now` are offered.
    const midMorning = dateToAbsoluteMinutes(MONDAY, 10 * 60);
    const partway = availabilityForDoctorDate(state, "sharma", MONDAY, midMorning);
    expect(partway.every((s) => s.time >= midMorning)).toBe(true);
    expect(partway.length).toBeLessThan(beforeAnyone.length);
  });
});

describe("appointmentsForPatient", () => {
  it("lists one row per appointment and per walk-in, not one per token number", () => {
    let state = createInitialState();
    ({ state } = dispatch(state, { type: "OpenSession", doctorId: "sharma", date: MONDAY, windowIndex: 0 }, SHARMA_OPEN));
    ({ state } = dispatch(state, { type: "OpenSession", doctorId: "sharma", date: TUESDAY, windowIndex: 0 }, SHARMA_OPEN));
    ({ state } = dispatch(state, { type: "RegisterPatient", name: "Anita Rao", phone: "9000000001" }, SHARMA_OPEN));
    const patient = Object.values(state.patients)[0];

    // Two days, two bookings — and because token numbers restart every clinic day, both are
    // token 1. Neither may be swallowed by the other.
    for (const date of [MONDAY, TUESDAY]) {
      ({ state } = dispatch(
        state,
        {
          type: "BookAppointment",
          patientId: patient.id,
          doctorId: "sharma",
          slotId: slotsOn(state, date)[0].id,
          reason: "consultation",
          bookingSource: "PATIENT",
          paymentStatus: "PAY_AT_CLINIC",
        },
        SHARMA_OPEN,
      ));
    }
    // A walk-in the same patient took on the Monday, later that morning.
    ({ state } = dispatch(state, { type: "RegisterWalkIn", patientId: patient.id, doctorId: "sharma", reason: "sprain" }, dateToAbsoluteMinutes(MONDAY, 10 * 60)));

    const views = appointmentsForPatient(state, patient.id, dateToAbsoluteMinutes(TUESDAY, 12 * 60));

    // Soonest first: tomorrow's booking, then the walk-in, then the Monday booking.
    expect(views.map((v) => v.status)).toEqual(["BOOKED", "WAITING_CONSULT", "BOOKED"]);
    expect(views.map((v) => v.tokenNumber)).toEqual([1, 2, 1]);
    expect(views.every((v) => v.doctorName === "Dr. Sharma")).toBe(true);
  });
});
