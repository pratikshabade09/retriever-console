// Materializes a doctor's session(s) for a date ahead of the scheduler reaching that day, so
// the public booking API can show and book slots days in advance. Uses the same OpenSession
// command decide() already handles — this only decides *when* to dispatch it.

import { weekdayOfDate } from "@/lib/engine/time";
import { dispatch, getState } from "./world";

export function ensureSessionOpen(doctorId: string, date: string): void {
  const weekday = weekdayOfDate(date);
  const state = getState();
  const templates = Object.values(state.sessionTemplates).filter((t) => t.doctorId === doctorId && t.weekday === weekday);
  for (const template of templates) {
    const exists = Object.values(getState().sessions).some((s) => s.templateId === template.id && s.date === date);
    if (exists) continue;
    dispatch({ type: "OpenSession", doctorId, date, windowIndex: template.windowIndex, actorRole: "SYSTEM", actorId: "booking-api" });
  }
}
