// Turns a raw event into a human-readable label + detail line for the admin event log.
// Presentation only — never used by decide() or the reducer.

import type { Event } from "@/lib/engine/events";
import { formatClockLabel } from "@/lib/engine/time";

export function describeEvent(event: Event): { label: string; detail: string } {
  switch (event.type) {
    case "SessionOpened":
      return { label: "Session opened", detail: `${event.doctorId} on ${event.date}, window ${event.windowIndex}, ${event.totalSlots} slots` };
    case "SessionPaused":
      return { label: "Session paused", detail: event.reason };
    case "SessionResumed":
      return { label: "Session resumed", detail: "" };
    case "SessionEnded":
      return { label: "Session ended", detail: "" };
    case "SessionReconfigured":
      return { label: "Session template reconfigured", detail: JSON.stringify(event.patch) };
    case "CapacityReleased":
      return { label: "Capacity released", detail: `${event.protectedBefore} → ${event.protectedAfter} protected (${event.doctorId})` };
    case "CapacityReclaimed":
      return { label: "Capacity reclaimed", detail: `${event.protectedBefore} → ${event.protectedAfter} protected (${event.doctorId})` };
    case "CapacityHeld":
      return { label: "Capacity held", detail: event.reason };
    case "PatientRegistered":
      return { label: "Patient registered", detail: `${event.name}` };
    case "AppointmentBooked":
      return { label: "Appointment booked", detail: `token #${event.tokenNumber}, ${formatClockLabel(event.slotTime)}` };
    case "AppointmentCancelled":
      return { label: "Appointment cancelled", detail: event.appointmentId };
    case "AppointmentNoShowed":
      return { label: "Marked no-show", detail: event.appointmentId };
    case "AppointmentRescheduled":
      return { label: "Appointment rescheduled", detail: `to ${formatClockLabel(event.newSlotTime)}` };
    case "PaymentMarkedPrepaid":
      return { label: "Marked prepaid", detail: event.appointmentId };
    case "PaymentCollected":
      return { label: "Payment collected", detail: `${event.target} ${event.id}` };
    case "PatientCheckedIn":
      return { label: "Patient checked in", detail: `token #${event.tokenNumber}` };
    case "WalkInRegistered":
      return { label: "Walk-in registered", detail: `token #${event.tokenNumber}, ${event.doctorId}` };
    case "WalkInDeferred":
      return { label: "Walk-in deferred", detail: event.suggestion };
    case "PatientLeftQueue":
      return { label: "Patient left queue", detail: event.queueEntryId };
    case "PriorityEscalated":
      return { label: "Priority escalated", detail: `tier ${event.tier} — ${event.reason}` };
    case "ConsultationStarted":
      return { label: "Consultation started", detail: event.visitId };
    case "ConsultationCompleted":
      return { label: "Consultation completed", detail: `${event.actualDurationMinutes}m, ${event.nextStatus}` };
    case "FollowUpSet":
      return { label: "Follow-up set", detail: event.dueDate };
    case "VisitClosed":
      return { label: "Visit closed", detail: event.visitId };
    case "InvoiceIssued":
      return { label: "Invoice issued", detail: `₹${event.total}` };
    case "InvestigationOrdered":
      return { label: "Investigation ordered", detail: event.name };
    case "InvestigationResulted":
      return { label: "Investigation resulted", detail: `${event.resultFlag} — ${event.resultSummary}` };
    case "ReviewStarted":
      return { label: "Review started", detail: event.visitId };
    case "ReviewCompleted":
      return { label: "Review completed", detail: event.visitId };
    case "FeeConfigChanged":
      return { label: "Fee changed", detail: `${event.doctorId} → ₹${event.fee}` };
    case "DoctorRegistered":
      return {
        label: "Doctor added",
        detail: `${event.name} (${event.specialty}, ${event.room}) at ₹${event.consultationFee}, ${event.templates.length} weekly sessions`,
      };
    case "PolicyConfigChanged":
      return { label: "Policy changed", detail: JSON.stringify(event.patch) };
    case "LikelyOpdTimeChanged":
      return { label: "Likely OPD time changed", detail: `token #${event.tokenNumber}: ${formatClockLabel(event.from)} → ${formatClockLabel(event.to)} (${event.cause})` };
    case "NotificationCreated":
      return { label: "Notification sent", detail: event.message };
  }
}
