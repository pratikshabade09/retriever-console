// Read-side projections: everything here is derived fresh from state on every call, never
// stored. This is what the public API and the three UI surfaces read through.

import type { EngineState } from "./state";
import type { Weekday } from "./types";
import { averageWaitMinutes, patientsAhead } from "./queue";
import { likelyOpdTimeBeforeArrival, likelyOpdTimeForQueueEntry } from "./opd";
import { currentFee } from "./money";
import { formatClockLabel } from "./time";

export function findAppointmentByToken(state: EngineState, tokenNumber: number) {
  return Object.values(state.appointments).find((a) => a.tokenNumber === tokenNumber) ?? null;
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
  tokenNumber: number;
  status: string;
  doctorName: string;
  slotLabel: string;
  likelyOpdTime: number;
  likelyOpdTimeLabel: string;
  patientsAhead: number;
  paymentStatus: string;
}

export function appointmentViewByToken(state: EngineState, tokenNumber: number, now: number): AppointmentView | null {
  const appt = Object.values(state.appointments).find((a) => a.tokenNumber === tokenNumber);
  const visit = Object.values(state.visits).find((v) => v.tokenNumber === tokenNumber);
  const doctorId = appt?.doctorId ?? visit?.doctorId;
  if (!doctorId) return null;
  const doctor = state.doctors[doctorId];
  const fallback = fallbackConsultMinutesFor(state, doctorId);

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
    tokenNumber,
    status,
    doctorName: doctor.name,
    slotLabel,
    likelyOpdTime,
    likelyOpdTimeLabel: formatClockLabel(likelyOpdTime),
    patientsAhead: patientsAheadCount,
    paymentStatus,
  };
}

/** Every token this patient has ever held — booked appointments and walk-in visits alike,
 * most recent first. Used by the logged-in "my appointments" view. */
export function appointmentsForPatient(state: EngineState, patientId: string, now: number): AppointmentView[] {
  const tokens = new Set<number>();
  for (const a of Object.values(state.appointments)) if (a.patientId === patientId) tokens.add(a.tokenNumber);
  for (const v of Object.values(state.visits)) if (v.patientId === patientId) tokens.add(v.tokenNumber);

  return Array.from(tokens)
    .map((token) => appointmentViewByToken(state, token, now))
    .filter((view): view is AppointmentView => view !== null)
    .sort((a, b) => b.tokenNumber - a.tokenNumber);
}
