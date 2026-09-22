import { describe, expect, it } from "vitest";
import { dispatch, createInitialState, MONDAY } from "./helpers";
import { dateToAbsoluteMinutes } from "../time";

const SHARMA_OPEN = dateToAbsoluteMinutes(MONDAY, 9 * 60);

function slotByIndex(state: ReturnType<typeof createInitialState>, doctorId: string, index: number) {
  return Object.values(state.slots).find((s) => s.doctorId === doctorId && s.index === index)!;
}

describe("test 13: fee changes do not rewrite history", () => {
  it("a charge keeps its snapshot fee even after the doctor's fee changes", () => {
    let state = createInitialState();
    ({ state } = dispatch(state, { type: "OpenSession", doctorId: "sharma", date: MONDAY, windowIndex: 0 }, SHARMA_OPEN));
    ({ state } = dispatch(state, { type: "RegisterPatient", name: "Fee Patient", phone: "1" }, SHARMA_OPEN));
    const patientId = Object.keys(state.patients)[0];
    const slot = slotByIndex(state, "sharma", 0);
    ({ state } = dispatch(state, { type: "BookAppointment", patientId, doctorId: "sharma", slotId: slot.id, reason: "x", bookingSource: "PATIENT", paymentStatus: "PAY_AT_CLINIC" }, SHARMA_OPEN));
    const appointmentId = Object.keys(state.appointments)[0];

    ({ state } = dispatch(state, { type: "CheckInPatient", appointmentId }, slot.time));
    const visitId = Object.keys(state.visits)[0];
    const entryId = Object.values(state.queueEntries)[0].id;
    ({ state } = dispatch(state, { type: "StartConsultation", queueEntryId: entryId, actorRole: "DOCTOR" }, slot.time));
    ({ state } = dispatch(state, { type: "CompleteConsultation", visitId, actorRole: "DOCTOR" }, slot.time + 5));

    const charge = Object.values(state.charges).find((c) => c.visitId === visitId && c.kind === "CONSULTATION")!;
    expect(charge.unitPriceSnapshot).toBe(300);
    const invoiceBefore = Object.values(state.invoices).find((inv) => inv.visitId === visitId)!;
    expect(invoiceBefore.total).toBe(300);

    ({ state } = dispatch(state, { type: "ChangeFeeConfig", doctorId: "sharma", fee: 500, actorRole: "ADMIN" }, slot.time + 10));

    const chargeAfter = state.charges[charge.id];
    expect(chargeAfter.unitPriceSnapshot).toBe(300);
    expect(chargeAfter.amount).toBe(300);
    const invoiceAfter = state.invoices[invoiceBefore.id];
    expect(invoiceAfter.total).toBe(300);
  });
});
