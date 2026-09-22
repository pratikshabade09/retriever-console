import { describe, expect, it } from "vitest";
import { buildSessionSlots, protectedSlotIndices } from "../sessionSlots";
import { SESSION_TEMPLATES } from "../seed";
import { dateToAbsoluteMinutes } from "../time";

const BASE_DATE = "2026-01-05";

describe("protectedSlotIndices", () => {
  it("spreads protected slots through the session, not at the end", () => {
    // Sharma: 12 slots, 4 protected -> spaced at (k+0.5)*12/4 for k in 0..3
    expect(protectedSlotIndices(12, 4)).toEqual(new Set([1, 4, 7, 10]));
    // Khan single window: 6 slots, 3 protected
    expect(protectedSlotIndices(6, 3)).toEqual(new Set([1, 3, 5]));
  });

  it("returns an empty set when nothing is protected", () => {
    expect(protectedSlotIndices(9, 0)).toEqual(new Set());
  });
});

describe("buildSessionSlots", () => {
  it("lays out Sharma's 12 slots with the protected ones spread through the day", () => {
    const template = SESSION_TEMPLATES.find((t) => t.id === "sharma-MON-0")!;
    const slots = buildSessionSlots({ sessionId: "sess-1", template, date: BASE_DATE });

    expect(slots).toHaveLength(12);
    expect(slots.map((s) => s.state)).toEqual([
      "OPEN", "PROTECTED", "OPEN", "OPEN",
      "PROTECTED", "OPEN", "OPEN", "PROTECTED",
      "OPEN", "OPEN", "PROTECTED", "OPEN",
    ]);

    expect(slots[0].time).toBe(dateToAbsoluteMinutes(BASE_DATE, 9 * 60));
    expect(slots[11].time).toBe(dateToAbsoluteMinutes(BASE_DATE, 9 * 60 + 11 * 20));
    expect(new Set(slots.map((s) => s.id)).size).toBe(12);
  });

  it("lays out each of Dr. Khan's two daily windows independently", () => {
    const morning = SESSION_TEMPLATES.find((t) => t.id === "khan-TUE-0")!;
    const evening = SESSION_TEMPLATES.find((t) => t.id === "khan-TUE-1")!;

    const morningSlots = buildSessionSlots({ sessionId: "sess-am", template: morning, date: BASE_DATE });
    const eveningSlots = buildSessionSlots({ sessionId: "sess-pm", template: evening, date: BASE_DATE });

    expect(morningSlots).toHaveLength(6);
    expect(eveningSlots).toHaveLength(6);
    expect(morningSlots[0].time).toBe(dateToAbsoluteMinutes(BASE_DATE, 9 * 60));
    expect(eveningSlots[0].time).toBe(dateToAbsoluteMinutes(BASE_DATE, 15 * 60));
  });
});
