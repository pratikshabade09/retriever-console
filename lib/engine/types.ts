// Pure domain types. This module must never import React, next/*, Node builtins, or fetch.

export type Weekday = "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN";

export type ActorRole = "PATIENT" | "RECEPTION" | "DOCTOR" | "ADMIN" | "SYSTEM";

export interface Doctor {
  id: string;
  name: string;
  specialty: string;
  room: string;
}

/** One doctor's recurring weekly pattern for one window of one weekday. Khan has two
 * templates for the same weekday (morning + evening); every other doctor has one. */
export interface SessionTemplate {
  id: string;
  doctorId: string;
  weekday: Weekday;
  windowIndex: number;
  startMinutes: number; // minutes from midnight, clinic-local time
  endMinutes: number;
  slotLengthMinutes: number;
  totalSlots: number;
  initialProtected: number;
  minProtected: number;
}

export type SessionStatus = "SCHEDULED" | "OPEN" | "PAUSED" | "ENDED";

/** One doctor, one date, one time window — materialized from a SessionTemplate.
 * startAt/endAt are absolute minutes (see time.ts), unlike the template's minute-of-day
 * fields, because a session is pinned to one specific date. */
export interface DoctorSession {
  id: string;
  templateId: string;
  doctorId: string;
  date: string; // YYYY-MM-DD, clinic-local
  windowIndex: number;
  startAt: number;
  endAt: number;
  slotLengthMinutes: number;
  totalSlots: number;
  minProtected: number;
  status: SessionStatus;
  runningDelayMinutes: number;
  // Cumulative paused duration in minutes — the field name mirrors the spec's `pausedMs`, but
  // like every other time value in this engine it is in absolute minutes, not milliseconds.
  pausedMs: number;
  pausedAt: number | null;
  pauseReason: string | null;
}

export type SlotState = "OPEN" | "PROTECTED" | "RELEASED" | "BOOKED" | "CONSUMED";
export type CapacitySource = "PROTECTED" | "RELEASED" | "OPEN";

export interface Slot {
  id: string;
  sessionId: string;
  doctorId: string;
  index: number;
  time: number; // absolute epoch minutes
  state: SlotState;
  appointmentId: string | null;
  visitId: string | null;
  capacitySource: CapacitySource | null;
  wasReleased: boolean;
}

export type AppointmentStatus = "BOOKED" | "CANCELLED" | "RESCHEDULED" | "NO_SHOW" | "ARRIVED";
export type PaymentStatus = "PREPAID" | "PAY_AT_CLINIC" | "COLLECTED";
export type BookingSource = "PATIENT" | "RECEPTION";

export interface Appointment {
  id: string;
  tokenNumber: number;
  patientId: string;
  doctorId: string;
  slotId: string;
  slotTime: number;
  status: AppointmentStatus;
  paymentStatus: PaymentStatus;
  bookingSource: BookingSource;
  capacitySource: CapacitySource;
  reason: string;
  createdAt: number;
}

export type VisitStatus =
  | "WAITING_CONSULT"
  | "IN_CONSULT"
  | "INVESTIGATION_PENDING"
  | "WAITING_REVIEW"
  | "IN_REVIEW"
  | "CLOSED"
  | "LEFT";

export interface Visit {
  id: string;
  tokenNumber: number;
  appointmentId: string | null;
  patientId: string;
  doctorId: string;
  reason: string;
  status: VisitStatus;
  createdAt: number;
  consultationStartedAt: number | null;
  followUpDueDate: string | null;
}

export type QueueType = "CONSULT" | "REVIEW";
export type QueueEntryStatus = "WAITING" | "IN_PROGRESS" | "DONE" | "LEFT";
export type PriorityTier = 0 | 1 | 2;

export interface QueueEntry {
  id: string;
  doctorId: string;
  visitId: string;
  queueType: QueueType;
  effectiveReadyTime: number;
  enteredAt: number;
  exitedAt: number | null;
  status: QueueEntryStatus;
  priorityTier: PriorityTier;
  priorityReason: string | null;
  priorityActor: string | null;
}

export type InvestigationStatus = "ORDERED" | "RESULTED";
export type ResultFlag = "NORMAL" | "ABNORMAL";

export interface Investigation {
  id: string;
  visitId: string;
  serviceId: string;
  name: string;
  status: InvestigationStatus;
  orderedAt: number;
  resultedAt: number | null;
  resultSummary: string | null;
  resultFlag: ResultFlag | null;
}

export type ChargeKind = "CONSULTATION" | "INVESTIGATION" | "REVIEW";
export type ChargeStatus = "DUE" | "COLLECTED";

export interface Charge {
  id: string;
  visitId: string;
  kind: ChargeKind;
  unitPriceSnapshot: number;
  amount: number;
  status: ChargeStatus;
  createdAt: number;
  capacitySource: CapacitySource | null;
  bookingSource: BookingSource | null;
}

export type CapacityAction = "RELEASE" | "RECLAIM" | "HOLD";

export interface CapacityLedgerRow {
  id: string;
  ts: number;
  doctorId: string;
  action: CapacityAction;
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

export interface NotificationRow {
  id: string;
  ts: number;
  tokenNumber: number;
  patientId: string;
  kind: string;
  message: string;
  delivered: boolean;
}

export interface Patient {
  id: string;
  name: string;
  phone: string;
}

export interface FeeConfigRow {
  doctorId: string;
  fee: number;
  effectiveFrom: number; // ts
}

export interface WalkInRatePoint {
  doctorId: string;
  hour: number; // 0-23, clinic-local
  ratePerHour: number;
}

export interface CapacityPolicyConfig {
  policyVersion: string;
  protectionHorizonMinutes: number;
  releaseMargin: number;
  reclaimMargin: number;
  minMeaningfulDelta: number;
  cooldownMinutes: number;
  evaluationIntervalMinutes: number;
  noShowGraceMinutes: number;
  reviewCreditMinutes: number;
  baselineWalkinRatePerHour: number;
}

export interface Service {
  id: string;
  name: string;
  turnaroundMinutes: number;
  price: number;
}

export interface InvoiceLine {
  chargeId: string;
  kind: ChargeKind;
  description: string;
  amount: number;
}

export interface Invoice {
  id: string;
  visitId: string;
  lines: InvoiceLine[];
  total: number;
  issuedAt: number;
}

export type OpdChangeCause = "doctor_running_late" | "capacity_freed" | "queue_moved_faster";

export interface OpdChangeRow {
  id: string;
  ts: number;
  tokenNumber: number;
  patientId: string;
  doctorId: string;
  from: number;
  to: number;
  cause: OpdChangeCause;
}
