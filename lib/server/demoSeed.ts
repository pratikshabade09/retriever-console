// Prototype scaffolding: the fixed demo identities, plus a little pre-existing history so the
// demo patient's "my appointments" list isn't empty on a brand-new database.
//
// This file deliberately imports nothing but the engine and the event store — world.ts imports
// it, so it must not import world.ts back (see demoAccounts.ts, which may).
//
// The history below is not a special "seed mode" inside the engine. It runs ordinary Commands
// through decide()/reduce() against a scratch state, exactly the way autopilot.ts builds a
// simulated day, just for one patient. Time enters as the explicit `now` argument it has always
// been, which is what lets the closed visit carry a realistic past timestamp (and therefore a
// realistic consultation-duration sample for the doctor) instead of collapsing to "just now".

import { decide } from "../engine/decide";
import { createInitialState, reduce } from "../engine/reducer";
import type { Command } from "../engine/commands";
import type { Event } from "../engine/events";
import { dateToAbsoluteMinutes, dayNumberToDate, weekdayFromDayNumber } from "../engine/time";
import { appendEvents, loadAllEvents } from "./store";
import type { StaffRole } from "./authStore";

/** One password for every demo identity — these accounts exist to be clicked, not to be safe. */
export const DEMO_PASSWORD = "demo1234";

export interface DemoStaffSeed {
  label: string;
  name: string;
  email: string;
  role: StaffRole;
  doctorId: string | null;
}

export const DEMO_STAFF: DemoStaffSeed[] = [
  { label: "Reception", name: "Demo Reception", email: "reception@demo.clinic", role: "RECEPTION", doctorId: null },
  { label: "Admin", name: "Demo Admin", email: "admin@demo.clinic", role: "ADMIN", doctorId: null },
  { label: "Doctor · Dr. Sharma", name: "Dr. Sharma", email: "doctor@demo.clinic", role: "DOCTOR", doctorId: "sharma" },
];

/** The patient account is bound to the Patient record this history registers — same phone, so
 * the account and its appointments are the same person. */
export const DEMO_PATIENT = {
  label: "Patient · Anita Rao",
  name: "Anita Rao",
  email: "patient@demo.clinic",
  phone: "+91 90000 00001",
};

const DEMO_DOCTOR_ID = "sharma";
const SYSTEM = { actorRole: "SYSTEM" as const, actorId: "demo-seed" };
const RECEPTION = { actorRole: "RECEPTION" as const, actorId: "demo-seed" };
const DOCTOR = { actorRole: "DOCTOR" as const, actorId: DEMO_DOCTOR_ID };
const PATIENT = { actorRole: "PATIENT" as const, actorId: "patient-portal" };

const DAY_START_MINUTE = 8 * 60;

/** Minute-of-day of an absolute-minute timestamp (the engine's local-calendar convention). */
function minuteOfDay(absoluteMinutes: number): number {
  return ((absoluteMinutes % 1440) + 1440) % 1440;
}

/** Dr. Sharma works Monday–Saturday, so walk to a day the clinic is actually open. */
function clinicDayAtOrBefore(dayNumber: number): number {
  let day = dayNumber;
  while (weekdayFromDayNumber(day) === "SUN") day -= 1;
  return day;
}

/**
 * Two facts about the demo patient: a consultation that already happened, and one still to
 * come. Both are built by the real command pipeline; nothing here writes state directly, and
 * the returned events are only appended when the event log is empty.
 */
export function buildDemoHistoryEvents(now: number): Event[] {
  let state = createInitialState();
  const events: Event[] = [];

  function run(command: Command, at: number): Event[] {
    const produced = decide(command, state, at);
    events.push(...produced);
    state = produced.reduce(reduce, state);
    return produced;
  }

  const today = Math.floor(now / 1440);

  // ---- a closed visit, four days back ----
  const pastDate = dayNumberToDate(clinicDayAtOrBefore(today - 4));
  const pastOpenAt = dateToAbsoluteMinutes(pastDate, DAY_START_MINUTE);
  run({ type: "OpenSession", doctorId: DEMO_DOCTOR_ID, date: pastDate, windowIndex: 0, ...SYSTEM }, pastOpenAt);
  run({ type: "RegisterPatient", name: DEMO_PATIENT.name, phone: DEMO_PATIENT.phone, ...RECEPTION }, pastOpenAt);

  const demoPatient = Object.values(state.patients).find((p) => p.phone === DEMO_PATIENT.phone);
  if (!demoPatient) throw new Error("Demo seed: patient was not registered");

  // The earliest bookable slot of that day (PROTECTED slots are the walk-in reserve and can
  // never be booked through the ordinary pipeline).
  const pastSlot = Object.values(state.slots)
    .filter((s) => s.doctorId === DEMO_DOCTOR_ID && s.state === "OPEN")
    .sort((a, b) => a.time - b.time)[0];
  if (!pastSlot) throw new Error("Demo seed: no bookable slot on the seeded past day");

  run(
    {
      type: "BookAppointment",
      patientId: demoPatient.id,
      doctorId: DEMO_DOCTOR_ID,
      slotId: pastSlot.id,
      reason: "Fever and sore throat",
      bookingSource: "RECEPTION",
      paymentStatus: "PAY_AT_CLINIC",
      ...RECEPTION,
    },
    pastOpenAt + 30,
  );
  const pastAppt = Object.values(state.appointments).find((a) => a.slotId === pastSlot.id);
  if (!pastAppt) throw new Error("Demo seed: past appointment was not booked");

  run({ type: "CheckInPatient", appointmentId: pastAppt.id, ...RECEPTION }, pastSlot.time - 8);
  const pastVisit = Object.values(state.visits).find((v) => v.appointmentId === pastAppt.id);
  const pastEntry = pastVisit ? Object.values(state.queueEntries).find((q) => q.visitId === pastVisit.id) : undefined;
  if (!pastVisit || !pastEntry) throw new Error("Demo seed: past visit was not created");

  run({ type: "StartConsultation", queueEntryId: pastEntry.id, ...DOCTOR }, pastSlot.time);
  run({ type: "CompleteConsultation", visitId: pastVisit.id, ...DOCTOR }, pastSlot.time + 20);

  // Close the day out, so nothing is left holding an OPEN session for a date in the past.
  const pastSession = Object.values(state.sessions).find((s) => s.date === pastDate && s.doctorId === DEMO_DOCTOR_ID);
  if (pastSession) {
    run({ type: "EndSession", sessionId: pastSession.id, ...SYSTEM }, dateToAbsoluteMinutes(pastDate, minuteOfDay(pastSession.endAt)));
  }

  // ---- one appointment still to come ----
  // The next clinic day that has a bookable slot entirely in the future, so it stays BOOKED
  // (and visible as "likely OPD time" in the patient's list) for the whole demo.
  for (let offset = 1; offset <= 7; offset++) {
    const date = dayNumberToDate(today + offset);
    if (weekdayFromDayNumber(today + offset) === "SUN") continue;
    run({ type: "OpenSession", doctorId: DEMO_DOCTOR_ID, date, windowIndex: 0, ...SYSTEM }, now);
    const slot = Object.values(state.slots)
      .filter((s) => s.doctorId === DEMO_DOCTOR_ID && s.state === "OPEN" && s.time > now + 90)
      .sort((a, b) => a.time - b.time)[0];
    if (!slot) continue;
    run(
      {
        type: "BookAppointment",
        patientId: demoPatient.id,
        doctorId: DEMO_DOCTOR_ID,
        slotId: slot.id,
        reason: "Follow-up",
        bookingSource: "PATIENT",
        paymentStatus: "PREPAID",
        ...PATIENT,
      },
      now,
    );
    break;
  }

  return events;
}

/** Appends the demo history once, on the first run against an empty database. A database that
 * already has events is never touched — this is a starting point, not a reset button. */
export function seedDemoHistoryIfEmpty(now: number): void {
  try {
    if (loadAllEvents().length > 0) return;
    appendEvents(buildDemoHistoryEvents(now));
  } catch (err) {
    // A demo nicety must never be the reason the clinic won't boot.
    console.error("Demo seed: could not build demo history", err);
  }
}
