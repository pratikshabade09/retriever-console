import { describe, expect, it } from "vitest";
import { dispatch, createInitialState, MONDAY } from "./helpers";
import { compareQueueEntries } from "../queue";
import { dateToAbsoluteMinutes } from "../time";
import type { QueueEntry } from "../types";

const SHARMA_OPEN = dateToAbsoluteMinutes(MONDAY, 9 * 60);

function openSharmaAndRegisterPatient(name: string) {
  let state = createInitialState();
  ({ state } = dispatch(state, { type: "OpenSession", doctorId: "sharma", date: MONDAY, windowIndex: 0 }, SHARMA_OPEN));
  ({ state } = dispatch(state, { type: "RegisterPatient", name, phone: "000" }, SHARMA_OPEN));
  const patientId = Object.keys(state.patients).find((id) => state.patients[id].name === name)!;
  return { state, patientId };
}

function slotByIndex(state: ReturnType<typeof createInitialState>, doctorId: string, index: number) {
  return Object.values(state.slots).find((s) => s.doctorId === doctorId && s.index === index)!;
}

describe("test 2: no displacement", () => {
  it("survives ten ReclaimCapacity calls across the session without ever un-booking the patient", () => {
    let state = createInitialState();
    ({ state } = dispatch(state, { type: "OpenSession", doctorId: "sharma", date: MONDAY, windowIndex: 0 }, SHARMA_OPEN));
    ({ state } = dispatch(state, { type: "EvaluateCapacity", doctorId: "sharma", trigger: "scheduled" }, SHARMA_OPEN));
    const released = Object.values(state.slots).find((s) => s.doctorId === "sharma" && s.state === "RELEASED")!;

    ({ state } = dispatch(state, { type: "RegisterPatient", name: "Priya", phone: "222" }, SHARMA_OPEN));
    const patientId = Object.keys(state.patients)[0];
    ({ state } = dispatch(
      state,
      { type: "BookAppointment", patientId, doctorId: "sharma", slotId: released.id, reason: "checkup", bookingSource: "PATIENT", paymentStatus: "PAY_AT_CLINIC" },
      SHARMA_OPEN,
    ));
    const appointmentId = Object.keys(state.appointments)[0];
    ({ state } = dispatch(state, { type: "CheckInPatient", appointmentId }, SHARMA_OPEN + 5));

    expect(state.slots[released.id].state).toBe("BOOKED");
    expect(state.appointments[appointmentId].status).toBe("ARRIVED");

    for (let i = 0; i < 10; i++) {
      const now = SHARMA_OPEN + 5 + i * 10;
      expect(() => {
        ({ state } = dispatch(state, { type: "ReclaimCapacity", doctorId: "sharma", count: 5 }, now));
      }).not.toThrow();
      expect(state.slots[released.id].state).toBe("BOOKED");
      expect(state.slots[released.id].appointmentId).toBe(appointmentId);
      expect(state.appointments[appointmentId].status).toBe("ARRIVED");
    }
  });
});

describe("test 5 & 6: effective ready time", () => {
  it("arriving early does not advance you ahead of your slot time", () => {
    const initial = openSharmaAndRegisterPatient("Early Bird");
    const { patientId } = initial;
    let state = initial.state;
    const slot = slotByIndex(state, "sharma", 5); // 10:40
    ({ state } = dispatch(state, { type: "BookAppointment", patientId, doctorId: "sharma", slotId: slot.id, reason: "checkup", bookingSource: "PATIENT", paymentStatus: "PAY_AT_CLINIC" }, SHARMA_OPEN));
    const appointmentId = Object.keys(state.appointments)[0];

    const earlyArrival = slot.time - 20;
    ({ state } = dispatch(state, { type: "CheckInPatient", appointmentId }, earlyArrival));
    const entry = Object.values(state.queueEntries)[0];
    expect(entry.effectiveReadyTime).toBe(slot.time);
  });

  it("arriving late costs you your place — effective ready time is your actual arrival", () => {
    const initial = openSharmaAndRegisterPatient("Late Arrival");
    const { patientId } = initial;
    let state = initial.state;
    const slot = slotByIndex(state, "sharma", 6); // 11:00
    ({ state } = dispatch(state, { type: "BookAppointment", patientId, doctorId: "sharma", slotId: slot.id, reason: "checkup", bookingSource: "PATIENT", paymentStatus: "PAY_AT_CLINIC" }, SHARMA_OPEN));
    const appointmentId = Object.keys(state.appointments)[0];

    const lateArrival = slot.time + 15;
    ({ state } = dispatch(state, { type: "CheckInPatient", appointmentId }, lateArrival));
    const entry = Object.values(state.queueEntries)[0];
    expect(entry.effectiveReadyTime).toBe(lateArrival);
  });
});

describe("test 9: payment never buys priority", () => {
  it("compareQueueEntries has no notion of payment — it cannot read a field that does not exist on QueueEntry", () => {
    const base: Omit<QueueEntry, "id" | "enteredAt"> = {
      doctorId: "sharma",
      visitId: "visit-x",
      queueType: "CONSULT",
      effectiveReadyTime: 100,
      exitedAt: null,
      status: "WAITING",
      priorityTier: 0,
      priorityReason: null,
      priorityActor: null,
    };
    const first: QueueEntry = { ...base, id: "queue-1", enteredAt: 100 };
    const second: QueueEntry = { ...base, id: "queue-2", enteredAt: 105 };
    expect(compareQueueEntries(first, second)).toBeLessThan(0);
    expect(compareQueueEntries(second, first)).toBeGreaterThan(0);
  });

  it("a PAY_AT_CLINIC patient who arrives first stays ahead of a PREPAID patient who arrives later", () => {
    let state = createInitialState();
    ({ state } = dispatch(state, { type: "OpenSession", doctorId: "sharma", date: MONDAY, windowIndex: 0 }, SHARMA_OPEN));

    ({ state } = dispatch(state, { type: "RegisterPatient", name: "Pay At Clinic", phone: "1" }, SHARMA_OPEN));
    const payAtClinicId = Object.keys(state.patients)[0];
    ({ state } = dispatch(state, { type: "RegisterPatient", name: "Prepaid", phone: "2" }, SHARMA_OPEN));
    const prepaidId = Object.keys(state.patients).find((id) => id !== payAtClinicId)!;

    const slotA = slotByIndex(state, "sharma", 2); // 09:40
    const slotB = slotByIndex(state, "sharma", 3); // 10:00
    ({ state } = dispatch(state, { type: "BookAppointment", patientId: payAtClinicId, doctorId: "sharma", slotId: slotA.id, reason: "a", bookingSource: "PATIENT", paymentStatus: "PAY_AT_CLINIC" }, SHARMA_OPEN));
    ({ state } = dispatch(state, { type: "BookAppointment", patientId: prepaidId, doctorId: "sharma", slotId: slotB.id, reason: "b", bookingSource: "PATIENT", paymentStatus: "PREPAID" }, SHARMA_OPEN));

    const payAtClinicAppt = Object.values(state.appointments).find((a) => a.patientId === payAtClinicId)!;
    const prepaidAppt = Object.values(state.appointments).find((a) => a.patientId === prepaidId)!;

    // Both arrive well after their slot times, so effectiveReadyTime == arrival time for both;
    // the pay-at-clinic patient simply walks in first.
    const lateNow = dateToAbsoluteMinutes(MONDAY, 12 * 60);
    ({ state } = dispatch(state, { type: "CheckInPatient", appointmentId: payAtClinicAppt.id }, lateNow));
    ({ state } = dispatch(state, { type: "CheckInPatient", appointmentId: prepaidAppt.id }, lateNow + 5));

    const ordered = Object.values(state.queueEntries).sort(compareQueueEntries);
    expect(ordered[0].visitId).toBe(Object.values(state.visits).find((v) => v.patientId === payAtClinicId)!.id);
    expect(ordered[1].visitId).toBe(Object.values(state.visits).find((v) => v.patientId === prepaidId)!.id);
  });
});
