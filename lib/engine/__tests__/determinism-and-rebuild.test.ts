import { describe, expect, it } from "vitest";
import { dispatch, createInitialState, MONDAY } from "./helpers";
import { dateToAbsoluteMinutes } from "../time";
import { replay } from "../reducer";
import type { Event } from "../events";

const SHARMA_OPEN = dateToAbsoluteMinutes(MONDAY, 9 * 60);
const KHAN_OPEN = dateToAbsoluteMinutes(MONDAY, 9 * 60);

function slotByIndex(state: ReturnType<typeof createInitialState>, doctorId: string, index: number) {
  return Object.values(state.slots).find((s) => s.doctorId === doctorId && s.index === index)!;
}

/** A representative scripted clinic morning: two doctors, a booking, a walk-in, capacity
 * evaluation, a full consult-order-result-review cycle, and a cancellation. */
function runScript(): { events: Event[]; state: ReturnType<typeof createInitialState> } {
  let state = createInitialState();
  const allEvents: Event[] = [];
  const run = (command: Parameters<typeof dispatch>[1], now: number) => {
    const result = dispatch(state, command, now);
    allEvents.push(...result.events);
    state = result.state;
  };

  run({ type: "OpenSession", doctorId: "sharma", date: MONDAY, windowIndex: 0 }, SHARMA_OPEN);
  run({ type: "OpenSession", doctorId: "khan", date: MONDAY, windowIndex: 0 }, KHAN_OPEN);
  run({ type: "EvaluateCapacity", doctorId: "sharma", trigger: "scheduled" }, SHARMA_OPEN);

  run({ type: "RegisterPatient", name: "Asha", phone: "1" }, SHARMA_OPEN);
  const asha = Object.values(state.patients).find((p) => p.name === "Asha")!.id;
  const slot0 = slotByIndex(state, "sharma", 0);
  run({ type: "BookAppointment", patientId: asha, doctorId: "sharma", slotId: slot0.id, reason: "checkup", bookingSource: "PATIENT", paymentStatus: "PREPAID" }, SHARMA_OPEN);
  const ashaAppt = Object.values(state.appointments).find((a) => a.patientId === asha)!.id;
  run({ type: "CheckInPatient", appointmentId: ashaAppt }, slot0.time);
  const ashaVisit = Object.values(state.visits).find((v) => v.patientId === asha)!.id;
  const ashaEntry = Object.values(state.queueEntries).find((q) => q.visitId === ashaVisit)!.id;
  run({ type: "StartConsultation", queueEntryId: ashaEntry, actorRole: "DOCTOR" }, slot0.time);
  run({ type: "OrderInvestigation", visitId: ashaVisit, serviceId: "cbc", actorRole: "DOCTOR" }, slot0.time);
  run({ type: "CompleteConsultation", visitId: ashaVisit, actorRole: "DOCTOR" }, slot0.time + 8);
  const investigationId = Object.values(state.investigations).find((i) => i.visitId === ashaVisit)!.id;
  run({ type: "RecordInvestigationResult", investigationId, resultSummary: "normal", resultFlag: "NORMAL", actorRole: "DOCTOR" }, slot0.time + 40);
  const reviewEntry = Object.values(state.queueEntries).find((q) => q.visitId === ashaVisit && q.queueType === "REVIEW")!.id;
  run({ type: "StartReview", queueEntryId: reviewEntry, actorRole: "DOCTOR" }, slot0.time + 42);
  run({ type: "CompleteReview", visitId: ashaVisit, actorRole: "DOCTOR" }, slot0.time + 45);

  run({ type: "RegisterPatient", name: "Walker", phone: "2" }, KHAN_OPEN + 10);
  const walker = Object.values(state.patients).find((p) => p.name === "Walker")!.id;
  run({ type: "RegisterWalkIn", patientId: walker, doctorId: "khan", reason: "rash" }, KHAN_OPEN + 10);

  run({ type: "RegisterPatient", name: "Cancels", phone: "3" }, SHARMA_OPEN);
  const canceler = Object.values(state.patients).find((p) => p.name === "Cancels")!.id;
  const slot2 = slotByIndex(state, "sharma", 2);
  run({ type: "BookAppointment", patientId: canceler, doctorId: "sharma", slotId: slot2.id, reason: "follow-up", bookingSource: "PATIENT", paymentStatus: "PAY_AT_CLINIC" }, SHARMA_OPEN);
  const cancelerAppt = Object.values(state.appointments).find((a) => a.patientId === canceler)!.id;
  run({ type: "CancelAppointment", appointmentId: cancelerAppt }, SHARMA_OPEN + 15);

  return { events: allEvents, state };
}

describe("test 18: determinism", () => {
  it("the same scripted sequence run twice produces identical event JSON", () => {
    const first = runScript();
    const second = runScript();
    expect(JSON.stringify(first.events)).toEqual(JSON.stringify(second.events));
  });
});

describe("test 19: rebuild", () => {
  it("replaying the event log from scratch produces byte-identical state", () => {
    const { events, state } = runScript();
    const rebuilt = replay(events);
    expect(JSON.stringify(rebuilt)).toEqual(JSON.stringify(state));
  });
});
