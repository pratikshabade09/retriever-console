import { describe, expect, it } from "vitest";
import { createInitialState, reduce } from "../reducer";
import { buildSessionSlots } from "../sessionSlots";
import { SESSION_TEMPLATES, DEFAULT_POLICY } from "../seed";
import { dateToAbsoluteMinutes } from "../time";
import type { Event } from "../events";

const BASE_DATE = "2026-01-05";

function sessionOpenedEvent(sessionId: string, templateId: string): Event {
  const template = SESSION_TEMPLATES.find((t) => t.id === templateId)!;
  const slots = buildSessionSlots({ sessionId, template, date: BASE_DATE });
  return {
    type: "SessionOpened",
    ts: 1000,
    actorRole: "SYSTEM",
    actorId: "system",
    aggregateType: "DoctorSession",
    aggregateId: sessionId,
    v: 1,
    sessionId,
    templateId,
    doctorId: template.doctorId,
    date: BASE_DATE,
    windowIndex: template.windowIndex,
    startAt: dateToAbsoluteMinutes(BASE_DATE, template.startMinutes),
    endAt: dateToAbsoluteMinutes(BASE_DATE, template.endMinutes),
    slotLengthMinutes: template.slotLengthMinutes,
    totalSlots: template.totalSlots,
    minProtected: template.minProtected,
    slots,
  };
}

describe("reduce(SessionOpened)", () => {
  it("materializes the session and its slot layout from the template", () => {
    const state = reduce(createInitialState(), sessionOpenedEvent("sess-sharma-1", "sharma-MON-0"));

    const session = state.sessions["sess-sharma-1"];
    expect(session).toBeDefined();
    expect(session.status).toBe("OPEN");
    expect(session.doctorId).toBe("sharma");
    expect(session.runningDelayMinutes).toBe(0);
    expect(session.minProtected).toBe(2);

    const slots = Object.values(state.slots).filter((s) => s.sessionId === "sess-sharma-1");
    expect(slots).toHaveLength(12);
    expect(slots.filter((s) => s.state === "PROTECTED")).toHaveLength(4);
    expect(slots.filter((s) => s.state === "OPEN")).toHaveLength(8);
    expect(slots.every((s) => s.appointmentId === null && s.visitId === null)).toBe(true);
  });

  it("keeps two sessions for the same doctor on the same day independent (Khan AM/PM)", () => {
    let state = createInitialState();
    state = reduce(state, sessionOpenedEvent("sess-khan-am", "khan-TUE-0"));
    state = reduce(state, sessionOpenedEvent("sess-khan-pm", "khan-TUE-1"));

    expect(Object.keys(state.sessions)).toHaveLength(2);
    const amSlots = Object.values(state.slots).filter((s) => s.sessionId === "sess-khan-am");
    const pmSlots = Object.values(state.slots).filter((s) => s.sessionId === "sess-khan-pm");
    expect(amSlots).toHaveLength(6);
    expect(pmSlots).toHaveLength(6);
  });
});

describe("reduce(CapacityReclaimed) — the central guarantee", () => {
  function stateWithOneBookedAndOneReleasedSlot() {
    let state = reduce(createInitialState(), sessionOpenedEvent("sess-sharma-1", "sharma-MON-0"));
    const slotIds = Object.keys(state.slots).sort();
    const bookedSlotId = slotIds[1]; // index 1 is PROTECTED per the spacing formula
    const releasedSlotId = slotIds[4]; // index 4 is also PROTECTED

    // Simulate a prior booking directly (BookAppointment/decide() is a later stage) and a
    // separate release, so we have one BOOKED and one RELEASED slot to reclaim against.
    state = {
      ...state,
      slots: {
        ...state.slots,
        [bookedSlotId]: { ...state.slots[bookedSlotId], state: "BOOKED", appointmentId: "appt-1" },
        [releasedSlotId]: { ...state.slots[releasedSlotId], state: "RELEASED", wasReleased: true },
      },
    };
    return { state, bookedSlotId, releasedSlotId };
  }

  it("refuses to move a BOOKED slot back to PROTECTED even when the event asks for it", () => {
    const { state, bookedSlotId } = stateWithOneBookedAndOneReleasedSlot();

    const reclaimEvent: Event = {
      type: "CapacityReclaimed",
      ts: 2000,
      actorRole: "SYSTEM",
      actorId: "system",
      aggregateType: "CapacityLedger",
      aggregateId: "ledger-1",
      v: 1,
      ledgerId: "ledger-1",
      doctorId: "sharma",
      slotIds: [bookedSlotId],
      action: "RECLAIM",
      protectedBefore: 3,
      protectedAfter: 4,
      delta: 1,
      reason: "test: attempting to reclaim a booked slot",
      trigger: "test",
      forecastWalkinCount: 1,
      requiredCapacity: 1,
      margin: 0,
      remainingMinutes: 60,
      policyVersion: DEFAULT_POLICY.policyVersion,
    };

    const next = reduce(state, reclaimEvent);

    expect(next.slots[bookedSlotId].state).toBe("BOOKED");
    expect(next.slots[bookedSlotId].appointmentId).toBe("appt-1");
    // The ledger still records what was asked, even though the reducer refused the mutation —
    // the ledger is a log of the policy's decisions, not a claim about what state now holds.
    expect(next.capacityLedger).toHaveLength(1);
    expect(next.capacityLedger[0].action).toBe("RECLAIM");
  });

  it("reclaims a RELEASED, still-unbooked slot back to PROTECTED", () => {
    const { state, releasedSlotId } = stateWithOneBookedAndOneReleasedSlot();

    const reclaimEvent: Event = {
      type: "CapacityReclaimed",
      ts: 2000,
      actorRole: "SYSTEM",
      actorId: "system",
      aggregateType: "CapacityLedger",
      aggregateId: "ledger-2",
      v: 1,
      ledgerId: "ledger-2",
      doctorId: "sharma",
      slotIds: [releasedSlotId],
      action: "RECLAIM",
      protectedBefore: 3,
      protectedAfter: 4,
      delta: 1,
      reason: "test: reclaiming a free released slot",
      trigger: "test",
      forecastWalkinCount: 1,
      requiredCapacity: 1,
      margin: 0,
      remainingMinutes: 60,
      policyVersion: DEFAULT_POLICY.policyVersion,
    };

    const next = reduce(state, reclaimEvent);
    expect(next.slots[releasedSlotId].state).toBe("PROTECTED");
  });
});
