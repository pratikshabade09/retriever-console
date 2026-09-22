// Event types. Events are past-tense facts appended to the log; the reducer folds them into
// state. This module must never import React, next/*, Node builtins, or fetch.

import type {
  ActorRole,
  CapacityAction,
  InvoiceLine,
  OpdChangeCause,
  PaymentStatus,
  BookingSource,
  CapacitySource,
  PriorityTier,
  ResultFlag,
  SlotState,
  VisitStatus,
} from "./types";

export type AggregateType =
  | "SessionTemplate"
  | "DoctorSession"
  | "Slot"
  | "Patient"
  | "Appointment"
  | "Visit"
  | "QueueEntry"
  | "Investigation"
  | "Charge"
  | "Invoice"
  | "CapacityLedger"
  | "FeeConfig"
  | "Policy"
  | "Notification";

interface EventBase {
  ts: number;
  actorRole: ActorRole;
  actorId: string;
  aggregateType: AggregateType;
  aggregateId: string;
  v: 1;
}

/** The slot layout a SessionOpened event seeds — computed by lib/engine/sessionSlots.ts. */
export interface SlotSeed {
  id: string;
  index: number;
  time: number;
  state: Extract<SlotState, "OPEN" | "PROTECTED">;
}

export interface SessionOpened extends EventBase {
  type: "SessionOpened";
  aggregateType: "DoctorSession";
  sessionId: string;
  templateId: string;
  doctorId: string;
  date: string;
  windowIndex: number;
  startAt: number;
  endAt: number;
  slotLengthMinutes: number;
  totalSlots: number;
  minProtected: number;
  slots: SlotSeed[];
}

export interface SessionPaused extends EventBase {
  type: "SessionPaused";
  aggregateType: "DoctorSession";
  sessionId: string;
  reason: string;
}

export interface SessionResumed extends EventBase {
  type: "SessionResumed";
  aggregateType: "DoctorSession";
  sessionId: string;
}

export interface SessionEnded extends EventBase {
  type: "SessionEnded";
  aggregateType: "DoctorSession";
  sessionId: string;
}

export interface SessionReconfigured extends EventBase {
  type: "SessionReconfigured";
  aggregateType: "SessionTemplate";
  templateId: string;
  patch: {
    startMinutes?: number;
    endMinutes?: number;
    slotLengthMinutes?: number;
    totalSlots?: number;
    initialProtected?: number;
    minProtected?: number;
  };
}

export interface CapacityChanged extends EventBase {
  type: "CapacityReleased" | "CapacityReclaimed";
  aggregateType: "CapacityLedger";
  ledgerId: string;
  doctorId: string;
  slotIds: string[];
  action: Extract<CapacityAction, "RELEASE" | "RECLAIM">;
  protectedBefore: number;
  protectedAfter: number;
  delta: number;
  reason: string;
  trigger: string;
  forecastWalkinCount: number;
  requiredCapacity: number;
  margin: number;
  remainingMinutes: number;
  policyVersion: string;
}

export interface CapacityHeld extends EventBase {
  type: "CapacityHeld";
  aggregateType: "CapacityLedger";
  ledgerId: string;
  doctorId: string;
  protectedAvailable: number;
  reason: string;
  trigger: string;
  forecastWalkinCount: number;
  requiredCapacity: number;
  margin: number;
  remainingMinutes: number;
  policyVersion: string;
}

export interface PatientRegistered extends EventBase {
  type: "PatientRegistered";
  aggregateType: "Patient";
  patientId: string;
  name: string;
  phone: string;
}

export interface AppointmentBooked extends EventBase {
  type: "AppointmentBooked";
  aggregateType: "Appointment";
  appointmentId: string;
  tokenNumber: number;
  patientId: string;
  doctorId: string;
  slotId: string;
  slotTime: number;
  paymentStatus: PaymentStatus;
  bookingSource: BookingSource;
  capacitySource: CapacitySource;
  reason: string;
}

export interface AppointmentCancelled extends EventBase {
  type: "AppointmentCancelled";
  aggregateType: "Appointment";
  appointmentId: string;
  slotId: string;
  freedTo: Extract<SlotState, "OPEN" | "RELEASED">;
}

export interface AppointmentNoShowed extends EventBase {
  type: "AppointmentNoShowed";
  aggregateType: "Appointment";
  appointmentId: string;
  slotId: string;
  freedTo: Extract<SlotState, "OPEN" | "RELEASED">;
}

export interface AppointmentRescheduled extends EventBase {
  type: "AppointmentRescheduled";
  aggregateType: "Appointment";
  appointmentId: string;
  oldSlotId: string;
  oldSlotFreedTo: Extract<SlotState, "OPEN" | "RELEASED">;
  newSlotId: string;
  newSlotTime: number;
  newCapacitySource: CapacitySource;
}

export interface PaymentMarkedPrepaid extends EventBase {
  type: "PaymentMarkedPrepaid";
  aggregateType: "Appointment";
  appointmentId: string;
}

export interface PaymentCollected extends EventBase {
  type: "PaymentCollected";
  aggregateType: "Appointment" | "Charge";
  target: "appointment" | "charge";
  id: string;
}

export interface PatientCheckedIn extends EventBase {
  type: "PatientCheckedIn";
  aggregateType: "Visit";
  appointmentId: string;
  visitId: string;
  patientId: string;
  doctorId: string;
  tokenNumber: number;
  reason: string;
  queueEntryId: string;
  effectiveReadyTime: number;
}

export interface WalkInRegistered extends EventBase {
  type: "WalkInRegistered";
  aggregateType: "Visit";
  patientId: string;
  doctorId: string;
  visitId: string;
  tokenNumber: number;
  slotId: string;
  reason: string;
  queueEntryId: string;
  effectiveReadyTime: number;
}

export interface WalkInDeferred extends EventBase {
  type: "WalkInDeferred";
  aggregateType: "Patient";
  patientId: string;
  doctorId: string;
  suggestion: string;
}

export interface PatientLeftQueue extends EventBase {
  type: "PatientLeftQueue";
  aggregateType: "QueueEntry";
  queueEntryId: string;
  visitId: string;
}

export interface PriorityEscalated extends EventBase {
  type: "PriorityEscalated";
  aggregateType: "QueueEntry";
  queueEntryId: string;
  tier: PriorityTier;
  reason: string;
}

export interface ConsultationStarted extends EventBase {
  type: "ConsultationStarted";
  aggregateType: "Visit";
  visitId: string;
  queueEntryId: string;
  doctorId: string;
  runningDelayMinutes: number;
  sessionId: string | null;
}

export interface ConsultationCompleted extends EventBase {
  type: "ConsultationCompleted";
  aggregateType: "Visit";
  visitId: string;
  queueEntryId: string;
  chargeId: string | null;
  unitPriceSnapshot: number;
  amount: number;
  chargeStatus: "DUE" | "COLLECTED";
  actualDurationMinutes: number;
  nextStatus: VisitStatus;
  invoice: { invoiceId: string; lines: InvoiceLine[]; total: number } | null;
}

export interface FollowUpSet extends EventBase {
  type: "FollowUpSet";
  aggregateType: "Visit";
  visitId: string;
  dueDate: string;
}

export interface VisitClosed extends EventBase {
  type: "VisitClosed";
  aggregateType: "Visit";
  visitId: string;
  invoice: { invoiceId: string; lines: InvoiceLine[]; total: number } | null;
}

export interface InvoiceIssued extends EventBase {
  type: "InvoiceIssued";
  aggregateType: "Invoice";
  invoiceId: string;
  visitId: string;
  lines: InvoiceLine[];
  total: number;
}

export interface InvestigationOrdered extends EventBase {
  type: "InvestigationOrdered";
  aggregateType: "Investigation";
  investigationId: string;
  visitId: string;
  serviceId: string;
  name: string;
  chargeId: string;
  unitPriceSnapshot: number;
  amount: number;
}

export interface InvestigationResulted extends EventBase {
  type: "InvestigationResulted";
  aggregateType: "Investigation";
  investigationId: string;
  visitId: string;
  doctorId: string;
  resultSummary: string;
  resultFlag: ResultFlag;
  reviewQueueEntryId: string | null;
  reviewEffectiveReadyTime: number | null;
}

export interface ReviewStarted extends EventBase {
  type: "ReviewStarted";
  aggregateType: "Visit";
  visitId: string;
  queueEntryId: string;
}

export interface ReviewCompleted extends EventBase {
  type: "ReviewCompleted";
  aggregateType: "Visit";
  visitId: string;
  queueEntryId: string;
  chargeId: string;
  invoice: { invoiceId: string; lines: InvoiceLine[]; total: number } | null;
}

export interface FeeConfigChanged extends EventBase {
  type: "FeeConfigChanged";
  aggregateType: "FeeConfig";
  doctorId: string;
  fee: number;
  effectiveFrom: number;
}

export interface PolicyConfigChanged extends EventBase {
  type: "PolicyConfigChanged";
  aggregateType: "Policy";
  patch: Record<string, number>;
}

export interface LikelyOpdTimeChanged extends EventBase {
  type: "LikelyOpdTimeChanged";
  aggregateType: "Appointment";
  opdChangeId: string;
  tokenNumber: number;
  patientId: string;
  doctorId: string;
  from: number;
  to: number;
  cause: OpdChangeCause;
}

export interface NotificationCreated extends EventBase {
  type: "NotificationCreated";
  aggregateType: "Notification";
  notificationId: string;
  tokenNumber: number;
  patientId: string;
  kind: string;
  message: string;
}

export type Event =
  | SessionOpened
  | SessionPaused
  | SessionResumed
  | SessionEnded
  | SessionReconfigured
  | CapacityChanged
  | CapacityHeld
  | PatientRegistered
  | AppointmentBooked
  | AppointmentCancelled
  | AppointmentNoShowed
  | AppointmentRescheduled
  | PaymentMarkedPrepaid
  | PaymentCollected
  | PatientCheckedIn
  | WalkInRegistered
  | WalkInDeferred
  | PatientLeftQueue
  | PriorityEscalated
  | ConsultationStarted
  | ConsultationCompleted
  | FollowUpSet
  | VisitClosed
  | InvoiceIssued
  | InvestigationOrdered
  | InvestigationResulted
  | ReviewStarted
  | ReviewCompleted
  | FeeConfigChanged
  | PolicyConfigChanged
  | LikelyOpdTimeChanged
  | NotificationCreated;
