// RegisterDoctor: the one way a new doctor (and therefore a new bookable schedule) enters the
// clinic. Until admin runs it, a doctor only exists if lib/engine/seed.ts seeded them.

import { describe, expect, it } from "vitest";
import { dispatch, createInitialState, MONDAY } from "./helpers";
import { doctorSummaries } from "../projections";
import { currentFee } from "../money";
import { dateToAbsoluteMinutes } from "../time";
import type { EngineState } from "../state";

const ADMIN = { actorRole: "ADMIN" as const, actorId: "admin-1" };
const MONDAY_9AM = dateToAbsoluteMinutes(MONDAY, 9 * 60);

const DR_RAO = {
  type: "RegisterDoctor" as const,
  name: "Dr. Rao",
  specialty: "Orthopaedic",
  room: "Room 4",
  consultationFee: 450,
  ...ADMIN,
};

function register(state: EngineState) {
  return dispatch(state, DR_RAO, MONDAY_9AM);
}

describe("RegisterDoctor", () => {
  it("adds a doctor, their fee, and a default week they can actually be booked into", () => {
    const before = Object.keys(createInitialState().doctors).length;
    const { state, events } = register(createInitialState());

    expect(events.map((e) => e.type)).toEqual(["DoctorRegistered"]);
    expect(Object.keys(state.doctors)).toHaveLength(before + 1);

    const doctor = Object.values(state.doctors).find((d) => d.name === "Dr. Rao")!;
    expect(doctor.specialty).toBe("Orthopaedic");
    expect(doctor.room).toBe("Room 4");
    expect(state.feeHistory.filter((f) => f.doctorId === doctor.id)).toEqual([
      { doctorId: doctor.id, fee: 450, effectiveFrom: MONDAY_9AM },
    ]);

    // Monday–Saturday, like the seeded doctors: no Sunday, and never a day with no template.
    const templates = Object.values(state.sessionTemplates).filter((t) => t.doctorId === doctor.id);
    expect(templates.map((t) => t.weekday)).toEqual(["MON", "TUE", "WED", "THU", "FRI", "SAT"]);
  });

  it("makes the new doctor visible to the public booking flow", () => {
    const { state } = register(createInitialState());
    const doctor = Object.values(state.doctors).find((d) => d.name === "Dr. Rao")!;
    const summary = doctorSummaries(state, MONDAY_9AM).find((d) => d.id === doctor.id);

    // Without a session template a doctor would appear here with no availableDays and no slot
    // could ever be opened for them.
    expect(summary?.consultationFee).toBe(450);
    expect(summary?.availableDays).toHaveLength(6);
  });

  it("produces real bookable slots once one of their sessions opens", () => {
    let state = register(createInitialState()).state;
    const doctor = Object.values(state.doctors).find((d) => d.name === "Dr. Rao")!;

    ({ state } = dispatch(state, { type: "OpenSession", doctorId: doctor.id, date: MONDAY, windowIndex: 0 }, MONDAY_9AM));

    const slots = Object.values(state.slots).filter((s) => s.doctorId === doctor.id);
    expect(slots).toHaveLength(12); // 09:00–13:00 in 20-minute slots
    expect(slots.filter((s) => s.state === "OPEN")).toHaveLength(10); // minus the 2 protected
  });

  it("charges the new fee from registration onward, never retroactively", () => {
    const { state } = register(createInitialState());
    const doctor = Object.values(state.doctors).find((d) => d.name === "Dr. Rao")!;

    expect(currentFee(state, doctor.id, MONDAY_9AM - 1)).toBe(0);
    expect(currentFee(state, doctor.id, MONDAY_9AM)).toBe(450);
  });

  it("refuses anyone but an admin", () => {
    expect(() =>
      dispatch(createInitialState(), { ...DR_RAO, actorRole: "RECEPTION", actorId: "desk-1" }, MONDAY_9AM),
    ).toThrow(/Only admin/);
  });

  it("rejects a doctor the clinic already has, and a nonsensical fee", () => {
    const { state } = register(createInitialState());

    expect(() => dispatch(state, { ...DR_RAO, name: "Dr. RAO" }, MONDAY_9AM)).toThrow(/already in the clinic/);
    expect(() => dispatch(state, { ...DR_RAO, name: "Dr. Bose", consultationFee: -1 }, MONDAY_9AM)).toThrow(/non-negative/);
    expect(() => dispatch(state, { ...DR_RAO, name: "Dr. Bose", specialty: "  " }, MONDAY_9AM)).toThrow(/specialty/);
  });
});
