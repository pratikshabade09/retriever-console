import { describe, expect, it } from "vitest";
import { dispatch, createInitialState, MONDAY } from "./helpers";
import { dateToAbsoluteMinutes } from "../time";

const SHARMA_OPEN = dateToAbsoluteMinutes(MONDAY, 9 * 60);
const KHAN_OPEN = dateToAbsoluteMinutes(MONDAY, 9 * 60);

function slotByIndex(state: ReturnType<typeof createInitialState>, doctorId: string, index: number) {
  return Object.values(state.slots).find((s) => s.doctorId === doctorId && s.index === index)!;
}

describe("test 12: token numbers", () => {
  it("are unique, sequential, and shared across doctors for the day", () => {
    let state = createInitialState();
    ({ state } = dispatch(state, { type: "OpenSession", doctorId: "sharma", date: MONDAY, windowIndex: 0 }, SHARMA_OPEN));
    ({ state } = dispatch(state, { type: "OpenSession", doctorId: "khan", date: MONDAY, windowIndex: 0 }, KHAN_OPEN));

    const bookings: number[] = [];
    for (let i = 0; i < 3; i++) {
      const name = `Sharma Patient ${i}`;
      ({ state } = dispatch(state, { type: "RegisterPatient", name, phone: String(i) }, SHARMA_OPEN));
      const patientId = Object.values(state.patients).find((p) => p.name === name)!.id;
      const slot = slotByIndex(state, "sharma", [0, 2, 3][i]); // avoid the protected indices {1,4,7,10}
      ({ state } = dispatch(state, { type: "BookAppointment", patientId, doctorId: "sharma", slotId: slot.id, reason: "x", bookingSource: "PATIENT", paymentStatus: "PAY_AT_CLINIC" }, SHARMA_OPEN));
      bookings.push(Object.values(state.appointments).find((a) => a.patientId === patientId)!.tokenNumber);
    }

    ({ state } = dispatch(state, { type: "RegisterPatient", name: "Khan Patient", phone: "khan" }, KHAN_OPEN));
    const khanPatientId = Object.values(state.patients).find((p) => p.name === "Khan Patient")!.id;
    const khanSlot = slotByIndex(state, "khan", 0);
    ({ state } = dispatch(state, { type: "BookAppointment", patientId: khanPatientId, doctorId: "khan", slotId: khanSlot.id, reason: "x", bookingSource: "PATIENT", paymentStatus: "PAY_AT_CLINIC" }, KHAN_OPEN));
    const khanToken = Object.values(state.appointments).find((a) => a.patientId === khanPatientId)!.tokenNumber;

    const allTokens = [...bookings, khanToken];
    expect(allTokens).toEqual([1, 2, 3, 4]);
    expect(new Set(allTokens).size).toBe(allTokens.length);
  });
});
