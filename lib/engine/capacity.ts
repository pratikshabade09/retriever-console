// The capacity policy: forecasting near-term walk-in demand and deciding whether to release
// protected slots, reclaim released ones, or hold. Pure function of (state, doctorId, now).

import type { DoctorSession, Slot, WalkInRatePoint } from "./types";
import type { EngineState } from "./state";

export interface ForecastResult {
  expectedCount: number;
  ratePerHour: number;
  remainingMinutes: number;
  basis: "history" | "baseline";
}

/** Walks `now` to `min(sessionEnd, now + horizon)` hour band by hour band, summing
 * hourlyRate x fractionOfThatHourInWindow. Never a single whole-day average. */
export function forecastWalkIns(params: {
  doctorId: string;
  now: number;
  sessionEnd: number;
  walkInRates: WalkInRatePoint[];
  horizonMinutes: number;
  baselineRatePerHour: number;
}): ForecastResult {
  const { doctorId, now, sessionEnd, walkInRates, horizonMinutes, baselineRatePerHour } = params;
  const end = Math.min(sessionEnd, now + horizonMinutes);
  if (end <= now) {
    return { expectedCount: 0, ratePerHour: 0, remainingMinutes: 0, basis: "baseline" };
  }

  const rateByHour = new Map(
    walkInRates.filter((r) => r.doctorId === doctorId).map((r) => [r.hour, r.ratePerHour]),
  );

  let expectedCount = 0;
  let usedHistory = false;
  let cursor = now;
  while (cursor < end) {
    const hourOfDay = Math.floor((((cursor % 1440) + 1440) % 1440) / 60);
    const nextHourBoundary = Math.floor(cursor / 60) * 60 + 60;
    const segmentEnd = Math.min(end, nextHourBoundary);
    const minutesInSegment = segmentEnd - cursor;
    const hasHistory = rateByHour.has(hourOfDay);
    const rate = hasHistory ? rateByHour.get(hourOfDay)! : baselineRatePerHour;
    if (hasHistory) usedHistory = true;
    expectedCount += rate * (minutesInSegment / 60);
    cursor = segmentEnd;
  }

  const remainingMinutes = end - now;
  const ratePerHour = remainingMinutes > 0 ? expectedCount / (remainingMinutes / 60) : 0;
  return { expectedCount, ratePerHour, remainingMinutes, basis: usedHistory ? "history" : "baseline" };
}

function describeForecast(forecast: ForecastResult, required: number, margin: number, protectedAvailable: number): string {
  return `forecast ${forecast.expectedCount.toFixed(2)} walk-ins over ${forecast.remainingMinutes} min (${forecast.basis}) needs ${required} + margin ${margin}; ${protectedAvailable} protected`;
}

/** Slots for a doctor, restricted to one session (capacity is evaluated per session — see
 * CLAUDE.md), with time >= now. */
function futureSlotsInSession(state: EngineState, session: DoctorSession, now: number, slotState: "PROTECTED" | "RELEASED"): Slot[] {
  return Object.values(state.slots).filter(
    (s) => s.sessionId === session.id && s.state === slotState && s.time >= now,
  );
}

function lastChangeTs(state: EngineState, doctorId: string): number {
  let last = -Infinity;
  for (const row of state.capacityLedger) {
    if (row.doctorId === doctorId && (row.action === "RELEASE" || row.action === "RECLAIM")) {
      if (row.ts > last) last = row.ts;
    }
  }
  return last;
}

export type CapacityDecision =
  | { kind: "RELEASE"; slotIds: string[]; protectedBefore: number; protectedAfter: number; reason: string; cause: string }
  | { kind: "RECLAIM"; slotIds: string[]; protectedBefore: number; protectedAfter: number; reason: string; cause: string }
  | { kind: "HOLD"; protectedAvailable: number; reason: string; cause: string }
  | { kind: "NONE" };

/** The section-6 algorithm, exactly. Returns what the policy wants to do; the caller
 * (decide.ts) turns that into events and applies the ledger's noise-suppression rule. */
export function decideCapacity(state: EngineState, session: DoctorSession, now: number): CapacityDecision {
  const policy = state.policy;
  const protectedAvailable = futureSlotsInSession(state, session, now, "PROTECTED").sort((a, b) => a.time - b.time);
  const releasable = futureSlotsInSession(state, session, now, "RELEASED").sort((a, b) => a.time - b.time);

  const forecast = forecastWalkIns({
    doctorId: session.doctorId,
    now,
    sessionEnd: session.endAt,
    walkInRates: state.walkInRates,
    horizonMinutes: policy.protectionHorizonMinutes,
    baselineRatePerHour: policy.baselineWalkinRatePerHour,
  });
  const required = Math.ceil(forecast.expectedCount);
  const cooldownRemaining = Math.max(0, policy.cooldownMinutes - (now - lastChangeTs(state, session.doctorId)));

  const surplus = protectedAvailable.length - (required + policy.releaseMargin);
  if (surplus >= 1) {
    const floorRoom = protectedAvailable.length - session.minProtected;
    const count = Math.min(surplus, floorRoom);
    const base = describeForecast(forecast, required, policy.releaseMargin, protectedAvailable.length);
    if (count < 1) {
      return { kind: "HOLD", protectedAvailable: protectedAvailable.length, reason: `[floor] ${base}`, cause: "floor" };
    }
    if (cooldownRemaining > 0) {
      return {
        kind: "HOLD",
        protectedAvailable: protectedAvailable.length,
        reason: `[cooldown_release] ${base}; ${cooldownRemaining} min of cooldown remaining`,
        cause: "cooldown_release",
      };
    }
    // Near-term protection is what an unexpected walk-in actually needs, so release the
    // slots closest to the end of the session first, keeping earlier reserve intact longest.
    const toRelease = protectedAvailable.slice(-count).map((s) => s.id);
    return {
      kind: "RELEASE",
      slotIds: toRelease,
      protectedBefore: protectedAvailable.length,
      protectedAfter: protectedAvailable.length - count,
      reason: `${base}; releasing ${count}`,
      cause: "release",
    };
  }

  const deficit = required + policy.reclaimMargin - protectedAvailable.length;
  if (deficit >= 1) {
    const base = describeForecast(forecast, required, policy.reclaimMargin, protectedAvailable.length);
    if (releasable.length === 0) {
      return { kind: "HOLD", protectedAvailable: protectedAvailable.length, reason: `[nothing_reclaimable] ${base}`, cause: "nothing_reclaimable" };
    }
    if (cooldownRemaining > 0) {
      return {
        kind: "HOLD",
        protectedAvailable: protectedAvailable.length,
        reason: `[cooldown_reclaim] ${base}; ${cooldownRemaining} min of cooldown remaining`,
        cause: "cooldown_reclaim",
      };
    }
    const count = Math.min(deficit, releasable.length);
    const toReclaim = releasable.slice(0, count).map((s) => s.id);
    return {
      kind: "RECLAIM",
      slotIds: toReclaim,
      protectedBefore: protectedAvailable.length,
      protectedAfter: protectedAvailable.length + count,
      reason: `${base}; reclaiming ${count}`,
      cause: "reclaim",
    };
  }

  const base = describeForecast(forecast, required, policy.releaseMargin, protectedAvailable.length);
  return { kind: "HOLD", protectedAvailable: protectedAvailable.length, reason: `[balanced] ${base}`, cause: "balanced" };
}

/** Whether the previous ledger row for this doctor was already a HOLD for the identical
 * cause — writing another one would just be noise. */
export function isRedundantHold(state: EngineState, doctorId: string, cause: string): boolean {
  const rows = state.capacityLedger.filter((r) => r.doctorId === doctorId);
  const last = rows[rows.length - 1];
  if (!last || last.action !== "HOLD") return false;
  return last.reason.startsWith(`[${cause}]`);
}
