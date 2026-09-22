// The reducer folds events into state. It never decides anything — decide.ts is the only
// place business rules run. Its own job is narrower but non-negotiable: it must refuse an
// illegal state transition even if an event asks for it. BOOKED -> PROTECTED is the one this
// system exists to prevent, so it is enforced here, not trusted to callers.

import type {
  Appointment,
  Charge,
  CapacityLedgerRow,
  DoctorSession,
  Investigation,
  Invoice,
  NotificationRow,
  OpdChangeRow,
  QueueEntry,
  Slot,
  Visit,
} from "./types";
import type { Event } from "./events";
import type { EngineState } from "./state";
import { createInitialState } from "./state";

export type { EngineState } from "./state";
export { createInitialState } from "./state";

function reduceSessionOpened(state: EngineState, event: Extract<Event, { type: "SessionOpened" }>): EngineState {
  const session: DoctorSession = {
    id: event.sessionId,
    templateId: event.templateId,
    doctorId: event.doctorId,
    date: event.date,
    windowIndex: event.windowIndex,
    startAt: event.startAt,
    endAt: event.endAt,
    slotLengthMinutes: event.slotLengthMinutes,
    totalSlots: event.totalSlots,
    minProtected: event.minProtected,
    status: "OPEN",
    runningDelayMinutes: 0,
    pausedMs: 0,
    pausedAt: null,
    pauseReason: null,
  };

  const newSlots: Record<string, Slot> = {};
  for (const seed of event.slots) {
    newSlots[seed.id] = {
      id: seed.id,
      sessionId: event.sessionId,
      doctorId: event.doctorId,
      index: seed.index,
      time: seed.time,
      state: seed.state,
      appointmentId: null,
      visitId: null,
      capacitySource: null,
      wasReleased: false,
    };
  }

  const ewmaConsultMinutes = { ...state.ewmaConsultMinutes };
  if (ewmaConsultMinutes[event.doctorId] === undefined) {
    ewmaConsultMinutes[event.doctorId] = event.slotLengthMinutes;
  }

  return {
    ...state,
    sessions: { ...state.sessions, [session.id]: session },
    slots: { ...state.slots, ...newSlots },
    ewmaConsultMinutes,
  };
}

/** Applies one capacity-ledger slot transition, refusing anything illegal instead of throwing —
 * the event is already a committed fact; the reducer's job is to fold it safely, not validate
 * intent (decide() already did that before the event existed). */
function applyCapacitySlotTransition(slot: Slot, action: "RELEASE" | "RECLAIM"): Slot {
  if (action === "RELEASE") {
    if (slot.state !== "PROTECTED") return slot;
    return { ...slot, state: "RELEASED", wasReleased: true };
  }
  // RECLAIM: only a RELEASED, still-unbooked slot may return to PROTECTED.
  // BOOKED -> PROTECTED is forbidden even if this event asks for it.
  if (slot.state !== "RELEASED") return slot;
  return { ...slot, state: "PROTECTED" };
}

function reduceCapacityChanged(state: EngineState, event: Extract<Event, { type: "CapacityReleased" | "CapacityReclaimed" }>): EngineState {
  const slots = { ...state.slots };
  for (const slotId of event.slotIds) {
    const slot = slots[slotId];
    if (!slot) continue;
    slots[slotId] = applyCapacitySlotTransition(slot, event.action);
  }

  const ledgerRow: CapacityLedgerRow = {
    id: event.ledgerId,
    ts: event.ts,
    doctorId: event.doctorId,
    action: event.action,
    protectedBefore: event.protectedBefore,
    protectedAfter: event.protectedAfter,
    delta: event.delta,
    reason: event.reason,
    trigger: event.trigger,
    forecastWalkinCount: event.forecastWalkinCount,
    requiredCapacity: event.requiredCapacity,
    margin: event.margin,
    remainingMinutes: event.remainingMinutes,
    policyVersion: event.policyVersion,
  };

  return { ...state, slots, capacityLedger: [...state.capacityLedger, ledgerRow] };
}

function reduceCapacityHeld(state: EngineState, event: Extract<Event, { type: "CapacityHeld" }>): EngineState {
  const ledgerRow: CapacityLedgerRow = {
    id: event.ledgerId,
    ts: event.ts,
    doctorId: event.doctorId,
    action: "HOLD",
    protectedBefore: event.protectedAvailable,
    protectedAfter: event.protectedAvailable,
    delta: 0,
    reason: event.reason,
    trigger: event.trigger,
    forecastWalkinCount: event.forecastWalkinCount,
    requiredCapacity: event.requiredCapacity,
    margin: event.margin,
    remainingMinutes: event.remainingMinutes,
    policyVersion: event.policyVersion,
  };
  return { ...state, capacityLedger: [...state.capacityLedger, ledgerRow] };
}

function patchSlot(state: EngineState, slotId: string, patch: Partial<Slot>): Record<string, Slot> {
  const slot = state.slots[slotId];
  if (!slot) return state.slots;
  return { ...state.slots, [slotId]: { ...slot, ...patch } };
}

function patchSession(state: EngineState, sessionId: string, patch: Partial<DoctorSession>): Record<string, DoctorSession> {
  const session = state.sessions[sessionId];
  if (!session) return state.sessions;
  return { ...state.sessions, [sessionId]: { ...session, ...patch } };
}

function patchAppointment(state: EngineState, appointmentId: string, patch: Partial<Appointment>): Record<string, Appointment> {
  const appt = state.appointments[appointmentId];
  if (!appt) return state.appointments;
  return { ...state.appointments, [appointmentId]: { ...appt, ...patch } };
}

function patchVisit(state: EngineState, visitId: string, patch: Partial<Visit>): Record<string, Visit> {
  const visit = state.visits[visitId];
  if (!visit) return state.visits;
  return { ...state.visits, [visitId]: { ...visit, ...patch } };
}

function patchQueueEntry(state: EngineState, queueEntryId: string, patch: Partial<QueueEntry>): Record<string, QueueEntry> {
  const entry = state.queueEntries[queueEntryId];
  if (!entry) return state.queueEntries;
  return { ...state.queueEntries, [queueEntryId]: { ...entry, ...patch } };
}

function patchInvestigation(state: EngineState, investigationId: string, patch: Partial<Investigation>): Record<string, Investigation> {
  const inv = state.investigations[investigationId];
  if (!inv) return state.investigations;
  return { ...state.investigations, [investigationId]: { ...inv, ...patch } };
}

export function reduce(state: EngineState, event: Event): EngineState {
  switch (event.type) {
    case "SessionOpened":
      return reduceSessionOpened(state, event);

    case "SessionPaused":
      return { ...state, sessions: patchSession(state, event.sessionId, { status: "PAUSED", pausedAt: event.ts, pauseReason: event.reason }) };

    case "SessionResumed": {
      const session = state.sessions[event.sessionId];
      if (!session || session.pausedAt == null) return state;
      const pausedDuration = event.ts - session.pausedAt;
      return {
        ...state,
        sessions: patchSession(state, event.sessionId, {
          status: "OPEN",
          pausedAt: null,
          pauseReason: null,
          pausedMs: session.pausedMs + pausedDuration,
          runningDelayMinutes: session.runningDelayMinutes + pausedDuration,
        }),
      };
    }

    case "SessionEnded":
      return { ...state, sessions: patchSession(state, event.sessionId, { status: "ENDED" }) };

    case "SessionReconfigured": {
      const template = state.sessionTemplates[event.templateId];
      if (!template) return state;
      return { ...state, sessionTemplates: { ...state.sessionTemplates, [event.templateId]: { ...template, ...event.patch } } };
    }

    case "CapacityReleased":
    case "CapacityReclaimed":
      return reduceCapacityChanged(state, event);

    case "CapacityHeld":
      return reduceCapacityHeld(state, event);

    case "PatientRegistered":
      return { ...state, patients: { ...state.patients, [event.patientId]: { id: event.patientId, name: event.name, phone: event.phone } } };

    case "AppointmentBooked": {
      const appointment: Appointment = {
        id: event.appointmentId,
        tokenNumber: event.tokenNumber,
        patientId: event.patientId,
        doctorId: event.doctorId,
        slotId: event.slotId,
        slotTime: event.slotTime,
        status: "BOOKED",
        paymentStatus: event.paymentStatus,
        bookingSource: event.bookingSource,
        capacitySource: event.capacitySource,
        reason: event.reason,
        createdAt: event.ts,
      };
      return {
        ...state,
        appointments: { ...state.appointments, [appointment.id]: appointment },
        slots: patchSlot(state, event.slotId, { state: "BOOKED", appointmentId: appointment.id, capacitySource: event.capacitySource }),
      };
    }

    case "AppointmentCancelled":
      return {
        ...state,
        appointments: patchAppointment(state, event.appointmentId, { status: "CANCELLED" }),
        slots: patchSlot(state, event.slotId, { state: event.freedTo, appointmentId: null, capacitySource: null }),
      };

    case "AppointmentNoShowed":
      return {
        ...state,
        appointments: patchAppointment(state, event.appointmentId, { status: "NO_SHOW" }),
        slots: patchSlot(state, event.slotId, { state: event.freedTo, appointmentId: null, capacitySource: null }),
      };

    case "AppointmentRescheduled": {
      let slots = patchSlot(state, event.oldSlotId, { state: event.oldSlotFreedTo, appointmentId: null, capacitySource: null });
      const newSlot = slots[event.newSlotId];
      if (newSlot) slots = { ...slots, [event.newSlotId]: { ...newSlot, state: "BOOKED", appointmentId: event.appointmentId, capacitySource: event.newCapacitySource } };
      return {
        ...state,
        slots,
        appointments: patchAppointment(state, event.appointmentId, { slotId: event.newSlotId, slotTime: event.newSlotTime }),
      };
    }

    case "PaymentMarkedPrepaid":
      return { ...state, appointments: patchAppointment(state, event.appointmentId, { paymentStatus: "PREPAID" }) };

    case "PaymentCollected":
      if (event.target === "appointment") {
        return { ...state, appointments: patchAppointment(state, event.id, { paymentStatus: "COLLECTED" }) };
      }
      return { ...state, charges: { ...state.charges, [event.id]: { ...state.charges[event.id], status: "COLLECTED" } } };

    case "PatientCheckedIn": {
      const visit: Visit = {
        id: event.visitId,
        tokenNumber: event.tokenNumber,
        appointmentId: event.appointmentId,
        patientId: event.patientId,
        doctorId: event.doctorId,
        reason: event.reason,
        status: "WAITING_CONSULT",
        createdAt: event.ts,
        consultationStartedAt: null,
        followUpDueDate: null,
      };
      const queueEntry: QueueEntry = {
        id: event.queueEntryId,
        doctorId: event.doctorId,
        visitId: event.visitId,
        queueType: "CONSULT",
        effectiveReadyTime: event.effectiveReadyTime,
        enteredAt: event.ts,
        exitedAt: null,
        status: "WAITING",
        priorityTier: 0,
        priorityReason: null,
        priorityActor: null,
      };
      return {
        ...state,
        appointments: patchAppointment(state, event.appointmentId, { status: "ARRIVED" }),
        visits: { ...state.visits, [visit.id]: visit },
        queueEntries: { ...state.queueEntries, [queueEntry.id]: queueEntry },
      };
    }

    case "WalkInRegistered": {
      const visit: Visit = {
        id: event.visitId,
        tokenNumber: event.tokenNumber,
        appointmentId: null,
        patientId: event.patientId,
        doctorId: event.doctorId,
        reason: event.reason,
        status: "WAITING_CONSULT",
        createdAt: event.ts,
        consultationStartedAt: null,
        followUpDueDate: null,
      };
      const queueEntry: QueueEntry = {
        id: event.queueEntryId,
        doctorId: event.doctorId,
        visitId: event.visitId,
        queueType: "CONSULT",
        effectiveReadyTime: event.effectiveReadyTime,
        enteredAt: event.ts,
        exitedAt: null,
        status: "WAITING",
        priorityTier: 0,
        priorityReason: null,
        priorityActor: null,
      };
      return {
        ...state,
        visits: { ...state.visits, [visit.id]: visit },
        queueEntries: { ...state.queueEntries, [queueEntry.id]: queueEntry },
        slots: patchSlot(state, event.slotId, { state: "CONSUMED", visitId: visit.id, capacitySource: "PROTECTED" }),
      };
    }

    case "WalkInDeferred":
      return state;

    case "PatientLeftQueue":
      return {
        ...state,
        queueEntries: patchQueueEntry(state, event.queueEntryId, { status: "LEFT", exitedAt: event.ts }),
        visits: patchVisit(state, event.visitId, { status: "LEFT" }),
      };

    case "PriorityEscalated":
      return {
        ...state,
        queueEntries: patchQueueEntry(state, event.queueEntryId, { priorityTier: event.tier, priorityReason: event.reason, priorityActor: event.actorId }),
      };

    case "ConsultationStarted": {
      let sessions = state.sessions;
      if (event.sessionId) sessions = patchSession(state, event.sessionId, { runningDelayMinutes: event.runningDelayMinutes });
      return {
        ...state,
        sessions,
        visits: patchVisit(state, event.visitId, { status: "IN_CONSULT", consultationStartedAt: event.ts }),
        queueEntries: patchQueueEntry(state, event.queueEntryId, { status: "IN_PROGRESS" }),
      };
    }

    case "ConsultationCompleted": {
      let charges = state.charges;
      if (event.chargeId) {
        const charge: Charge = {
          id: event.chargeId,
          visitId: event.visitId,
          kind: "CONSULTATION",
          unitPriceSnapshot: event.unitPriceSnapshot,
          amount: event.amount,
          status: event.chargeStatus,
          createdAt: event.ts,
          capacitySource: null,
          bookingSource: null,
        };
        charges = { ...charges, [charge.id]: charge };
      }
      const visit = state.visits[event.visitId];
      const doctorId = visit?.doctorId;
      const ewmaConsultMinutes = { ...state.ewmaConsultMinutes };
      if (doctorId) {
        const previous = ewmaConsultMinutes[doctorId] ?? event.actualDurationMinutes;
        ewmaConsultMinutes[doctorId] = 0.3 * event.actualDurationMinutes + 0.7 * previous;
      }
      return {
        ...state,
        charges,
        ewmaConsultMinutes,
        queueEntries: patchQueueEntry(state, event.queueEntryId, { status: "DONE", exitedAt: event.ts }),
        visits: patchVisit(state, event.visitId, { status: event.nextStatus }),
      };
    }

    case "FollowUpSet":
      return { ...state, visits: patchVisit(state, event.visitId, { followUpDueDate: event.dueDate }) };

    case "VisitClosed":
      return { ...state, visits: patchVisit(state, event.visitId, { status: "CLOSED" }) };

    case "InvoiceIssued": {
      const invoice: Invoice = { id: event.invoiceId, visitId: event.visitId, lines: event.lines, total: event.total, issuedAt: event.ts };
      return { ...state, invoices: { ...state.invoices, [invoice.id]: invoice } };
    }

    case "InvestigationOrdered": {
      const investigation: Investigation = {
        id: event.investigationId,
        visitId: event.visitId,
        serviceId: event.serviceId,
        name: event.name,
        status: "ORDERED",
        orderedAt: event.ts,
        resultedAt: null,
        resultSummary: null,
        resultFlag: null,
      };
      const charge: Charge = {
        id: event.chargeId,
        visitId: event.visitId,
        kind: "INVESTIGATION",
        unitPriceSnapshot: event.unitPriceSnapshot,
        amount: event.amount,
        status: "DUE",
        createdAt: event.ts,
        capacitySource: null,
        bookingSource: null,
      };
      return {
        ...state,
        investigations: { ...state.investigations, [investigation.id]: investigation },
        charges: { ...state.charges, [charge.id]: charge },
      };
    }

    case "InvestigationResulted": {
      let visits = patchVisit(state, event.visitId, {});
      let queueEntries = state.queueEntries;
      if (event.reviewQueueEntryId && event.reviewEffectiveReadyTime != null) {
        visits = patchVisit(state, event.visitId, { status: "WAITING_REVIEW" });
        const reviewEntry: QueueEntry = {
          id: event.reviewQueueEntryId,
          doctorId: event.doctorId,
          visitId: event.visitId,
          queueType: "REVIEW",
          effectiveReadyTime: event.reviewEffectiveReadyTime,
          enteredAt: event.ts,
          exitedAt: null,
          status: "WAITING",
          priorityTier: 0,
          priorityReason: null,
          priorityActor: null,
        };
        queueEntries = { ...queueEntries, [reviewEntry.id]: reviewEntry };
      }
      return {
        ...state,
        visits,
        queueEntries,
        investigations: patchInvestigation(state, event.investigationId, {
          status: "RESULTED",
          resultedAt: event.ts,
          resultSummary: event.resultSummary,
          resultFlag: event.resultFlag,
        }),
      };
    }

    case "ReviewStarted":
      return {
        ...state,
        visits: patchVisit(state, event.visitId, { status: "IN_REVIEW", consultationStartedAt: event.ts }),
        queueEntries: patchQueueEntry(state, event.queueEntryId, { status: "IN_PROGRESS" }),
      };

    case "ReviewCompleted": {
      const charge: Charge = {
        id: event.chargeId,
        visitId: event.visitId,
        kind: "REVIEW",
        unitPriceSnapshot: 0,
        amount: 0,
        status: "COLLECTED",
        createdAt: event.ts,
        capacitySource: null,
        bookingSource: null,
      };
      return {
        ...state,
        charges: { ...state.charges, [charge.id]: charge },
        queueEntries: patchQueueEntry(state, event.queueEntryId, { status: "DONE", exitedAt: event.ts }),
        visits: patchVisit(state, event.visitId, { status: "CLOSED" }),
      };
    }

    case "FeeConfigChanged":
      return { ...state, feeHistory: [...state.feeHistory, { doctorId: event.doctorId, fee: event.fee, effectiveFrom: event.effectiveFrom }] };

    case "PolicyConfigChanged":
      return { ...state, policy: { ...state.policy, ...event.patch } };

    case "LikelyOpdTimeChanged": {
      const row: OpdChangeRow = {
        id: event.opdChangeId,
        ts: event.ts,
        tokenNumber: event.tokenNumber,
        patientId: event.patientId,
        doctorId: event.doctorId,
        from: event.from,
        to: event.to,
        cause: event.cause,
      };
      return { ...state, opdChanges: [...state.opdChanges, row] };
    }

    case "NotificationCreated": {
      const row: NotificationRow = {
        id: event.notificationId,
        ts: event.ts,
        tokenNumber: event.tokenNumber,
        patientId: event.patientId,
        kind: event.kind,
        message: event.message,
        delivered: true,
      };
      return { ...state, notifications: [...state.notifications, row] };
    }
  }
}

export function replay(events: Event[]): EngineState {
  return events.reduce(reduce, createInitialState());
}
