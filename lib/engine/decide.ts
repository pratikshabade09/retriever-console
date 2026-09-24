// decide(command, state, now) -> Event[]. The only place business rules run. Throws a typed
// domain error on an illegal request; otherwise returns the facts to append. Some handlers
// also fold their own primary events into a scratch state (via reduce()) so they can compute
// derived likely-OPD-time notifications against the *resulting* state, all within one pure
// call — see withOpdRecompute below. That keeps "recompute on every material event" (section
// 5) inside the one mutation path instead of becoming a second, implicit path.

import type { Command } from "./commands";
import type { Event } from "./events";
import type { EngineState } from "./state";
import type { CapacitySource, DoctorSession, SlotState } from "./types";
import { reduce } from "./reducer";
import { makeId } from "./ids";
import { decideCapacity, isRedundantHold } from "./capacity";
import { findRelevantOpenSession } from "./sessions";
import { computeEffectiveReadyTime } from "./queue";
import { recomputeOpdForDoctor } from "./opd";
import { buildInvoiceLines, currentFee } from "./money";
import { dateToAbsoluteMinutes, weekdayOfDate, formatClockLabel } from "./time";
import { buildSessionSlots } from "./sessionSlots";
import { defaultTemplatesFor } from "./seed";
import {
  CapacityFloorReached,
  DoctorBusy,
  DomainError,
  InvalidVisitState,
  InvestigationAlreadyResulted,
  PaymentAlreadyCollected,
  SessionNotOpen,
  SlotUnavailable,
  UnauthorizedCommand,
} from "./errors";

function mustGet<T>(record: Record<string, T>, id: string, what: string): T {
  const row = record[id];
  if (!row) throw new DomainError(`${what} not found: ${id}`);
  return row;
}

function findOpenSessionForDoctor(state: EngineState, doctorId: string, now: number): DoctorSession {
  const session = findRelevantOpenSession(state, doctorId, now);
  if (!session) throw new SessionNotOpen(`No open session for doctor ${doctorId}`);
  return session;
}

function defaultConsultMinutesFor(state: EngineState, doctorId: string): number {
  const anySession = Object.values(state.sessions).find((s) => s.doctorId === doctorId);
  return anySession?.slotLengthMinutes ?? 20;
}

function nextTokenNumber(state: EngineState, dayNumber: number): number {
  let max = 0;
  for (const a of Object.values(state.appointments)) {
    if (Math.floor(a.slotTime / 1440) === dayNumber) max = Math.max(max, a.tokenNumber);
  }
  for (const v of Object.values(state.visits)) {
    if (Math.floor(v.createdAt / 1440) === dayNumber) max = Math.max(max, v.tokenNumber);
  }
  return max + 1;
}

function freedSlotState(capacitySource: CapacitySource): Extract<SlotState, "OPEN" | "RELEASED"> {
  return capacitySource === "PROTECTED" ? "RELEASED" : "OPEN";
}

/** Folds `primaryEvents` into a scratch copy of state, then recomputes likely OPD times for
 * the affected doctor against that resulting state, appending any LikelyOpdTimeChanged /
 * NotificationCreated events that cross the 5-minute threshold. */
function withOpdRecompute(
  state: EngineState,
  primaryEvents: Event[],
  doctorId: string,
  now: number,
  earlierCause: "capacity_freed" | "queue_moved_faster",
): Event[] {
  const draft = primaryEvents.reduce(reduce, state);
  const opdEvents = recomputeOpdForDoctor({
    state: draft,
    doctorId,
    now,
    earlierCause,
    fallbackConsultMinutes: defaultConsultMinutesFor(state, doctorId),
  });
  return [...primaryEvents, ...opdEvents];
}

export function decide(command: Command, state: EngineState, now: number): Event[] {
  const base = { ts: now, actorRole: command.actorRole, actorId: command.actorId, v: 1 as const };

  switch (command.type) {
    case "OpenSession": {
      const weekday = weekdayOfDate(command.date);
      const template = Object.values(state.sessionTemplates).find(
        (t) => t.doctorId === command.doctorId && t.windowIndex === command.windowIndex && t.weekday === weekday,
      );
      if (!template) throw new DomainError(`No session template for ${command.doctorId} on ${weekday} window ${command.windowIndex}`);
      const existing = Object.values(state.sessions).find((s) => s.templateId === template.id && s.date === command.date);
      if (existing) throw new DomainError(`Session already exists for ${command.doctorId} on ${command.date} window ${command.windowIndex}`);

      const sessionId = makeId(state, "session");
      const slots = buildSessionSlots({ sessionId, template, date: command.date });
      return [
        {
          ...base,
          type: "SessionOpened",
          aggregateType: "DoctorSession",
          aggregateId: sessionId,
          sessionId,
          templateId: template.id,
          doctorId: template.doctorId,
          date: command.date,
          windowIndex: template.windowIndex,
          startAt: dateToAbsoluteMinutes(command.date, template.startMinutes),
          endAt: dateToAbsoluteMinutes(command.date, template.endMinutes),
          slotLengthMinutes: template.slotLengthMinutes,
          totalSlots: template.totalSlots,
          minProtected: template.minProtected,
          slots,
        },
      ];
    }

    case "PauseSession": {
      const session = mustGet(state.sessions, command.sessionId, "DoctorSession");
      if (session.status !== "OPEN") throw new SessionNotOpen(`Session ${command.sessionId} is not open`);
      const primary: Event[] = [
        { ...base, type: "SessionPaused", aggregateType: "DoctorSession", aggregateId: session.id, sessionId: session.id, reason: command.reason },
      ];
      return withOpdRecompute(state, primary, session.doctorId, now, "queue_moved_faster");
    }

    case "ResumeSession": {
      const session = mustGet(state.sessions, command.sessionId, "DoctorSession");
      if (session.status !== "PAUSED") throw new SessionNotOpen(`Session ${command.sessionId} is not paused`);
      const primary: Event[] = [
        { ...base, type: "SessionResumed", aggregateType: "DoctorSession", aggregateId: session.id, sessionId: session.id },
      ];
      return withOpdRecompute(state, primary, session.doctorId, now, "queue_moved_faster");
    }

    case "EndSession": {
      const session = mustGet(state.sessions, command.sessionId, "DoctorSession");
      return [{ ...base, type: "SessionEnded", aggregateType: "DoctorSession", aggregateId: session.id, sessionId: session.id }];
    }

    case "ReconfigureSession": {
      if (command.actorRole !== "ADMIN") throw new UnauthorizedCommand("Only admin can reconfigure a session");
      const template = mustGet(state.sessionTemplates, command.templateId, "SessionTemplate");
      const live = Object.values(state.sessions).some(
        (s) =>
          s.templateId === template.id &&
          Object.values(state.slots).some((slot) => slot.sessionId === s.id && (slot.appointmentId || slot.visitId)),
      );
      if (live) throw new DomainError("Cannot reconfigure: an appointment or visit already exists on this session. Reset first.");

      const merged = { ...template, ...command.patch };
      if (merged.endMinutes <= merged.startMinutes) throw new DomainError("Session end must be after start");
      const recomputedTotal = (merged.endMinutes - merged.startMinutes) / merged.slotLengthMinutes;
      const patch = { ...command.patch, totalSlots: command.patch.totalSlots ?? recomputedTotal };
      const total = patch.totalSlots ?? recomputedTotal;
      if (merged.initialProtected > total) throw new DomainError("Protected slots cannot exceed total slots");
      if (merged.minProtected > merged.initialProtected) throw new DomainError("Minimum protected cannot exceed initial protected");

      return [{ ...base, type: "SessionReconfigured", aggregateType: "SessionTemplate", aggregateId: template.id, templateId: template.id, patch }];
    }

    case "RegisterPatient": {
      const patientId = makeId(state, "patient");
      return [{ ...base, type: "PatientRegistered", aggregateType: "Patient", aggregateId: patientId, patientId, name: command.name, phone: command.phone }];
    }

    case "RegisterDoctor": {
      if (command.actorRole !== "ADMIN") throw new UnauthorizedCommand("Only admin can register a doctor");

      const name = command.name.trim();
      const specialty = command.specialty.trim();
      const room = command.room.trim();
      if (!name) throw new DomainError("A doctor needs a name");
      if (!specialty) throw new DomainError("A doctor needs a specialty");
      if (!room) throw new DomainError("A doctor needs a room");
      if (!Number.isFinite(command.consultationFee) || command.consultationFee < 0) {
        throw new DomainError("Consultation fee must be a non-negative number");
      }

      const clash = Object.values(state.doctors).find((d) => d.name.toLowerCase() === name.toLowerCase());
      if (clash) throw new DomainError(`${clash.name} is already in the clinic`);

      const doctorId = makeId(state, "doctor");
      return [
        {
          ...base,
          type: "DoctorRegistered",
          aggregateType: "Doctor",
          aggregateId: doctorId,
          doctorId,
          name,
          specialty,
          room,
          consultationFee: command.consultationFee,
          effectiveFrom: now,
          templates: defaultTemplatesFor(doctorId),
        },
      ];
    }

    case "BookAppointment": {
      const slot = mustGet(state.slots, command.slotId, "Slot");
      if (slot.doctorId !== command.doctorId) throw new SlotUnavailable(`Slot ${slot.id} does not belong to ${command.doctorId}`);
      if (slot.state !== "OPEN" && slot.state !== "RELEASED") throw new SlotUnavailable(`Slot ${slot.id} is not bookable`);
      mustGet(state.patients, command.patientId, "Patient");

      const tokenNumber = nextTokenNumber(state, Math.floor(slot.time / 1440));
      const appointmentId = makeId(state, "appt");
      const capacitySource: CapacitySource = slot.state;
      return [
        {
          ...base,
          type: "AppointmentBooked",
          aggregateType: "Appointment",
          aggregateId: appointmentId,
          appointmentId,
          tokenNumber,
          patientId: command.patientId,
          doctorId: command.doctorId,
          slotId: slot.id,
          slotTime: slot.time,
          paymentStatus: command.paymentStatus,
          bookingSource: command.bookingSource,
          capacitySource,
          reason: command.reason,
        },
      ];
    }

    case "CancelAppointment": {
      const appt = mustGet(state.appointments, command.appointmentId, "Appointment");
      if (appt.status !== "BOOKED") throw new InvalidVisitState(`Appointment ${appt.id} is not BOOKED`);
      const primary: Event[] = [
        {
          ...base,
          type: "AppointmentCancelled",
          aggregateType: "Appointment",
          aggregateId: appt.id,
          appointmentId: appt.id,
          slotId: appt.slotId,
          freedTo: freedSlotState(appt.capacitySource),
        },
      ];
      return withOpdRecompute(state, primary, appt.doctorId, now, "capacity_freed");
    }

    case "RescheduleAppointment": {
      const appt = mustGet(state.appointments, command.appointmentId, "Appointment");
      if (appt.status !== "BOOKED") throw new InvalidVisitState(`Appointment ${appt.id} is not BOOKED`);
      const newSlot = mustGet(state.slots, command.newSlotId, "Slot");
      if (newSlot.doctorId !== appt.doctorId) throw new SlotUnavailable("Reschedule must stay with the same doctor");
      if (newSlot.state !== "OPEN" && newSlot.state !== "RELEASED") throw new SlotUnavailable(`Slot ${newSlot.id} is not bookable`);

      const primary: Event[] = [
        {
          ...base,
          type: "AppointmentRescheduled",
          aggregateType: "Appointment",
          aggregateId: appt.id,
          appointmentId: appt.id,
          oldSlotId: appt.slotId,
          oldSlotFreedTo: freedSlotState(appt.capacitySource),
          newSlotId: newSlot.id,
          newSlotTime: newSlot.time,
          newCapacitySource: newSlot.state,
        },
      ];
      return withOpdRecompute(state, primary, appt.doctorId, now, "capacity_freed");
    }

    case "MarkPrepaid": {
      const appt = mustGet(state.appointments, command.appointmentId, "Appointment");
      if (appt.paymentStatus !== "PAY_AT_CLINIC") throw new PaymentAlreadyCollected(`Appointment ${appt.id} is already ${appt.paymentStatus}`);
      return [{ ...base, type: "PaymentMarkedPrepaid", aggregateType: "Appointment", aggregateId: appt.id, appointmentId: appt.id }];
    }

    case "CollectPayment": {
      if (command.target === "appointment") {
        const appt = mustGet(state.appointments, command.id, "Appointment");
        if (appt.paymentStatus !== "PAY_AT_CLINIC") throw new PaymentAlreadyCollected(`Appointment ${appt.id} is already ${appt.paymentStatus}`);
        return [{ ...base, type: "PaymentCollected", aggregateType: "Appointment", aggregateId: appt.id, target: "appointment", id: appt.id }];
      }
      const charge = mustGet(state.charges, command.id, "Charge");
      if (charge.status !== "DUE") throw new PaymentAlreadyCollected(`Charge ${charge.id} is already ${charge.status}`);
      return [{ ...base, type: "PaymentCollected", aggregateType: "Charge", aggregateId: charge.id, target: "charge", id: charge.id }];
    }

    case "CheckInPatient": {
      const appt = mustGet(state.appointments, command.appointmentId, "Appointment");
      if (appt.status === "ARRIVED") return []; // double check-in is a no-op, not an error
      if (appt.status !== "BOOKED") throw new InvalidVisitState(`Appointment ${appt.id} is ${appt.status}, cannot check in`);

      const visitId = makeId(state, "visit");
      const queueEntryId = makeId(state, "queue");
      const effectiveReadyTime = computeEffectiveReadyTime({ queueType: "CONSULT", arrivedAt: now, slotTime: appt.slotTime });
      const primary: Event[] = [
        {
          ...base,
          type: "PatientCheckedIn",
          aggregateType: "Visit",
          aggregateId: visitId,
          appointmentId: appt.id,
          visitId,
          patientId: appt.patientId,
          doctorId: appt.doctorId,
          tokenNumber: appt.tokenNumber,
          reason: appt.reason,
          queueEntryId,
          effectiveReadyTime,
        },
      ];
      return withOpdRecompute(state, primary, appt.doctorId, now, "queue_moved_faster");
    }

    case "RegisterWalkIn": {
      const doctor = mustGet(state.doctors, command.doctorId, "Doctor");
      const candidate = Object.values(state.slots)
        .filter((s) => s.doctorId === command.doctorId && s.state === "PROTECTED" && s.time >= now)
        .sort((a, b) => a.time - b.time)[0];

      if (!candidate) {
        const nextFree = Object.values(state.slots)
          .filter((s) => s.doctorId === command.doctorId && s.time >= now && (s.state === "OPEN" || s.state === "RELEASED" || s.state === "PROTECTED"))
          .sort((a, b) => a.time - b.time)[0];
        let suggestion: string;
        if (nextFree) {
          suggestion = `Next available slot for ${doctor.name} is ${formatClockLabel(nextFree.time)}`;
        } else {
          const altDoctor = Object.values(state.doctors).find(
            (d) =>
              d.id !== doctor.id &&
              d.specialty === doctor.specialty &&
              Object.values(state.slots).some((s) => s.doctorId === d.id && s.time >= now),
          );
          suggestion = altDoctor
            ? `Consider ${altDoctor.name} (${altDoctor.specialty}), who has availability today`
            : `No availability found for ${doctor.specialty} today`;
        }
        return [{ ...base, type: "WalkInDeferred", aggregateType: "Patient", aggregateId: command.patientId, patientId: command.patientId, doctorId: command.doctorId, suggestion }];
      }

      const visitId = makeId(state, "visit");
      const queueEntryId = makeId(state, "queue");
      const tokenNumber = nextTokenNumber(state, Math.floor(now / 1440));
      const effectiveReadyTime = computeEffectiveReadyTime({ queueType: "CONSULT", arrivedAt: now });
      const primary: Event[] = [
        {
          ...base,
          type: "WalkInRegistered",
          aggregateType: "Visit",
          aggregateId: visitId,
          patientId: command.patientId,
          doctorId: command.doctorId,
          visitId,
          tokenNumber,
          slotId: candidate.id,
          reason: command.reason,
          queueEntryId,
          effectiveReadyTime,
        },
      ];
      return withOpdRecompute(state, primary, command.doctorId, now, "queue_moved_faster");
    }

    case "LeaveQueue": {
      const entry = mustGet(state.queueEntries, command.queueEntryId, "QueueEntry");
      if (entry.status !== "WAITING") throw new InvalidVisitState(`Queue entry ${entry.id} is not waiting`);
      const primary: Event[] = [
        { ...base, type: "PatientLeftQueue", aggregateType: "QueueEntry", aggregateId: entry.id, queueEntryId: entry.id, visitId: entry.visitId },
      ];
      return withOpdRecompute(state, primary, entry.doctorId, now, "queue_moved_faster");
    }

    case "EscalatePriority": {
      if (!command.reason || command.reason.trim() === "") throw new DomainError("Escalation requires a reason");
      if (command.tier === 2 && command.actorRole === "RECEPTION") {
        throw new UnauthorizedCommand("Reception cannot issue a tier-2 clinical escalation");
      }
      const entry = mustGet(state.queueEntries, command.queueEntryId, "QueueEntry");
      const primary: Event[] = [
        { ...base, type: "PriorityEscalated", aggregateType: "QueueEntry", aggregateId: entry.id, queueEntryId: entry.id, tier: command.tier, reason: command.reason },
      ];
      return withOpdRecompute(state, primary, entry.doctorId, now, "queue_moved_faster");
    }

    case "StartConsultation": {
      if (command.actorRole === "RECEPTION") throw new UnauthorizedCommand("Reception cannot start a consultation");
      const entry = mustGet(state.queueEntries, command.queueEntryId, "QueueEntry");
      if (entry.queueType !== "CONSULT" || entry.status !== "WAITING") throw new InvalidVisitState(`Queue entry ${entry.id} cannot start a consultation`);
      const busy = Object.values(state.queueEntries).some((q) => q.doctorId === entry.doctorId && q.status === "IN_PROGRESS");
      if (busy) throw new DoctorBusy(`Doctor ${entry.doctorId} is already with a patient`);

      const visit = mustGet(state.visits, entry.visitId, "Visit");
      let sessionId: string | null = null;
      let runningDelayMinutes = 0;
      if (visit.appointmentId) {
        const appt = state.appointments[visit.appointmentId];
        if (appt) {
          const slot = state.slots[appt.slotId];
          if (slot) {
            sessionId = slot.sessionId;
            runningDelayMinutes = Math.max(0, now - appt.slotTime);
          }
        }
      }

      return [
        {
          ...base,
          type: "ConsultationStarted",
          aggregateType: "Visit",
          aggregateId: visit.id,
          visitId: visit.id,
          queueEntryId: entry.id,
          doctorId: entry.doctorId,
          runningDelayMinutes,
          sessionId,
        },
      ];
    }

    case "CompleteConsultation": {
      const visit = mustGet(state.visits, command.visitId, "Visit");
      if (visit.status !== "IN_CONSULT") throw new InvalidVisitState(`Visit ${visit.id} is not IN_CONSULT`);
      const queueEntry = Object.values(state.queueEntries).find((q) => q.visitId === visit.id && q.status === "IN_PROGRESS" && q.queueType === "CONSULT");
      if (!queueEntry) throw new InvalidVisitState(`No in-progress consultation queue entry for visit ${visit.id}`);

      const actualDurationMinutes = now - (visit.consultationStartedAt ?? now);
      const alreadyCharged = Object.values(state.charges).some((c) => c.visitId === visit.id && c.kind === "CONSULTATION");
      const fee = currentFee(state, visit.doctorId, now);
      const appt = visit.appointmentId ? state.appointments[visit.appointmentId] : undefined;
      const chargeStatus: "DUE" | "COLLECTED" = appt && (appt.paymentStatus === "PREPAID" || appt.paymentStatus === "COLLECTED") ? "COLLECTED" : "DUE";
      const chargeId = makeId(state, "charge");

      const hasPendingInvestigation = Object.values(state.investigations).some((i) => i.visitId === visit.id && i.status === "ORDERED");
      const nextStatus = hasPendingInvestigation ? ("INVESTIGATION_PENDING" as const) : ("CLOSED" as const);

      let invoice: { invoiceId: string; lines: ReturnType<typeof buildInvoiceLines>; total: number } | null = null;
      if (nextStatus === "CLOSED") {
        const consultationLine = alreadyCharged ? [] : [{ chargeId, kind: "CONSULTATION" as const, description: "Consultation", amount: fee }];
        const lines = [...buildInvoiceLines(state, visit.id), ...consultationLine];
        invoice = { invoiceId: makeId(state, "invoice"), lines, total: lines.reduce((sum, l) => sum + l.amount, 0) };
      }

      const primary: Event[] = [
        {
          ...base,
          type: "ConsultationCompleted",
          aggregateType: "Visit",
          aggregateId: visit.id,
          visitId: visit.id,
          queueEntryId: queueEntry.id,
          chargeId: alreadyCharged ? null : chargeId,
          unitPriceSnapshot: fee,
          amount: fee,
          chargeStatus,
          actualDurationMinutes,
          nextStatus,
          invoice,
        },
      ];
      if (invoice) {
        primary.push({ ...base, type: "InvoiceIssued", aggregateType: "Invoice", aggregateId: invoice.invoiceId, invoiceId: invoice.invoiceId, visitId: visit.id, lines: invoice.lines, total: invoice.total });
      }
      return withOpdRecompute(state, primary, visit.doctorId, now, "queue_moved_faster");
    }

    case "SetFollowUp": {
      const visit = mustGet(state.visits, command.visitId, "Visit");
      return [{ ...base, type: "FollowUpSet", aggregateType: "Visit", aggregateId: visit.id, visitId: visit.id, dueDate: command.dueDate }];
    }

    case "CloseVisit": {
      const visit = mustGet(state.visits, command.visitId, "Visit");
      if (visit.status === "CLOSED" || visit.status === "LEFT") throw new InvalidVisitState(`Visit ${visit.id} is already ${visit.status}`);
      const pending = Object.values(state.investigations).some((i) => i.visitId === visit.id && i.status === "ORDERED");
      if (pending) throw new InvalidVisitState(`Visit ${visit.id} has an investigation still pending`);

      const alreadyInvoiced = Object.values(state.invoices).some((inv) => inv.visitId === visit.id);
      let invoice: { invoiceId: string; lines: ReturnType<typeof buildInvoiceLines>; total: number } | null = null;
      if (!alreadyInvoiced) {
        const lines = buildInvoiceLines(state, visit.id);
        invoice = { invoiceId: makeId(state, "invoice"), lines, total: lines.reduce((sum, l) => sum + l.amount, 0) };
      }
      const events: Event[] = [{ ...base, type: "VisitClosed", aggregateType: "Visit", aggregateId: visit.id, visitId: visit.id, invoice }];
      if (invoice) {
        events.push({ ...base, type: "InvoiceIssued", aggregateType: "Invoice", aggregateId: invoice.invoiceId, invoiceId: invoice.invoiceId, visitId: visit.id, lines: invoice.lines, total: invoice.total });
      }
      return events;
    }

    case "OrderInvestigation": {
      const visit = mustGet(state.visits, command.visitId, "Visit");
      if (!["IN_CONSULT", "INVESTIGATION_PENDING", "IN_REVIEW"].includes(visit.status)) {
        throw new InvalidVisitState(`Visit ${visit.id} cannot have investigations ordered in status ${visit.status}`);
      }
      const service = mustGet(state.services, command.serviceId, "Service");
      const investigationId = makeId(state, "inv");
      const chargeId = makeId(state, "charge");
      return [
        {
          ...base,
          type: "InvestigationOrdered",
          aggregateType: "Investigation",
          aggregateId: investigationId,
          investigationId,
          visitId: visit.id,
          serviceId: service.id,
          name: service.name,
          chargeId,
          unitPriceSnapshot: service.price,
          amount: service.price,
        },
      ];
    }

    case "RecordInvestigationResult": {
      const inv = mustGet(state.investigations, command.investigationId, "Investigation");
      if (inv.status !== "ORDERED") throw new InvestigationAlreadyResulted(`Investigation ${inv.id} was already resulted`);
      const visit = mustGet(state.visits, inv.visitId, "Visit");
      const otherPending = Object.values(state.investigations).some((i) => i.visitId === visit.id && i.id !== inv.id && i.status === "ORDERED");

      let reviewQueueEntryId: string | null = null;
      let reviewEffectiveReadyTime: number | null = null;
      const primary: Event[] = [];
      if (!otherPending) {
        reviewQueueEntryId = makeId(state, "queue");
        reviewEffectiveReadyTime = computeEffectiveReadyTime({
          queueType: "REVIEW",
          arrivedAt: now,
          resultedAt: now,
          reviewCreditMinutes: state.policy.reviewCreditMinutes,
        });
      }
      primary.push({
        ...base,
        type: "InvestigationResulted",
        aggregateType: "Investigation",
        aggregateId: inv.id,
        investigationId: inv.id,
        visitId: visit.id,
        doctorId: visit.doctorId,
        resultSummary: command.resultSummary,
        resultFlag: command.resultFlag,
        reviewQueueEntryId,
        reviewEffectiveReadyTime,
      });
      if (!reviewQueueEntryId) return primary;
      return withOpdRecompute(state, primary, visit.doctorId, now, "queue_moved_faster");
    }

    case "StartReview": {
      if (command.actorRole === "RECEPTION") throw new UnauthorizedCommand("Reception cannot start a review");
      const entry = mustGet(state.queueEntries, command.queueEntryId, "QueueEntry");
      if (entry.queueType !== "REVIEW" || entry.status !== "WAITING") throw new InvalidVisitState(`Queue entry ${entry.id} cannot start a review`);
      const busy = Object.values(state.queueEntries).some((q) => q.doctorId === entry.doctorId && q.status === "IN_PROGRESS");
      if (busy) throw new DoctorBusy(`Doctor ${entry.doctorId} is already with a patient`);
      return [{ ...base, type: "ReviewStarted", aggregateType: "Visit", aggregateId: entry.visitId, visitId: entry.visitId, queueEntryId: entry.id }];
    }

    case "CompleteReview": {
      const visit = mustGet(state.visits, command.visitId, "Visit");
      if (visit.status !== "IN_REVIEW") throw new InvalidVisitState(`Visit ${visit.id} is not IN_REVIEW`);
      const queueEntry = Object.values(state.queueEntries).find((q) => q.visitId === visit.id && q.status === "IN_PROGRESS" && q.queueType === "REVIEW");
      if (!queueEntry) throw new InvalidVisitState(`No in-progress review queue entry for visit ${visit.id}`);

      const chargeId = makeId(state, "charge");
      const lines = [...buildInvoiceLines(state, visit.id), { chargeId, kind: "REVIEW" as const, description: "Review (same visit, no new consultation charge)", amount: 0 }];
      const invoiceId = makeId(state, "invoice");
      const total = lines.reduce((sum, l) => sum + l.amount, 0);

      const primary: Event[] = [
        { ...base, type: "ReviewCompleted", aggregateType: "Visit", aggregateId: visit.id, visitId: visit.id, queueEntryId: queueEntry.id, chargeId, invoice: { invoiceId, lines, total } },
        { ...base, type: "InvoiceIssued", aggregateType: "Invoice", aggregateId: invoiceId, invoiceId, visitId: visit.id, lines, total },
      ];
      return withOpdRecompute(state, primary, visit.doctorId, now, "queue_moved_faster");
    }

    case "EvaluateCapacity": {
      const session = findOpenSessionForDoctor(state, command.doctorId, now);
      const decision = decideCapacity(state, session, now);
      if (decision.kind === "NONE") return [];
      if (decision.kind === "HOLD") {
        if (isRedundantHold(state, command.doctorId, decision.cause)) return [];
        return [
          {
            ...base,
            type: "CapacityHeld",
            aggregateType: "CapacityLedger",
            aggregateId: makeId(state, "ledger"),
            ledgerId: makeId(state, "ledger"),
            doctorId: command.doctorId,
            protectedAvailable: decision.protectedAvailable,
            reason: decision.reason,
            trigger: command.trigger,
            forecastWalkinCount: 0,
            requiredCapacity: 0,
            margin: 0,
            remainingMinutes: 0,
            policyVersion: state.policy.policyVersion,
          },
        ];
      }
      const ledgerId = makeId(state, "ledger");
      return [
        {
          ...base,
          type: decision.kind === "RELEASE" ? "CapacityReleased" : "CapacityReclaimed",
          aggregateType: "CapacityLedger",
          aggregateId: ledgerId,
          ledgerId,
          doctorId: command.doctorId,
          slotIds: decision.slotIds,
          action: decision.kind === "RELEASE" ? "RELEASE" : "RECLAIM",
          protectedBefore: decision.protectedBefore,
          protectedAfter: decision.protectedAfter,
          delta: decision.protectedAfter - decision.protectedBefore,
          reason: decision.reason,
          trigger: command.trigger,
          forecastWalkinCount: 0,
          requiredCapacity: 0,
          margin: 0,
          remainingMinutes: 0,
          policyVersion: state.policy.policyVersion,
        },
      ];
    }

    case "EvaluateOpdTimes": {
      return recomputeOpdForDoctor({
        state,
        doctorId: command.doctorId,
        now,
        earlierCause: "queue_moved_faster",
        fallbackConsultMinutes: defaultConsultMinutesFor(state, command.doctorId),
      });
    }

    case "ReleaseCapacity": {
      const session = findOpenSessionForDoctor(state, command.doctorId, now);
      const protectedAvailable = Object.values(state.slots)
        .filter((s) => s.sessionId === session.id && s.state === "PROTECTED" && s.time >= now)
        .sort((a, b) => a.time - b.time);
      const floorRoom = protectedAvailable.length - session.minProtected;
      const count = Math.min(command.count, floorRoom);
      if (count < 1) throw new CapacityFloorReached(`Doctor ${command.doctorId} is already at its minimum protected capacity`);
      const toRelease = protectedAvailable.slice(-count).map((s) => s.id);
      const ledgerId = makeId(state, "ledger");
      return [
        {
          ...base,
          type: "CapacityReleased",
          aggregateType: "CapacityLedger",
          aggregateId: ledgerId,
          ledgerId,
          doctorId: command.doctorId,
          slotIds: toRelease,
          action: "RELEASE",
          protectedBefore: protectedAvailable.length,
          protectedAfter: protectedAvailable.length - count,
          delta: -count,
          reason: `manual release of ${count} slot(s)`,
          trigger: "manual",
          forecastWalkinCount: 0,
          requiredCapacity: 0,
          margin: 0,
          remainingMinutes: 0,
          policyVersion: state.policy.policyVersion,
        },
      ];
    }

    case "ReclaimCapacity": {
      const session = findOpenSessionForDoctor(state, command.doctorId, now);
      const releasable = Object.values(state.slots)
        .filter((s) => s.sessionId === session.id && s.state === "RELEASED" && s.time >= now)
        .sort((a, b) => a.time - b.time);
      const protectedAvailable = Object.values(state.slots).filter((s) => s.sessionId === session.id && s.state === "PROTECTED" && s.time >= now).length;
      const count = Math.min(command.count, releasable.length);
      if (count < 1) {
        if (isRedundantHold(state, command.doctorId, "nothing_reclaimable")) return [];
        return [
          {
            ...base,
            type: "CapacityHeld",
            aggregateType: "CapacityLedger",
            aggregateId: makeId(state, "ledger"),
            ledgerId: makeId(state, "ledger"),
            doctorId: command.doctorId,
            protectedAvailable,
            reason: "[nothing_reclaimable] manual reclaim requested but nothing is released",
            trigger: "manual",
            forecastWalkinCount: 0,
            requiredCapacity: 0,
            margin: 0,
            remainingMinutes: 0,
            policyVersion: state.policy.policyVersion,
          },
        ];
      }
      const toReclaim = releasable.slice(0, count).map((s) => s.id);
      const ledgerId = makeId(state, "ledger");
      return [
        {
          ...base,
          type: "CapacityReclaimed",
          aggregateType: "CapacityLedger",
          aggregateId: ledgerId,
          ledgerId,
          doctorId: command.doctorId,
          slotIds: toReclaim,
          action: "RECLAIM",
          protectedBefore: protectedAvailable,
          protectedAfter: protectedAvailable + count,
          delta: count,
          reason: `manual reclaim of ${count} slot(s)`,
          trigger: "manual",
          forecastWalkinCount: 0,
          requiredCapacity: 0,
          margin: 0,
          remainingMinutes: 0,
          policyVersion: state.policy.policyVersion,
        },
      ];
    }

    case "EvaluateNoShow": {
      const appt = mustGet(state.appointments, command.appointmentId, "Appointment");
      if (appt.status !== "BOOKED") return [];
      if (now < appt.slotTime + state.policy.noShowGraceMinutes) return [];
      const primary: Event[] = [
        {
          ...base,
          type: "AppointmentNoShowed",
          aggregateType: "Appointment",
          aggregateId: appt.id,
          appointmentId: appt.id,
          slotId: appt.slotId,
          freedTo: freedSlotState(appt.capacitySource),
        },
      ];
      return withOpdRecompute(state, primary, appt.doctorId, now, "capacity_freed");
    }

    case "SendDueReminder": {
      const appt = mustGet(state.appointments, command.appointmentId, "Appointment");
      if (appt.status !== "BOOKED") return [];
      const notificationId = makeId(state, "notif");
      return [
        {
          ...base,
          type: "NotificationCreated",
          aggregateType: "Notification",
          aggregateId: notificationId,
          notificationId,
          tokenNumber: appt.tokenNumber,
          patientId: appt.patientId,
          appointmentId: appt.id,
          visitId: null,
          kind: "morning_reminder",
          message: "Good morning. This is your appointment reminder. Please be ready around your likely OPD time.",
        },
      ];
    }

    case "IssueInvoice": {
      const visit = mustGet(state.visits, command.visitId, "Visit");
      if (visit.status !== "CLOSED") throw new InvalidVisitState(`Visit ${visit.id} is not CLOSED`);
      if (Object.values(state.invoices).some((inv) => inv.visitId === visit.id)) return [];
      const lines = buildInvoiceLines(state, visit.id);
      const invoiceId = makeId(state, "invoice");
      return [{ ...base, type: "InvoiceIssued", aggregateType: "Invoice", aggregateId: invoiceId, invoiceId, visitId: visit.id, lines, total: lines.reduce((sum, l) => sum + l.amount, 0) }];
    }

    case "ChangeFeeConfig": {
      if (command.actorRole !== "ADMIN") throw new UnauthorizedCommand("Only admin can change fee configuration");
      mustGet(state.doctors, command.doctorId, "Doctor");
      return [{ ...base, type: "FeeConfigChanged", aggregateType: "FeeConfig", aggregateId: command.doctorId, doctorId: command.doctorId, fee: command.fee, effectiveFrom: now }];
    }

    case "ChangePolicyConfig": {
      if (command.actorRole !== "ADMIN") throw new UnauthorizedCommand("Only admin can change the capacity policy");
      const merged = { ...state.policy, ...command.patch };
      // reclaimMargin must stay strictly below releaseMargin — the gap is the hysteresis that
      // stops the policy releasing a slot and immediately reclaiming it, forever.
      if (merged.reclaimMargin >= merged.releaseMargin) {
        throw new DomainError("reclaimMargin must stay strictly below releaseMargin");
      }
      return [{ ...base, type: "PolicyConfigChanged", aggregateType: "Policy", aggregateId: "policy", patch: command.patch as Record<string, number> }];
    }
  }
}
