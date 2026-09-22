import { describe, expect, it } from "vitest";
import { dispatch, createInitialState, MONDAY, TUESDAY } from "./helpers";
import { DEFAULT_POLICY } from "../seed";
import { dateToAbsoluteMinutes } from "../time";

const SHARMA_OPEN = dateToAbsoluteMinutes(MONDAY, 9 * 60); // 09:00

function openSharma(now = SHARMA_OPEN) {
  let state = createInitialState();
  ({ state } = dispatch(state, { type: "OpenSession", doctorId: "sharma", date: MONDAY, windowIndex: 0 }, now));
  return state;
}

describe("test 1: capacity release", () => {
  it("advancing a fresh Sharma session towards 09:30 releases surplus protected slots", () => {
    let state = openSharma();

    // Advance in the scheduler's 5-minute evaluation steps, as the real clock would.
    for (let now = SHARMA_OPEN; now <= SHARMA_OPEN + 30 && state.capacityLedger.length === 0; now += 5) {
      ({ state } = dispatch(state, { type: "EvaluateCapacity", doctorId: "sharma", trigger: "scheduled" }, now));
    }

    expect(state.capacityLedger.length).toBeGreaterThan(0);
    const first = state.capacityLedger[0];
    expect(first.action).toBe("RELEASE");
    expect(first.protectedBefore).toBe(4);
    expect(first.protectedAfter).toBe(2);
    const releasedCount = Object.values(state.slots).filter((s) => s.doctorId === "sharma" && s.state === "RELEASED").length;
    expect(releasedCount).toBe(2);
  });
});

describe("test 3: only unbooked capacity is reclaimable", () => {
  it("a reclaim moves only the still-free released slot, not the booked one", () => {
    let state = openSharma();
    ({ state } = dispatch(state, { type: "EvaluateCapacity", doctorId: "sharma", trigger: "scheduled" }, SHARMA_OPEN));
    const releasedSlots = Object.values(state.slots).filter((s) => s.doctorId === "sharma" && s.state === "RELEASED").sort((a, b) => a.time - b.time);
    expect(releasedSlots.length).toBe(2);
    const [toBook, toStayFree] = releasedSlots;

    ({ state } = dispatch(state, { type: "RegisterPatient", name: "Asha", phone: "111" }, SHARMA_OPEN));
    const patientId = Object.keys(state.patients)[0];
    ({ state } = dispatch(
      state,
      { type: "BookAppointment", patientId, doctorId: "sharma", slotId: toBook.id, reason: "checkup", bookingSource: "PATIENT", paymentStatus: "PAY_AT_CLINIC" },
      SHARMA_OPEN,
    ));
    expect(state.slots[toBook.id].state).toBe("BOOKED");

    ({ state } = dispatch(state, { type: "ReclaimCapacity", doctorId: "sharma", count: 2 }, SHARMA_OPEN));

    expect(state.slots[toBook.id].state).toBe("BOOKED");
    expect(state.slots[toStayFree.id].state).toBe("PROTECTED");
  });
});

describe("test 4: doctors are independent", () => {
  it("releasing capacity on Sharma never touches Khan's or Iyer's slots", () => {
    let state = createInitialState();
    ({ state } = dispatch(state, { type: "OpenSession", doctorId: "sharma", date: MONDAY, windowIndex: 0 }, SHARMA_OPEN));
    ({ state } = dispatch(state, { type: "OpenSession", doctorId: "iyer", date: MONDAY, windowIndex: 0 }, dateToAbsoluteMinutes(MONDAY, 10 * 60)));
    ({ state } = dispatch(state, { type: "OpenSession", doctorId: "khan", date: TUESDAY, windowIndex: 0 }, dateToAbsoluteMinutes(TUESDAY, 9 * 60)));

    const khanBefore = Object.values(state.slots).filter((s) => s.doctorId === "khan" && s.state === "PROTECTED").length;
    const iyerBefore = Object.values(state.slots).filter((s) => s.doctorId === "iyer" && s.state === "PROTECTED").length;

    ({ state } = dispatch(state, { type: "EvaluateCapacity", doctorId: "sharma", trigger: "scheduled" }, SHARMA_OPEN));

    expect(state.capacityLedger.every((row) => row.doctorId === "sharma")).toBe(true);
    expect(Object.values(state.slots).filter((s) => s.doctorId === "khan" && s.state === "PROTECTED")).toHaveLength(khanBefore);
    expect(Object.values(state.slots).filter((s) => s.doctorId === "iyer" && s.state === "PROTECTED")).toHaveLength(iyerBefore);
  });
});

describe("test 17: no oscillation", () => {
  it("reclaimMargin is strictly below releaseMargin", () => {
    expect(DEFAULT_POLICY.reclaimMargin).toBeLessThan(DEFAULT_POLICY.releaseMargin);
  });

  it("does not reclaim right after a release, at the same instant or a minute later", () => {
    let state = openSharma();
    ({ state } = dispatch(state, { type: "EvaluateCapacity", doctorId: "sharma", trigger: "scheduled" }, SHARMA_OPEN));
    expect(state.capacityLedger[0].action).toBe("RELEASE");

    ({ state } = dispatch(state, { type: "EvaluateCapacity", doctorId: "sharma", trigger: "scheduled" }, SHARMA_OPEN));
    ({ state } = dispatch(state, { type: "EvaluateCapacity", doctorId: "sharma", trigger: "scheduled" }, SHARMA_OPEN + 1));

    expect(state.capacityLedger.some((row) => row.action === "RECLAIM")).toBe(false);
  });
});
