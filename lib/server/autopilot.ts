// The seeded autopilot: a simulated clinic day driven entirely as an external client would
// drive it — constructing ordinary Commands and running them through decide()/reduce(), the
// exact same pipeline a human at a keyboard uses. The engine has no idea a simulation is
// running; nothing here is a special "autopilot mode" inside lib/engine.
//
// Determinism comes from lib/engine/hash.ts: every random-seeming choice below is
// `hashUnit(seed, someStableKey)`, so the same seed reproduces an identical day byte-for-byte.

import type { EngineState } from "../engine/state";
import { createInitialState, reduce } from "../engine/reducer";
import { decide } from "../engine/decide";
import type { Command } from "../engine/commands";
import type { Event } from "../engine/events";
import { hashUnit, hashInt } from "../engine/hash";
import { dateToAbsoluteMinutes, weekdayOfDate } from "../engine/time";
import { DomainError } from "../engine/errors";

const SYSTEM = { actorRole: "SYSTEM" as const, actorId: "autopilot" };
const RECEPTION = { actorRole: "RECEPTION" as const, actorId: "autopilot-desk" };
const DOCTOR = { actorRole: "DOCTOR" as const, actorId: "autopilot-doctor" };

export interface AutopilotResult {
  state: EngineState;
  events: Event[];
}

export function runAutopilotDay(seed: number, date: string): AutopilotResult {
  let state = createInitialState();
  const events: Event[] = [];

  function dispatch(command: Command, now: number): Event[] {
    let produced: Event[];
    try {
      produced = decide(command, state, now);
    } catch (err) {
      if (err instanceof DomainError) return []; // a best-effort simulated action that didn't apply
      throw err;
    }
    events.push(...produced);
    state = produced.reduce(reduce, state);
    return produced;
  }

  const weekday = weekdayOfDate(date);
  const dayStart = dateToAbsoluteMinutes(date, 8 * 60);
  const dayEnd = dateToAbsoluteMinutes(date, 18 * 60);

  const templates = Object.values(state.sessionTemplates).filter((t) => t.weekday === weekday);
  for (const template of templates) {
    dispatch({ type: "OpenSession", doctorId: template.doctorId, date, windowIndex: template.windowIndex, ...SYSTEM }, dateToAbsoluteMinutes(date, template.startMinutes));
  }

  // ---- advance bookings, made "the day before" ----
  interface ArrivalPlan {
    arrivalTime: number;
    willArrive: boolean;
  }
  const arrivalPlans = new Map<string, ArrivalPlan>(); // appointmentId -> plan

  const openSlots = Object.values(state.slots).filter((s) => s.state === "OPEN");
  for (const slot of openSlots) {
    if (hashUnit(seed, `book:${slot.id}`) >= 0.55) continue; // ~55% of open slots get pre-booked
    const name = `Patient ${slot.id}`;
    const phone = `seed${seed}-${slot.id}`;
    dispatch({ type: "RegisterPatient", name, phone, ...RECEPTION }, dayStart);
    const patient = Object.values(state.patients).find((p) => p.phone === phone);
    if (!patient) continue;
    const paymentStatus = hashUnit(seed, `prepay:${slot.id}`) < 0.4 ? "PREPAID" : "PAY_AT_CLINIC";
    dispatch(
      { type: "BookAppointment", patientId: patient.id, doctorId: slot.doctorId, slotId: slot.id, reason: "consultation", bookingSource: "PATIENT", paymentStatus, ...RECEPTION },
      dayStart,
    );
    const appt = Object.values(state.appointments).find((a) => a.slotId === slot.id);
    if (!appt) continue;
    const outcome = hashUnit(seed, `outcome:${appt.id}`);
    // ~70% show up (some early, some late), ~15% no-show, ~15% cancel ahead of time.
    if (outcome < 0.15) {
      dispatch({ type: "CancelAppointment", appointmentId: appt.id, ...RECEPTION }, dayStart + 1);
    } else if (outcome < 0.3) {
      arrivalPlans.set(appt.id, { arrivalTime: slot.time, willArrive: false }); // silently a no-show
    } else {
      const offset = hashInt(seed, `offset:${appt.id}`, -15, 20);
      arrivalPlans.set(appt.id, { arrivalTime: Math.max(dayStart, slot.time + offset), willArrive: true });
    }
  }

  // ---- minute-by-minute simulation ----
  interface ConsultPlan {
    doneAt: number;
    ordersInvestigation: boolean;
    orderedServiceId: string | null;
  }
  const consultPlans = new Map<string, ConsultPlan>(); // visitId -> plan
  const investigationDueAt = new Map<string, number>(); // investigationId -> resolve-at minute
  const services = Object.values(state.services);

  for (let now = dayStart; now <= dayEnd; now++) {
    // Auto-open any session whose start arrives mid-loop for a doctor not yet open (defensive;
    // all of today's sessions were already opened above, so this rarely fires).
    if (now % 5 === 0) {
      const todaysOpenDoctors = new Set(
        Object.values(state.sessions)
          .filter((s) => s.status === "OPEN" && s.date === date)
          .map((s) => s.doctorId),
      );
      for (const doctorId of todaysOpenDoctors) {
        dispatch({ type: "EvaluateCapacity", doctorId, trigger: "scheduled", ...SYSTEM }, now);
        dispatch({ type: "EvaluateOpdTimes", doctorId, ...SYSTEM }, now);
      }
    }

    for (const appt of Object.values(state.appointments)) {
      if (appt.status === "BOOKED" && now >= appt.slotTime + state.policy.noShowGraceMinutes) {
        dispatch({ type: "EvaluateNoShow", appointmentId: appt.id, ...SYSTEM }, now);
      }
    }

    if (now === dateToAbsoluteMinutes(date, 9 * 60)) {
      for (const appt of Object.values(state.appointments)) {
        if (appt.status === "BOOKED") dispatch({ type: "SendDueReminder", appointmentId: appt.id, ...SYSTEM }, now);
      }
    }

    // Booked patients arriving.
    for (const [appointmentId, plan] of arrivalPlans) {
      if (!plan.willArrive || plan.arrivalTime !== now) continue;
      const appt = state.appointments[appointmentId];
      if (!appt || appt.status !== "BOOKED") continue;
      dispatch({ type: "CheckInPatient", appointmentId, ...RECEPTION }, now);
    }

    // Walk-ins, at a rate derived from each doctor's seeded hourly history.
    const hour = Math.floor((((now % 1440) + 1440) % 1440) / 60);
    for (const doctorId of Object.keys(state.doctors)) {
      const rate = state.walkInRates.find((r) => r.doctorId === doctorId && r.hour === hour)?.ratePerHour ?? 0;
      if (rate <= 0) continue;
      if (hashUnit(seed, `walkin:${doctorId}:${now}`) >= rate / 60) continue;
      const phone = `walkin-${seed}-${doctorId}-${now}`;
      dispatch({ type: "RegisterPatient", name: `Walk-in ${phone}`, phone, ...RECEPTION }, now);
      const patient = Object.values(state.patients).find((p) => p.phone === phone);
      if (patient) dispatch({ type: "RegisterWalkIn", patientId: patient.id, doctorId, reason: "walk-in", ...RECEPTION }, now);
    }

    // Doctors: complete what's running, start what's next.
    for (const doctorId of Object.keys(state.doctors)) {
      const active = Object.values(state.queueEntries).find((q) => q.doctorId === doctorId && q.status === "IN_PROGRESS");
      if (active) {
        const plan = consultPlans.get(active.visitId);
        if (plan && plan.doneAt <= now) {
          if (active.queueType === "REVIEW") {
            dispatch({ type: "CompleteReview", visitId: active.visitId, ...DOCTOR }, now);
          } else {
            if (plan.ordersInvestigation && plan.orderedServiceId) {
              const before = Object.keys(state.investigations).length;
              dispatch({ type: "OrderInvestigation", visitId: active.visitId, serviceId: plan.orderedServiceId, ...DOCTOR }, now);
              const inv = Object.values(state.investigations).find((i) => i.visitId === active.visitId);
              const service = services.find((s) => s.id === plan.orderedServiceId);
              if (inv && service && Object.keys(state.investigations).length > before) {
                investigationDueAt.set(inv.id, now + service.turnaroundMinutes);
              }
            }
            dispatch({ type: "CompleteConsultation", visitId: active.visitId, ...DOCTOR }, now);
          }
          consultPlans.delete(active.visitId);
        }
      } else {
        const waiting = Object.values(state.queueEntries)
          .filter((q) => q.doctorId === doctorId && q.status === "WAITING")
          .sort((a, b) => a.enteredAt - b.enteredAt)[0];
        if (waiting) {
          if (waiting.queueType === "REVIEW") {
            const started = dispatch({ type: "StartReview", queueEntryId: waiting.id, ...DOCTOR }, now);
            if (started.length > 0) {
              const duration = hashInt(seed, `reviewdur:${waiting.id}`, 3, 8);
              consultPlans.set(waiting.visitId, { doneAt: now + duration, ordersInvestigation: false, orderedServiceId: null });
            }
          } else {
            const started = dispatch({ type: "StartConsultation", queueEntryId: waiting.id, ...DOCTOR }, now);
            if (started.length > 0) {
              const duration = hashInt(seed, `consultdur:${waiting.id}`, 8, 25);
              const ordersInvestigation = hashUnit(seed, `orders:${waiting.id}`) < 0.25;
              const orderedServiceId = ordersInvestigation ? services[hashInt(seed, `service:${waiting.id}`, 0, services.length - 1)].id : null;
              consultPlans.set(waiting.visitId, { doneAt: now + duration, ordersInvestigation, orderedServiceId });
            }
          }
        }
      }
    }

    // Investigation results coming back from the lab.
    for (const [investigationId, dueAt] of investigationDueAt) {
      if (dueAt !== now) continue;
      const inv = state.investigations[investigationId];
      if (!inv || inv.status !== "ORDERED") {
        investigationDueAt.delete(investigationId);
        continue;
      }
      const abnormal = hashUnit(seed, `flag:${investigationId}`) < 0.2;
      dispatch(
        { type: "RecordInvestigationResult", investigationId, resultSummary: abnormal ? "Out of range" : "Within normal limits", resultFlag: abnormal ? "ABNORMAL" : "NORMAL", ...DOCTOR },
        now,
      );
      investigationDueAt.delete(investigationId);
    }

    // A rare patient gives up and leaves the queue.
    for (const entry of Object.values(state.queueEntries)) {
      if (entry.status !== "WAITING") continue;
      if (hashUnit(seed, `giveup:${entry.id}:${now}`) < 0.0005) {
        dispatch({ type: "LeaveQueue", queueEntryId: entry.id, ...RECEPTION }, now);
      }
    }
  }

  return { state, events };
}
