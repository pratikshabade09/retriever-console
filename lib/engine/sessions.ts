// Shared "which of this doctor's open sessions is the relevant one right now" lookup, used by
// both decide.ts (capacity commands) and opd.ts (running-delay lookup). A doctor can have more
// than one OPEN session at once — Dr. Khan's AM/PM windows, or a future day materialized early
// so patients can book ahead — so this always prefers a session whose own day is "today"
// (relative to `now`), and among those the one actually covering `now`.

import type { DoctorSession } from "./types";
import type { EngineState } from "./state";

export function findRelevantOpenSession(state: EngineState, doctorId: string, now: number): DoctorSession | undefined {
  const sessions = Object.values(state.sessions).filter((s) => s.doctorId === doctorId && s.status === "OPEN");
  if (sessions.length === 0) return undefined;

  const today = Math.floor(now / 1440);
  const todays = sessions.filter((s) => Math.floor(s.startAt / 1440) === today);
  const pool = todays.length > 0 ? todays : sessions;

  const current = pool.find((s) => now >= s.startAt && now <= s.endAt);
  if (current) return current;
  return pool.reduce((closest, s) => (Math.abs(s.startAt - now) < Math.abs(closest.startAt - now) ? s : closest));
}
