import { describe, expect, it } from "vitest";
import { dispatch, createInitialState, MONDAY } from "./helpers";
import { dateToAbsoluteMinutes } from "../time";

const SHARMA_OPEN = dateToAbsoluteMinutes(MONDAY, 9 * 60);

describe("test 16: escalation needs a reason; tier 2 from reception is refused", () => {
  it("refuses an escalation with no reason", () => {
    let state = createInitialState();
    ({ state } = dispatch(state, { type: "OpenSession", doctorId: "sharma", date: MONDAY, windowIndex: 0 }, SHARMA_OPEN));
    ({ state } = dispatch(state, { type: "RegisterPatient", name: "A", phone: "1" }, SHARMA_OPEN));
    const patientId = Object.keys(state.patients)[0];
    const slot = Object.values(state.slots).find((s) => s.doctorId === "sharma" && s.index === 0)!;
    ({ state } = dispatch(state, { type: "BookAppointment", patientId, doctorId: "sharma", slotId: slot.id, reason: "x", bookingSource: "PATIENT", paymentStatus: "PAY_AT_CLINIC" }, SHARMA_OPEN));
    const appointmentId = Object.keys(state.appointments)[0];
    ({ state } = dispatch(state, { type: "CheckInPatient", appointmentId }, slot.time));
    const entryId = Object.values(state.queueEntries)[0].id;

    expect(() => dispatch(state, { type: "EscalatePriority", queueEntryId: entryId, tier: 1, reason: "", actorRole: "RECEPTION" }, slot.time)).toThrow();
  });

  it("refuses a tier-2 escalation from reception, but allows it from a doctor", () => {
    let state = createInitialState();
    ({ state } = dispatch(state, { type: "OpenSession", doctorId: "sharma", date: MONDAY, windowIndex: 0 }, SHARMA_OPEN));
    ({ state } = dispatch(state, { type: "RegisterPatient", name: "A", phone: "1" }, SHARMA_OPEN));
    const patientId = Object.keys(state.patients)[0];
    const slot = Object.values(state.slots).find((s) => s.doctorId === "sharma" && s.index === 0)!;
    ({ state } = dispatch(state, { type: "BookAppointment", patientId, doctorId: "sharma", slotId: slot.id, reason: "x", bookingSource: "PATIENT", paymentStatus: "PAY_AT_CLINIC" }, SHARMA_OPEN));
    const appointmentId = Object.keys(state.appointments)[0];
    ({ state } = dispatch(state, { type: "CheckInPatient", appointmentId }, slot.time));
    const entryId = Object.values(state.queueEntries)[0].id;

    expect(() =>
      dispatch(state, { type: "EscalatePriority", queueEntryId: entryId, tier: 2, reason: "chest pain", actorRole: "RECEPTION" }, slot.time),
    ).toThrow();

    expect(() =>
      dispatch(state, { type: "EscalatePriority", queueEntryId: entryId, tier: 2, reason: "chest pain", actorRole: "DOCTOR" }, slot.time),
    ).not.toThrow();
  });

  it("reception cannot start a consultation", () => {
    let state = createInitialState();
    ({ state } = dispatch(state, { type: "OpenSession", doctorId: "sharma", date: MONDAY, windowIndex: 0 }, SHARMA_OPEN));
    ({ state } = dispatch(state, { type: "RegisterPatient", name: "A", phone: "1" }, SHARMA_OPEN));
    const patientId = Object.keys(state.patients)[0];
    const slot = Object.values(state.slots).find((s) => s.doctorId === "sharma" && s.index === 0)!;
    ({ state } = dispatch(state, { type: "BookAppointment", patientId, doctorId: "sharma", slotId: slot.id, reason: "x", bookingSource: "PATIENT", paymentStatus: "PAY_AT_CLINIC" }, SHARMA_OPEN));
    const appointmentId = Object.keys(state.appointments)[0];
    ({ state } = dispatch(state, { type: "CheckInPatient", appointmentId }, slot.time));
    const entryId = Object.values(state.queueEntries)[0].id;

    expect(() => dispatch(state, { type: "StartConsultation", queueEntryId: entryId, actorRole: "RECEPTION" }, slot.time)).toThrow();
  });

  it("only admin can reconfigure a session or change fees", () => {
    let state = createInitialState();
    ({ state } = dispatch(state, { type: "OpenSession", doctorId: "sharma", date: MONDAY, windowIndex: 0 }, SHARMA_OPEN));
    expect(() => dispatch(state, { type: "ChangeFeeConfig", doctorId: "sharma", fee: 500, actorRole: "RECEPTION" }, SHARMA_OPEN)).toThrow();
    expect(() =>
      dispatch(state, { type: "ReconfigureSession", templateId: "sharma-MON-0", patch: { minProtected: 1 }, actorRole: "DOCTOR" }, SHARMA_OPEN),
    ).toThrow();
  });
});
