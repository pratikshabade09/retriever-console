import { describe, expect, it } from "vitest";
import { dispatch, createInitialState, MONDAY } from "./helpers";
import { dateToAbsoluteMinutes } from "../time";
import { DEFAULT_POLICY } from "../seed";

const SHARMA_OPEN = dateToAbsoluteMinutes(MONDAY, 9 * 60);

function slotByIndex(state: ReturnType<typeof createInitialState>, doctorId: string, index: number) {
  return Object.values(state.slots).find((s) => s.doctorId === doctorId && s.index === index)!;
}

describe("test 14: no-show only after grace", () => {
  it("does nothing before the grace period, and marks NO_SHOW after it", () => {
    let state = createInitialState();
    ({ state } = dispatch(state, { type: "OpenSession", doctorId: "sharma", date: MONDAY, windowIndex: 0 }, SHARMA_OPEN));
    ({ state } = dispatch(state, { type: "RegisterPatient", name: "No Show", phone: "1" }, SHARMA_OPEN));
    const patientId = Object.keys(state.patients)[0];
    const slot = slotByIndex(state, "sharma", 0);
    ({ state } = dispatch(state, { type: "BookAppointment", patientId, doctorId: "sharma", slotId: slot.id, reason: "x", bookingSource: "PATIENT", paymentStatus: "PAY_AT_CLINIC" }, SHARMA_OPEN));
    const appointmentId = Object.keys(state.appointments)[0];

    ({ state } = dispatch(state, { type: "EvaluateNoShow", appointmentId }, slot.time + DEFAULT_POLICY.noShowGraceMinutes - 1));
    expect(state.appointments[appointmentId].status).toBe("BOOKED");

    ({ state } = dispatch(state, { type: "EvaluateNoShow", appointmentId }, slot.time + DEFAULT_POLICY.noShowGraceMinutes));
    expect(state.appointments[appointmentId].status).toBe("NO_SHOW");

    expect(() => dispatch(state, { type: "CheckInPatient", appointmentId }, slot.time + 100)).toThrow();
  });
});

describe("test 15: duplicates rejected, double check-in is a no-op", () => {
  it("rejects booking the same slot twice", () => {
    let state = createInitialState();
    ({ state } = dispatch(state, { type: "OpenSession", doctorId: "sharma", date: MONDAY, windowIndex: 0 }, SHARMA_OPEN));
    ({ state } = dispatch(state, { type: "RegisterPatient", name: "A", phone: "1" }, SHARMA_OPEN));
    const patientA = Object.keys(state.patients)[0];
    ({ state } = dispatch(state, { type: "RegisterPatient", name: "B", phone: "2" }, SHARMA_OPEN));
    const patientB = Object.keys(state.patients).find((id) => id !== patientA)!;
    const slot = slotByIndex(state, "sharma", 0);

    ({ state } = dispatch(state, { type: "BookAppointment", patientId: patientA, doctorId: "sharma", slotId: slot.id, reason: "x", bookingSource: "PATIENT", paymentStatus: "PAY_AT_CLINIC" }, SHARMA_OPEN));
    expect(() =>
      dispatch(state, { type: "BookAppointment", patientId: patientB, doctorId: "sharma", slotId: slot.id, reason: "y", bookingSource: "PATIENT", paymentStatus: "PAY_AT_CLINIC" }, SHARMA_OPEN),
    ).toThrow();
  });

  it("rejects resulting the same investigation twice", () => {
    let state = createInitialState();
    ({ state } = dispatch(state, { type: "OpenSession", doctorId: "sharma", date: MONDAY, windowIndex: 0 }, SHARMA_OPEN));
    ({ state } = dispatch(state, { type: "RegisterPatient", name: "A", phone: "1" }, SHARMA_OPEN));
    const patientId = Object.keys(state.patients)[0];
    const slot = slotByIndex(state, "sharma", 0);
    ({ state } = dispatch(state, { type: "BookAppointment", patientId, doctorId: "sharma", slotId: slot.id, reason: "x", bookingSource: "PATIENT", paymentStatus: "PAY_AT_CLINIC" }, SHARMA_OPEN));
    const appointmentId = Object.keys(state.appointments)[0];
    ({ state } = dispatch(state, { type: "CheckInPatient", appointmentId }, slot.time));
    const visitId = Object.keys(state.visits)[0];
    const entryId = Object.values(state.queueEntries)[0].id;
    ({ state } = dispatch(state, { type: "StartConsultation", queueEntryId: entryId, actorRole: "DOCTOR" }, slot.time));
    ({ state } = dispatch(state, { type: "OrderInvestigation", visitId, serviceId: "cbc", actorRole: "DOCTOR" }, slot.time));
    const investigationId = Object.keys(state.investigations)[0];

    ({ state } = dispatch(state, { type: "RecordInvestigationResult", investigationId, resultSummary: "ok", resultFlag: "NORMAL", actorRole: "DOCTOR" }, slot.time + 30));
    expect(() =>
      dispatch(state, { type: "RecordInvestigationResult", investigationId, resultSummary: "ok again", resultFlag: "NORMAL", actorRole: "DOCTOR" }, slot.time + 40),
    ).toThrow();
  });

  it("double check-in is a no-op, not an error", () => {
    let state = createInitialState();
    ({ state } = dispatch(state, { type: "OpenSession", doctorId: "sharma", date: MONDAY, windowIndex: 0 }, SHARMA_OPEN));
    ({ state } = dispatch(state, { type: "RegisterPatient", name: "A", phone: "1" }, SHARMA_OPEN));
    const patientId = Object.keys(state.patients)[0];
    const slot = slotByIndex(state, "sharma", 0);
    ({ state } = dispatch(state, { type: "BookAppointment", patientId, doctorId: "sharma", slotId: slot.id, reason: "x", bookingSource: "PATIENT", paymentStatus: "PAY_AT_CLINIC" }, SHARMA_OPEN));
    const appointmentId = Object.keys(state.appointments)[0];

    ({ state } = dispatch(state, { type: "CheckInPatient", appointmentId }, slot.time));
    expect(Object.keys(state.visits)).toHaveLength(1);

    const { events } = dispatch(state, { type: "CheckInPatient", appointmentId }, slot.time + 5);
    expect(events).toEqual([]);
    expect(Object.keys(state.visits)).toHaveLength(1);
  });
});
