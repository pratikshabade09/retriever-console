import { describe, expect, it } from "vitest";
import { dispatch, createInitialState, MONDAY, TUESDAY } from "./helpers";
import { dateToAbsoluteMinutes } from "../time";

const SHARMA_OPEN = dateToAbsoluteMinutes(MONDAY, 9 * 60);
const KHAN_OPEN = dateToAbsoluteMinutes(TUESDAY, 9 * 60);

function slotByIndex(state: ReturnType<typeof createInitialState>, doctorId: string, index: number) {
  return Object.values(state.slots).find((s) => s.doctorId === doctorId && s.index === index)!;
}

describe("test 7: walk-ins get no appointment", () => {
  it("consumes a protected slot and creates a visit with appointmentId null", () => {
    let state = createInitialState();
    ({ state } = dispatch(state, { type: "OpenSession", doctorId: "khan", date: TUESDAY, windowIndex: 0 }, KHAN_OPEN));
    ({ state } = dispatch(state, { type: "RegisterPatient", name: "Walk In", phone: "9" }, KHAN_OPEN));
    const patientId = Object.keys(state.patients)[0];

    const protectedSlot = slotByIndex(state, "khan", 1); // protected per the spacing formula
    expect(protectedSlot.state).toBe("PROTECTED");

    ({ state } = dispatch(state, { type: "RegisterWalkIn", patientId, doctorId: "khan", reason: "rash" }, KHAN_OPEN));

    expect(Object.keys(state.appointments)).toHaveLength(0);
    const visits = Object.values(state.visits);
    expect(visits).toHaveLength(1);
    expect(visits[0].appointmentId).toBeNull();
    expect(state.slots[protectedSlot.id].state).toBe("CONSUMED");
    expect(state.slots[protectedSlot.id].visitId).toBe(visits[0].id);
  });
});

describe("test 8: investigation re-entry", () => {
  it("consult -> order -> complete -> result -> review -> complete stays one visit, one consultation charge", () => {
    let state = createInitialState();
    ({ state } = dispatch(state, { type: "OpenSession", doctorId: "sharma", date: MONDAY, windowIndex: 0 }, SHARMA_OPEN));
    ({ state } = dispatch(state, { type: "RegisterPatient", name: "Reviewer", phone: "5" }, SHARMA_OPEN));
    const patientId = Object.keys(state.patients)[0];
    const slot = slotByIndex(state, "sharma", 0);
    ({ state } = dispatch(state, { type: "BookAppointment", patientId, doctorId: "sharma", slotId: slot.id, reason: "fatigue", bookingSource: "PATIENT", paymentStatus: "PAY_AT_CLINIC" }, SHARMA_OPEN));
    const appointmentId = Object.keys(state.appointments)[0];

    let now = slot.time;
    ({ state } = dispatch(state, { type: "CheckInPatient", appointmentId }, now));
    const visitId = Object.keys(state.visits)[0];
    const consultEntryId = Object.values(state.queueEntries).find((q) => q.visitId === visitId)!.id;

    ({ state } = dispatch(state, { type: "StartConsultation", queueEntryId: consultEntryId, actorRole: "DOCTOR" }, now));
    ({ state } = dispatch(state, { type: "OrderInvestigation", visitId, serviceId: "cbc", actorRole: "DOCTOR" }, now));
    now += 5;
    ({ state } = dispatch(state, { type: "CompleteConsultation", visitId, actorRole: "DOCTOR" }, now));
    expect(state.visits[visitId].status).toBe("INVESTIGATION_PENDING");

    now += 30;
    const investigationId = Object.keys(state.investigations)[0];
    ({ state } = dispatch(state, { type: "RecordInvestigationResult", investigationId, resultSummary: "normal counts", resultFlag: "NORMAL", actorRole: "DOCTOR" }, now));
    expect(state.visits[visitId].status).toBe("WAITING_REVIEW");

    const reviewEntryId = Object.values(state.queueEntries).find((q) => q.visitId === visitId && q.queueType === "REVIEW")!.id;
    now += 2;
    ({ state } = dispatch(state, { type: "StartReview", queueEntryId: reviewEntryId, actorRole: "DOCTOR" }, now));
    ({ state } = dispatch(state, { type: "CompleteReview", visitId, actorRole: "DOCTOR" }, now));

    expect(Object.keys(state.visits)).toHaveLength(1);
    expect(state.visits[visitId].status).toBe("CLOSED");
    const consultationCharges = Object.values(state.charges).filter((c) => c.visitId === visitId && c.kind === "CONSULTATION");
    expect(consultationCharges).toHaveLength(1);
    const queueTypesForVisit = Object.values(state.queueEntries).filter((q) => q.visitId === visitId).map((q) => q.queueType).sort();
    expect(queueTypesForVisit).toEqual(["CONSULT", "REVIEW"]);
  });
});
