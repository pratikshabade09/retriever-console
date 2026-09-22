import { describe, expect, it } from "vitest";
import { dispatch, createInitialState, MONDAY } from "./helpers";
import { dateToAbsoluteMinutes } from "../time";

const SHARMA_OPEN = dateToAbsoluteMinutes(MONDAY, 9 * 60);
const KHAN_OPEN = dateToAbsoluteMinutes(MONDAY, 9 * 60);

function slotByIndex(state: ReturnType<typeof createInitialState>, doctorId: string, index: number) {
  return Object.values(state.slots).find((s) => s.doctorId === doctorId && s.index === index)!;
}

describe("test 10: likely OPD time is monotonic under delay", () => {
  it("a doctor_running_late change never moves a time earlier", () => {
    let state = createInitialState();
    ({ state } = dispatch(state, { type: "OpenSession", doctorId: "sharma", date: MONDAY, windowIndex: 0 }, SHARMA_OPEN));

    ({ state } = dispatch(state, { type: "RegisterPatient", name: "A", phone: "1" }, SHARMA_OPEN));
    const patientA = Object.keys(state.patients)[0];
    ({ state } = dispatch(state, { type: "RegisterPatient", name: "B", phone: "2" }, SHARMA_OPEN));
    const patientB = Object.keys(state.patients).find((id) => id !== patientA)!;

    const slotA = slotByIndex(state, "sharma", 0); // 09:00 (OPEN)
    const slotB = slotByIndex(state, "sharma", 2); // 09:40 (OPEN; index 1 is protected)
    ({ state } = dispatch(state, { type: "BookAppointment", patientId: patientA, doctorId: "sharma", slotId: slotA.id, reason: "a", bookingSource: "PATIENT", paymentStatus: "PAY_AT_CLINIC" }, SHARMA_OPEN));
    ({ state } = dispatch(state, { type: "BookAppointment", patientId: patientB, doctorId: "sharma", slotId: slotB.id, reason: "b", bookingSource: "PATIENT", paymentStatus: "PAY_AT_CLINIC" }, SHARMA_OPEN));
    const apptA = Object.values(state.appointments).find((a) => a.patientId === patientA)!;
    const apptB = Object.values(state.appointments).find((a) => a.patientId === patientB)!;

    // A arrives exactly on time and starts late (doctor was already behind from a prior
    // patient) — this is what actually sets runningDelayMinutes.
    ({ state } = dispatch(state, { type: "CheckInPatient", appointmentId: apptA.id }, slotA.time));
    ({ state } = dispatch(state, { type: "CheckInPatient", appointmentId: apptB.id }, slotB.time));

    const entryA = Object.values(state.queueEntries).find((q) => q.visitId === Object.values(state.visits).find((v) => v.patientId === patientA)!.id)!;
    // Start A's consultation 15 minutes after their slot time: the doctor is running late.
    ({ state } = dispatch(state, { type: "StartConsultation", queueEntryId: entryA.id, actorRole: "DOCTOR" }, slotA.time + 15));

    const lateCauseChanges = state.opdChanges.filter((c) => c.cause === "doctor_running_late");
    expect(lateCauseChanges.length).toBeGreaterThan(0);
    for (const change of lateCauseChanges) {
      expect(change.to).toBeGreaterThan(change.from);
    }
  });
});

describe("test 11: notification on material change", () => {
  it("a 20-minute doctor pause notifies exactly the affected doctor's waiting patients", () => {
    let state = createInitialState();
    ({ state } = dispatch(state, { type: "OpenSession", doctorId: "sharma", date: MONDAY, windowIndex: 0 }, SHARMA_OPEN));
    ({ state } = dispatch(state, { type: "OpenSession", doctorId: "khan", date: MONDAY, windowIndex: 0 }, KHAN_OPEN));

    ({ state } = dispatch(state, { type: "RegisterPatient", name: "Sharma Patient", phone: "1" }, SHARMA_OPEN));
    const sharmaPatient = Object.keys(state.patients)[0];
    ({ state } = dispatch(state, { type: "RegisterPatient", name: "Khan Patient", phone: "2" }, SHARMA_OPEN));
    const khanPatient = Object.keys(state.patients).find((id) => id !== sharmaPatient)!;

    const sharmaSlot = slotByIndex(state, "sharma", 0); // 09:00 (OPEN)
    const khanSlot = slotByIndex(state, "khan", 0); // 09:00 (OPEN)
    ({ state } = dispatch(state, { type: "BookAppointment", patientId: sharmaPatient, doctorId: "sharma", slotId: sharmaSlot.id, reason: "a", bookingSource: "PATIENT", paymentStatus: "PAY_AT_CLINIC" }, SHARMA_OPEN));
    ({ state } = dispatch(state, { type: "BookAppointment", patientId: khanPatient, doctorId: "khan", slotId: khanSlot.id, reason: "b", bookingSource: "PATIENT", paymentStatus: "PAY_AT_CLINIC" }, KHAN_OPEN));
    const sharmaAppt = Object.values(state.appointments).find((a) => a.patientId === sharmaPatient)!;
    const khanAppt = Object.values(state.appointments).find((a) => a.patientId === khanPatient)!;

    ({ state } = dispatch(state, { type: "CheckInPatient", appointmentId: sharmaAppt.id }, sharmaSlot.time));
    ({ state } = dispatch(state, { type: "CheckInPatient", appointmentId: khanAppt.id }, khanSlot.time));

    const sharmaSession = Object.values(state.sessions).find((s) => s.doctorId === "sharma")!;
    const pauseAt = sharmaSlot.time;
    ({ state } = dispatch(state, { type: "PauseSession", sessionId: sharmaSession.id, reason: "break", actorRole: "DOCTOR" }, pauseAt));

    const opdChangesBeforeResume = state.opdChanges.length;
    ({ state } = dispatch(state, { type: "ResumeSession", sessionId: sharmaSession.id, actorRole: "DOCTOR" }, pauseAt + 20));

    const newChanges = state.opdChanges.slice(opdChangesBeforeResume);
    expect(newChanges).toHaveLength(1);
    expect(newChanges[0].doctorId).toBe("sharma");
    expect(newChanges[0].tokenNumber).toBe(sharmaAppt.tokenNumber);
    expect(state.opdChanges.some((c) => c.doctorId === "khan")).toBe(false);
  });
});
