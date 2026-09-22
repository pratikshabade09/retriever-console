// Pure slot-layout generation for a newly opened DoctorSession.

import type { SlotSeed } from "./events";
import type { SessionTemplate } from "./types";
import { dateToAbsoluteMinutes } from "./time";

/**
 * Protected slots are spread through the session, not parked at the end — unpredictable
 * demand arrives all day, so the reserve must be available all day.
 */
export function protectedSlotIndices(total: number, protectedCount: number): Set<number> {
  const indices = new Set<number>();
  for (let k = 0; k < protectedCount; k++) {
    indices.add(Math.floor(((k + 0.5) * total) / protectedCount));
  }
  return indices;
}

export function buildSessionSlots(params: {
  sessionId: string;
  template: SessionTemplate;
  date: string;
}): SlotSeed[] {
  const { sessionId, template, date } = params;
  const protectedIdx = protectedSlotIndices(template.totalSlots, template.initialProtected);
  const slots: SlotSeed[] = [];
  for (let index = 0; index < template.totalSlots; index++) {
    const time = dateToAbsoluteMinutes(date, template.startMinutes + index * template.slotLengthMinutes);
    slots.push({
      id: `${sessionId}-slot-${index}`,
      index,
      time,
      state: protectedIdx.has(index) ? "PROTECTED" : "OPEN",
    });
  }
  return slots;
}
