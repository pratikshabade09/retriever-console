// Initial configuration data: the doctors the clinic opens with, their recurring session
// templates, fees, walk-in history, and the capacity policy. This is static seed data, not
// event-sourced state — the templates describe recurring *shape*; the DoctorSession/Slot rows
// they produce are real state, folded from a SessionOpened event (see sessionSlots.ts and
// reducer.ts).
//
// It is the *starting* set, not the whole set: admin can add a doctor at runtime (the
// RegisterDoctor command), and a doctor added that way starts on DEFAULT_DOCTOR_SCHEDULE below.

import type {
  CapacityPolicyConfig,
  Doctor,
  FeeConfigRow,
  Service,
  SessionTemplate,
  Weekday,
  WalkInRatePoint,
} from "./types";

export const DOCTORS: Doctor[] = [
  { id: "sharma", name: "Dr. Sharma", specialty: "General Physician", room: "Room 1" },
  { id: "iyer", name: "Dr. Iyer", specialty: "Cardiologist", room: "Room 2" },
  { id: "khan", name: "Dr. Khan", specialty: "Dermatologist", room: "Room 3" },
];

export const INITIAL_FEES: FeeConfigRow[] = [
  { doctorId: "sharma", fee: 300, effectiveFrom: 0 },
  { doctorId: "iyer", fee: 600, effectiveFrom: 0 },
  { doctorId: "khan", fee: 410, effectiveFrom: 0 },
];

const MON_TO_SAT: Weekday[] = ["MON", "TUE", "WED", "THU", "FRI", "SAT"];

function template(
  doctorId: string,
  weekday: Weekday,
  windowIndex: number,
  startMinutes: number,
  endMinutes: number,
  slotLengthMinutes: number,
  initialProtected: number,
  minProtected: number,
): SessionTemplate {
  const totalSlots = (endMinutes - startMinutes) / slotLengthMinutes;
  return {
    id: `${doctorId}-${weekday}-${windowIndex}`,
    doctorId,
    weekday,
    windowIndex,
    startMinutes,
    endMinutes,
    slotLengthMinutes,
    totalSlots,
    initialProtected,
    minProtected,
  };
}

export const SESSION_TEMPLATES: SessionTemplate[] = [
  ...MON_TO_SAT.map((day) => template("sharma", day, 0, 9 * 60, 13 * 60, 20, 4, 2)),
  ...(["MON", "WED", "FRI"] as Weekday[]).map((day) => template("iyer", day, 0, 10 * 60, 13 * 60, 20, 2, 1)),
  ...MON_TO_SAT.flatMap((day) => [
    template("khan", day, 0, 9 * 60, 11 * 60, 20, 3, 1),
    template("khan", day, 1, 15 * 60, 17 * 60, 20, 3, 1),
  ]),
];

/** What a newly registered doctor's week looks like until an admin reconfigures it: Monday to
 * Saturday, one 09:00–13:00 window of 20-minute slots, with a small walk-in reserve. A doctor
 * with no template at all could never have a slot opened, so every doctor needs a week. */
export const DEFAULT_DOCTOR_SCHEDULE = {
  weekdays: MON_TO_SAT,
  startMinutes: 9 * 60,
  endMinutes: 13 * 60,
  slotLengthMinutes: 20,
  initialProtected: 2,
  minProtected: 1,
};

/** A new doctor's recurring sessions, built with the same id convention as the seeded ones
 * (`${doctorId}-${weekday}-${windowIndex}`) so OpenSession and the admin Sessions editor find
 * them exactly like any other template. */
export function defaultTemplatesFor(doctorId: string): SessionTemplate[] {
  const schedule = DEFAULT_DOCTOR_SCHEDULE;
  return schedule.weekdays.map((weekday) =>
    template(
      doctorId,
      weekday,
      0,
      schedule.startMinutes,
      schedule.endMinutes,
      schedule.slotLengthMinutes,
      schedule.initialProtected,
      schedule.minProtected,
    ),
  );
}

export const WALK_IN_RATES: WalkInRatePoint[] = [
  { doctorId: "sharma", hour: 9, ratePerHour: 0.4 },
  { doctorId: "sharma", hour: 10, ratePerHour: 0.4 },
  { doctorId: "sharma", hour: 11, ratePerHour: 1.8 },
  { doctorId: "sharma", hour: 12, ratePerHour: 1.8 },
  { doctorId: "khan", hour: 9, ratePerHour: 0.2 },
  { doctorId: "khan", hour: 10, ratePerHour: 0.3 },
  { doctorId: "khan", hour: 15, ratePerHour: 0.9 },
  { doctorId: "khan", hour: 16, ratePerHour: 0.9 },
  ...[9, 10, 11, 12, 13, 14, 15, 16, 17].map((hour) => ({
    doctorId: "iyer",
    hour,
    ratePerHour: 0.1,
  })),
];

export const SERVICES: Service[] = [
  { id: "cbc", name: "Complete blood count", turnaroundMinutes: 30, price: 300 },
  { id: "ecg", name: "ECG", turnaroundMinutes: 20, price: 400 },
  { id: "rbs", name: "Random blood sugar", turnaroundMinutes: 15, price: 150 },
  { id: "skin-scraping", name: "Skin scraping", turnaroundMinutes: 25, price: 350 },
];

// reclaimMargin must stay strictly below releaseMargin — the gap between the two thresholds
// is the hysteresis. Set them equal and the policy releases a slot then immediately
// reclaims it, forever.
export const DEFAULT_POLICY: CapacityPolicyConfig = {
  policyVersion: "capacity-v1",
  protectionHorizonMinutes: 120,
  releaseMargin: 1,
  reclaimMargin: 0,
  minMeaningfulDelta: 1,
  cooldownMinutes: 20,
  evaluationIntervalMinutes: 5,
  noShowGraceMinutes: 15,
  reviewCreditMinutes: 20,
  baselineWalkinRatePerHour: 1.5,
};
