// Read-side projections: everything here is derived fresh from state on every call, never
// stored. This is what the public API and the three UI surfaces read through.

import type { EngineState } from "./state";
import type { Appointment, Visit, Weekday } from "./types";
import { averageWaitMinutes, patientsAhead } from "./queue";
import { likelyOpdTimeBeforeArrival, likelyOpdTimeForQueueEntry } from "./opd";
import { currentFee } from "./money";
import { formatClockLabel, formatDayLabel } from "./time";

export function findAppointmentByToken(state: EngineState, tokenNumber: number) {
  return Object.values(state.appointments).find((a) => a.tokenNumber === tokenNumber) ?? null;
}

/** Token numbers are only unique within a clinic day, so anything that already knows the
 * appointment id should address it that way — the token lookup stays for the public API, where
 * a token number is all the caller (a bot, a tracked link) has. */
export function findAppointment(state: EngineState, ref: { appointmentId?: string; tokenNumber?: number }): Appointment | null {
  if (ref.appointmentId) return state.appointments[ref.appointmentId] ?? null;
  if (ref.tokenNumber !== undefined) return findAppointmentByToken(state, ref.tokenNumber);
  return null;
}

function fallbackConsultMinutesFor(state: EngineState, doctorId: string): number {
  const template = Object.values(state.sessionTemplates).find((t) => t.doctorId === doctorId);
  return template?.slotLengthMinutes ?? 20;
}

export interface DoctorSummary {
  id: string;
  name: string;
  specialty: string;
  room: string;
  consultationFee: number;
  avgWaitMinutes: number;
  availableDays: Weekday[];
}

export function doctorSummaries(state: EngineState, now: number): DoctorSummary[] {
  return Object.values(state.doctors).map((doctor) => {
    const availableDays = Array.from(new Set(Object.values(state.sessionTemplates).filter((t) => t.doctorId === doctor.id).map((t) => t.weekday)));
    const fallback = fallbackConsultMinutesFor(state, doctor.id);
    const avgWaitMinutes = Math.round(
      averageWaitMinutes({
        state,
        doctorId: doctor.id,
        now,
        likelyOpdTimeForEntry: (entry) => likelyOpdTimeForQueueEntry(state, entry, now, fallback),
        emptyQueueDefaultMinutes: fallback,
      }),
    );
    return {
      id: doctor.id,
      name: doctor.name,
      specialty: doctor.specialty,
      room: doctor.room,
      consultationFee: currentFee(state, doctor.id, now),
      avgWaitMinutes,
      availableDays,
    };
  });
}

export interface AvailabilitySlot {
  id: string;
  time: number;
  label: string;
}

/** OPEN and RELEASED slots only — a PROTECTED slot is the walk-in reserve and must never be
 * offered to the booking flow. Also excludes anything already in the past relative to `now`,
 * so a patient booking this afternoon never sees this morning's slots offered as available. */
export function availabilityForDoctorDate(state: EngineState, doctorId: string, date: string, now: number): AvailabilitySlot[] {
  return Object.values(state.slots)
    .filter((s) => s.doctorId === doctorId && (s.state === "OPEN" || s.state === "RELEASED") && s.time >= now)
    .filter((s) => state.sessions[s.sessionId]?.date === date)
    .sort((a, b) => a.time - b.time)
    .map((s) => ({ id: s.id, time: s.time, label: formatClockLabel(s.time) }));
}

export interface AppointmentView {
  /** Stable across days; token numbers are not. Prefer this as a React key and as the thing to
   * act on (cancel, pay) — one patient can hold the same token number on two different days. */
  appointmentId: string | null;
  /** Set for a walk-in, which has no appointment to be identified by. */
  visitId: string | null;
  tokenNumber: number;
  status: string;
  doctorName: string;
  dayLabel: string;
  /** The appointment's own day is over — its updates are history, not news. */
  dayPassed: boolean;
  slotLabel: string;
  likelyOpdTime: number;
  likelyOpdTimeLabel: string;
  patientsAhead: number;
  paymentStatus: string;
}

/** The one appointment-or-visit view, built from the rows themselves. Callers that already
 * hold the rows (the patient's own list) go straight here — a token number is only unique
 * *within a day*, so it can never be the thing this is looked up by. */
function appointmentViewFor(
  state: EngineState,
  rows: { appointment?: Appointment; visit?: Visit },
  now: number,
): AppointmentView | null {
  const { appointment: appt, visit } = rows;
  const doctorId = appt?.doctorId ?? visit?.doctorId;
  const tokenNumber = appt?.tokenNumber ?? visit?.tokenNumber;
  if (!doctorId || tokenNumber === undefined) return null;
  const doctor = state.doctors[doctorId];
  const fallback = fallbackConsultMinutesFor(state, doctorId);
  // A walk-in has no slot, so its visit's arrival time stands in as "when this happened".
  const at = appt?.slotTime ?? visit?.createdAt ?? now;
  // A whole day, not an instant: a visit that finished this morning is still today's news, but
  // last Saturday's updates are just history to scroll past.
  const dayPassed = Math.floor(at / 1440) < Math.floor(now / 1440);

  let likelyOpdTime: number;
  let patientsAheadCount = 0;
  let status: string;
  let slotLabel: string;
  let paymentStatus: string;

  const activeEntry = visit
    ? Object.values(state.queueEntries).find((q) => q.visitId === visit.id && (q.status === "WAITING" || q.status === "IN_PROGRESS"))
    : undefined;

  if (visit && activeEntry) {
    status = visit.status;
    slotLabel = appt ? formatClockLabel(appt.slotTime) : formatClockLabel(visit.createdAt);
    paymentStatus = appt?.paymentStatus ?? "PAY_AT_CLINIC";
    likelyOpdTime = likelyOpdTimeForQueueEntry(state, activeEntry, now, fallback);
    patientsAheadCount = patientsAhead(state, activeEntry.id);
  } else if (visit) {
    status = visit.status;
    slotLabel = appt ? formatClockLabel(appt.slotTime) : formatClockLabel(visit.createdAt);
    paymentStatus = appt?.paymentStatus ?? "PAY_AT_CLINIC";
    likelyOpdTime = now;
  } else if (appt) {
    status = appt.status;
    slotLabel = formatClockLabel(appt.slotTime);
    paymentStatus = appt.paymentStatus;
    likelyOpdTime = likelyOpdTimeBeforeArrival(state, appt, now);
  } else {
    return null;
  }

  return {
    appointmentId: appt?.id ?? null,
    visitId: visit?.id ?? null,
    tokenNumber,
    status,
    doctorName: doctor.name,
    dayLabel: formatDayLabel(at),
    dayPassed,
    slotLabel,
    likelyOpdTime,
    likelyOpdTimeLabel: formatClockLabel(likelyOpdTime),
    patientsAhead: patientsAheadCount,
    paymentStatus,
  };
}

export function appointmentViewByToken(state: EngineState, tokenNumber: number, now: number): AppointmentView | null {
  const appointment = Object.values(state.appointments).find((a) => a.tokenNumber === tokenNumber);
  const visit = Object.values(state.visits).find((v) => v.tokenNumber === tokenNumber);
  return appointmentViewFor(state, { appointment, visit }, now);
}

/** Everything this patient has ever held — booked appointments and walk-in visits alike —
 * soonest first while it still matters, then history. Collected by id: token numbers restart
 * every clinic day, so two of a patient's appointments can legitimately share one. */
export function appointmentsForPatient(state: EngineState, patientId: string, now: number): AppointmentView[] {
  const rows: { appointment?: Appointment; visit?: Visit; at: number }[] = [];

  for (const appointment of Object.values(state.appointments)) {
    if (appointment.patientId !== patientId) continue;
    const visit = Object.values(state.visits).find((v) => v.appointmentId === appointment.id);
    rows.push({ appointment, visit, at: appointment.slotTime });
  }
  // Walk-ins never had an appointment to be listed against.
  for (const visit of Object.values(state.visits)) {
    if (visit.patientId !== patientId || visit.appointmentId) continue;
    rows.push({ visit, at: visit.createdAt });
  }

  // The next one first (25th above the 26th), and anything already done below it, most recent
  // history first — you act on the upcoming ones, you only look things up in the past ones.
  const upcoming = rows.filter((row) => row.at >= now).sort((a, b) => a.at - b.at);
  const past = rows.filter((row) => row.at < now).sort((a, b) => b.at - a.at);

  return [...upcoming, ...past]
    .map((row) => appointmentViewFor(state, row, now))
    .filter((view): view is AppointmentView => view !== null);
}
