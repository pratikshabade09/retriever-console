// Command types. A command is a request to change state; only decide() turns one into events.
// Not every command is implemented by decide() yet — see CLAUDE.md's recipe for adding one.
// This module must never import React, next/*, Node builtins, or fetch.

import type { ActorRole, BookingSource, PriorityTier, ResultFlag } from "./types";

interface CommandBase {
  actorRole: ActorRole;
  actorId: string;
}

export interface OpenSession extends CommandBase {
  type: "OpenSession";
  doctorId: string;
  date: string;
  windowIndex: number;
}

export interface PauseSession extends CommandBase {
  type: "PauseSession";
  sessionId: string;
  reason: string;
}

export interface ResumeSession extends CommandBase {
  type: "ResumeSession";
  sessionId: string;
}

export interface EndSession extends CommandBase {
  type: "EndSession";
  sessionId: string;
}

export interface ReconfigureSession extends CommandBase {
  type: "ReconfigureSession";
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

export interface RegisterPatient extends CommandBase {
  type: "RegisterPatient";
  name: string;
  phone: string;
}

export interface BookAppointment extends CommandBase {
  type: "BookAppointment";
  patientId: string;
  doctorId: string;
  slotId: string;
  reason: string;
  bookingSource: BookingSource;
  paymentStatus: "PREPAID" | "PAY_AT_CLINIC";
}

export interface CancelAppointment extends CommandBase {
  type: "CancelAppointment";
  appointmentId: string;
}

export interface RescheduleAppointment extends CommandBase {
  type: "RescheduleAppointment";
  appointmentId: string;
  newSlotId: string;
}

export interface MarkPrepaid extends CommandBase {
  type: "MarkPrepaid";
  appointmentId: string;
}

export interface CollectPayment extends CommandBase {
  type: "CollectPayment";
  // Pre-visit, a PAY_AT_CLINIC appointment has no Charge yet (charges are only created at
  // CompleteConsultation/OrderInvestigation) — reception collects against the appointment
  // itself. Post-visit collections (e.g. an outstanding investigation charge) target a Charge.
  target: "appointment" | "charge";
  id: string;
}

export interface CheckInPatient extends CommandBase {
  type: "CheckInPatient";
  appointmentId: string;
}

export interface RegisterWalkIn extends CommandBase {
  type: "RegisterWalkIn";
  patientId: string;
  doctorId: string;
  reason: string;
}

export interface LeaveQueue extends CommandBase {
  type: "LeaveQueue";
  queueEntryId: string;
}

export interface EscalatePriority extends CommandBase {
  type: "EscalatePriority";
  queueEntryId: string;
  tier: PriorityTier;
  reason: string;
}

export interface StartConsultation extends CommandBase {
  type: "StartConsultation";
  queueEntryId: string;
}

export interface CompleteConsultation extends CommandBase {
  type: "CompleteConsultation";
  visitId: string;
}

export interface SetFollowUp extends CommandBase {
  type: "SetFollowUp";
  visitId: string;
  dueDate: string;
}

export interface CloseVisit extends CommandBase {
  type: "CloseVisit";
  visitId: string;
}

export interface OrderInvestigation extends CommandBase {
  type: "OrderInvestigation";
  visitId: string;
  serviceId: string;
}

export interface RecordInvestigationResult extends CommandBase {
  type: "RecordInvestigationResult";
  investigationId: string;
  resultSummary: string;
  resultFlag: ResultFlag;
}

export interface StartReview extends CommandBase {
  type: "StartReview";
  queueEntryId: string;
}

export interface CompleteReview extends CommandBase {
  type: "CompleteReview";
  visitId: string;
}

export interface EvaluateCapacity extends CommandBase {
  type: "EvaluateCapacity";
  doctorId: string;
  trigger: string;
}

export interface EvaluateOpdTimes extends CommandBase {
  type: "EvaluateOpdTimes";
  doctorId: string;
}

export interface ReleaseCapacity extends CommandBase {
  type: "ReleaseCapacity";
  doctorId: string;
  count: number;
}

export interface ReclaimCapacity extends CommandBase {
  type: "ReclaimCapacity";
  doctorId: string;
  count: number;
}

export interface EvaluateNoShow extends CommandBase {
  type: "EvaluateNoShow";
  appointmentId: string;
}

export interface SendDueReminder extends CommandBase {
  type: "SendDueReminder";
  appointmentId: string;
}

export interface IssueInvoice extends CommandBase {
  type: "IssueInvoice";
  visitId: string;
}

export interface ChangeFeeConfig extends CommandBase {
  type: "ChangeFeeConfig";
  doctorId: string;
  fee: number;
}

export interface ChangePolicyConfig extends CommandBase {
  type: "ChangePolicyConfig";
  patch: Partial<{
    protectionHorizonMinutes: number;
    releaseMargin: number;
    reclaimMargin: number;
    minMeaningfulDelta: number;
    cooldownMinutes: number;
    evaluationIntervalMinutes: number;
    noShowGraceMinutes: number;
    reviewCreditMinutes: number;
    baselineWalkinRatePerHour: number;
  }>;
}

export type Command =
  | OpenSession
  | PauseSession
  | ResumeSession
  | EndSession
  | ReconfigureSession
  | RegisterPatient
  | BookAppointment
  | CancelAppointment
  | RescheduleAppointment
  | MarkPrepaid
  | CollectPayment
  | CheckInPatient
  | RegisterWalkIn
  | LeaveQueue
  | EscalatePriority
  | StartConsultation
  | CompleteConsultation
  | SetFollowUp
  | CloseVisit
  | OrderInvestigation
  | RecordInvestigationResult
  | StartReview
  | CompleteReview
  | EvaluateCapacity
  | EvaluateOpdTimes
  | ReleaseCapacity
  | ReclaimCapacity
  | EvaluateNoShow
  | SendDueReminder
  | IssueInvoice
  | ChangeFeeConfig
  | ChangePolicyConfig;
