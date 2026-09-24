// Likely OPD time: computed fresh on every read, never stored. This module also drives the
// notification side effects (LikelyOpdTimeChanged + the matching NotificationRow) that fire
// when a recompute moves someone's time by >= 5 minutes.
//
// The core guarantee lives in `considerChange` below: cause is assigned purely from the SIGN
// of the change. A later time is always `doctor_running_late`; an earlier time is always
// whichever of `capacity_freed` / `queue_moved_faster` the caller supplies. This makes it
// structurally impossible for a `doctor_running_late` change to move a time earlier — the two
// are mutually exclusive by construction, not by a runtime check that could be forgotten.

import type { ActorRole, Appointment, OpdChangeCause, QueueEntry } from "./types";
import type { EngineState } from "./state";
import type { Event } from "./events";
import { activeQueueForDoctor, patientsAhead } from "./queue";
import { findRelevantOpenSession } from "./sessions";
import { makeId } from "./ids";
import { formatClockLabel } from "./time";

const OPD_CHANGE_THRESHOLD_MINUTES = 5;
const APPROACHING_QUEUE_POSITION = 5;

/** Who a notification is about. The token number is what the patient sees, but it repeats every
 * clinic day — the ids are what actually identify the booking, so they travel with the event. */
interface NotificationSubject {
  tokenNumber: number;
  patientId: string;
  appointmentId: string | null;
  visitId: string | null;
}

export function ewmaConsultMinutesFor(state: EngineState, doctorId: string, fallback: number): number {
  return state.ewmaConsultMinutes[doctorId] ?? fallback;
}

export function doctorRunningDelayMinutes(state: EngineState, doctorId: string, now: number): number {
  return findRelevantOpenSession(state, doctorId, now)?.runningDelayMinutes ?? 0;
}

function inProgressEntryFor(state: EngineState, doctorId: string): QueueEntry | undefined {
  return Object.values(state.queueEntries).find((q) => q.doctorId === doctorId && q.status === "IN_PROGRESS");
}

export function likelyOpdTimeBeforeArrival(state: EngineState, appointment: Appointment, now: number): number {
  return Math.round(appointment.slotTime + doctorRunningDelayMinutes(state, appointment.doctorId, now));
}

export function likelyOpdTimeForQueueEntry(
  state: EngineState,
  entry: QueueEntry,
  now: number,
  fallbackConsultMinutes: number,
): number {
  const ewma = ewmaConsultMinutesFor(state, entry.doctorId, fallbackConsultMinutes);
  const ordered = activeQueueForDoctor(state, entry.doctorId);
  const inProgress = inProgressEntryFor(state, entry.doctorId);

  let waitingAhead = 0;
  for (const q of ordered) {
    if (q.id === entry.id) break;
    if (q.status === "WAITING") waitingAhead++;
  }

  let remainingOnCurrent = 0;
  if (inProgress) {
    const visit = state.visits[inProgress.visitId];
    if (visit?.consultationStartedAt != null) {
      remainingOnCurrent = Math.max(0, ewma - (now - visit.consultationStartedAt));
    }
  }

  const delay = doctorRunningDelayMinutes(state, entry.doctorId, now);
  return Math.round(now + waitingAhead * ewma + remainingOnCurrent + delay);
}

function lastNotifiedOpdTime(state: EngineState, tokenNumber: number): number | null {
  for (let i = state.opdChanges.length - 1; i >= 0; i--) {
    if (state.opdChanges[i].tokenNumber === tokenNumber) return state.opdChanges[i].to;
  }
  return null;
}

/** The baseline to compare a fresh computation against. Once a patient has been notified at
 * least once, the baseline is whatever they were last told. Before that, it's whatever
 * expectation was set at booking (slotTime) or arrival (effectiveReadyTime) — never "now",
 * which would make the very first recompute after arrival look like a change from nothing. */
function baselineOpdTime(state: EngineState, tokenNumber: number, initialExpectation: number): number {
  return lastNotifiedOpdTime(state, tokenNumber) ?? initialExpectation;
}

/** Recomputes likely OPD time for every booked-not-arrived appointment and every waiting
 * queue entry of one doctor, emitting LikelyOpdTimeChanged + NotificationCreated for anyone
 * whose time moved by >= 5 minutes, and an "approaching the queue" notification the first
 * time someone reaches position 5 or fewer. Called after every material event. */
export function recomputeOpdForDoctor(params: {
  state: EngineState;
  doctorId: string;
  now: number;
  earlierCause: Extract<OpdChangeCause, "capacity_freed" | "queue_moved_faster">;
  fallbackConsultMinutes: number;
}): Event[] {
  const { state, doctorId, now, earlierCause, fallbackConsultMinutes } = params;
  const actorRole: ActorRole = "SYSTEM";
  const actorId = "system";
  const events: Event[] = [];
  let opdExtra = 0;
  let notifExtra = 0;

  function emitChange(subject: NotificationSubject, newTime: number, initialExpectation: number) {
    const { tokenNumber, patientId } = subject;
    const baseline = baselineOpdTime(state, tokenNumber, initialExpectation);
    const delta = newTime - baseline;
    if (Math.abs(delta) < OPD_CHANGE_THRESHOLD_MINUTES) return;
    const cause: OpdChangeCause = delta > 0 ? "doctor_running_late" : earlierCause;

    const opdChangeId = makeId(state, "opdchg", opdExtra++);
    events.push({
      type: "LikelyOpdTimeChanged",
      ts: now,
      actorRole,
      actorId,
      aggregateType: "Appointment",
      aggregateId: String(tokenNumber),
      v: 1,
      opdChangeId,
      tokenNumber,
      patientId,
      doctorId,
      from: baseline,
      to: newTime,
      cause,
    });

    const notificationId = makeId(state, "notif", notifExtra++);
    const message =
      cause === "doctor_running_late"
        ? `The doctor is running late. Your updated likely OPD time is ${formatClockLabel(newTime)}.`
        : `Good news — a slot ahead of you opened up. Your updated likely OPD time is ${formatClockLabel(newTime)}.`;
    events.push({
      type: "NotificationCreated",
      ts: now,
      actorRole,
      actorId,
      aggregateType: "Notification",
      aggregateId: notificationId,
      v: 1,
      notificationId,
      tokenNumber,
      patientId,
      appointmentId: subject.appointmentId,
      visitId: subject.visitId,
      kind: "opd_time_changed",
      message,
    });
  }

  for (const appointment of Object.values(state.appointments)) {
    if (appointment.doctorId !== doctorId || appointment.status !== "BOOKED") continue;
    emitChange(
      { tokenNumber: appointment.tokenNumber, patientId: appointment.patientId, appointmentId: appointment.id, visitId: null },
      likelyOpdTimeBeforeArrival(state, appointment, now),
      appointment.slotTime,
    );
  }

  for (const entry of Object.values(state.queueEntries)) {
    if (entry.doctorId !== doctorId || entry.status !== "WAITING") continue;
    const visit = state.visits[entry.visitId];
    if (!visit) continue;

    const subject: NotificationSubject = {
      tokenNumber: visit.tokenNumber,
      patientId: visit.patientId,
      appointmentId: visit.appointmentId,
      visitId: visit.id,
    };
    emitChange(subject, likelyOpdTimeForQueueEntry(state, entry, now, fallbackConsultMinutes), entry.effectiveReadyTime);

    const position = patientsAhead(state, entry.id);
    if (position <= APPROACHING_QUEUE_POSITION) {
      // Once per visit, not once per token number — one visit, one "you're next".
      const alreadyNotified = state.notifications.some((n) => n.kind === "approaching_queue" && n.visitId === visit.id);
      if (!alreadyNotified) {
        const notificationId = makeId(state, "notif", notifExtra++);
        events.push({
          type: "NotificationCreated",
          ts: now,
          actorRole,
          actorId,
          aggregateType: "Notification",
          aggregateId: notificationId,
          v: 1,
          notificationId,
          tokenNumber: subject.tokenNumber,
          patientId: subject.patientId,
          appointmentId: subject.appointmentId,
          visitId: subject.visitId,
          kind: "approaching_queue",
          message: `You are approaching the queue. There are ${position} patients ahead of you. Please be ready.`,
        });
      }
    }
  }

  return events;
}
