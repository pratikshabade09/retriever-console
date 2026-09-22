// The scheduler only emits commands — it never mutates state itself. Called once per
// simulated minute by the clock (world.ts), plus immediately after material events dispatch
// their own follow-up commands from within decide() (see withOpdRecompute in decide.ts).

import type { EngineState } from "@/lib/engine/state";
import type { Command } from "@/lib/engine/commands";
import { dayNumberToDate, weekdayFromDayNumber } from "@/lib/engine/time";

const SYSTEM = { actorRole: "SYSTEM" as const, actorId: "scheduler" };
const MORNING_REMINDER_MINUTE_OF_DAY = 9 * 60;

export function schedulerCommandsForTick(state: EngineState, now: number): Command[] {
  const commands: Command[] = [];
  const today = Math.floor(now / 1440);
  const todayDate = dayNumberToDate(today);
  const todayWeekday = weekdayFromDayNumber(today);
  const minuteOfDay = ((now % 1440) + 1440) % 1440;

  // Auto-open today's sessions as the clock reaches each one's start time. A session for a
  // future day can also be materialized early by the public booking API (see
  // lib/server/booking.ts) — this only covers the ordinary "today arrives" case.
  for (const template of Object.values(state.sessionTemplates)) {
    if (template.weekday !== todayWeekday) continue;
    if (minuteOfDay < template.startMinutes) continue;
    const alreadyOpen = Object.values(state.sessions).some((s) => s.templateId === template.id && s.date === todayDate);
    if (alreadyOpen) continue;
    commands.push({ type: "OpenSession", doctorId: template.doctorId, date: todayDate, windowIndex: template.windowIndex, ...SYSTEM });
  }

  // Capacity/OPD evaluation only ever applies to a doctor's *current* session — never one
  // materialized ahead of time for a future day's bookings.
  const todaysOpenDoctors = new Set(
    Object.values(state.sessions)
      .filter((s) => s.status === "OPEN" && Math.floor(s.startAt / 1440) === today)
      .map((s) => s.doctorId),
  );
  if (now % state.policy.evaluationIntervalMinutes === 0) {
    for (const doctorId of todaysOpenDoctors) {
      commands.push({ type: "EvaluateCapacity", doctorId, trigger: "scheduled", ...SYSTEM });
      commands.push({ type: "EvaluateOpdTimes", doctorId, ...SYSTEM });
    }
  }

  for (const appt of Object.values(state.appointments)) {
    if (appt.status === "BOOKED" && now >= appt.slotTime + state.policy.noShowGraceMinutes) {
      commands.push({ type: "EvaluateNoShow", appointmentId: appt.id, ...SYSTEM });
    }
  }

  if (minuteOfDay === MORNING_REMINDER_MINUTE_OF_DAY) {
    for (const appt of Object.values(state.appointments)) {
      if (appt.status === "BOOKED" && Math.floor(appt.slotTime / 1440) === today) {
        commands.push({ type: "SendDueReminder", appointmentId: appt.id, ...SYSTEM });
      }
    }
  }

  return commands;
}
