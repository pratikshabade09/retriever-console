import { describe, expect, it } from "vitest";
import { dispatch, createInitialState, MONDAY } from "./helpers";
import { availabilityForDoctorDate } from "../projections";
import { dateToAbsoluteMinutes } from "../time";

const SHARMA_OPEN = dateToAbsoluteMinutes(MONDAY, 9 * 60);

describe("availabilityForDoctorDate", () => {
  it("excludes protected slots and anything already in the past relative to now", () => {
    let state = createInitialState();
    ({ state } = dispatch(state, { type: "OpenSession", doctorId: "sharma", date: MONDAY, windowIndex: 0 }, SHARMA_OPEN));

    // Well before the session (09:00): every non-protected slot is offered.
    const beforeAnyone = availabilityForDoctorDate(state, "sharma", MONDAY, SHARMA_OPEN);
    expect(beforeAnyone.length).toBe(8); // 12 total - 4 protected
    expect(beforeAnyone.every((s) => s.time >= SHARMA_OPEN)).toBe(true);

    // Mid-afternoon, well past the session's own end (13:00): nothing left to offer today,
    // even though several of those slots were never booked.
    const lateInTheDay = availabilityForDoctorDate(state, "sharma", MONDAY, dateToAbsoluteMinutes(MONDAY, 17 * 60));
    expect(lateInTheDay).toEqual([]);

    // Partway through the morning: only the slots at or after `now` are offered.
    const midMorning = dateToAbsoluteMinutes(MONDAY, 10 * 60);
    const partway = availabilityForDoctorDate(state, "sharma", MONDAY, midMorning);
    expect(partway.every((s) => s.time >= midMorning)).toBe(true);
    expect(partway.length).toBeLessThan(beforeAnyone.length);
  });
});
