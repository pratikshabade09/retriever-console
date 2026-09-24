// Pure calendar arithmetic — no Date object, no timezone ambiguity, fully deterministic.
// "Absolute minutes" = days-since-1970-01-01 * 1440 + minutes-from-midnight (clinic-local).

import type { Weekday } from "./types";

/** Howard Hinnant's days_from_civil algorithm: pure integer arithmetic, no Date object. */
export function daysFromCivil(y: number, m: number, d: number): number {
  const yy = y - (m <= 2 ? 1 : 0);
  const era = Math.floor((yy >= 0 ? yy : yy - 399) / 400);
  const yoe = yy - era * 400; // [0, 399]
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1; // [0, 365]
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy; // [0, 146096]
  return era * 146097 + doe - 719468;
}

export function dateToDayNumber(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return daysFromCivil(y, m, d);
}

/** Inverse of daysFromCivil — Howard Hinnant's civil_from_days, pure integer arithmetic. */
export function dayNumberToDate(day: number): string {
  const z = day + 719468;
  const era = Math.floor((z >= 0 ? z : z - 146096) / 146097);
  const doe = z - era * 146097; // [0, 146096]
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365); // [0, 399]
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100)); // [0, 365]
  const mp = Math.floor((5 * doy + 2) / 153); // [0, 11]
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1; // [1, 31]
  const m = mp + (mp < 10 ? 3 : -9); // [1, 12]
  const yy = y + (m <= 2 ? 1 : 0);
  return `${String(yy).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// 1970-01-01 (day 0) was a Thursday.
const WEEKDAY_BY_EPOCH_MOD: Weekday[] = ["THU", "FRI", "SAT", "SUN", "MON", "TUE", "WED"];

export function weekdayFromDayNumber(day: number): Weekday {
  const idx = ((day % 7) + 7) % 7;
  return WEEKDAY_BY_EPOCH_MOD[idx];
}

export function weekdayOfDate(dateStr: string): Weekday {
  return weekdayFromDayNumber(dateToDayNumber(dateStr));
}

export function dateToAbsoluteMinutes(dateStr: string, minutesFromMidnight: number): number {
  return dateToDayNumber(dateStr) * 1440 + minutesFromMidnight;
}

export function formatClockLabel(absoluteMinutes: number): string {
  const minutesOfDay = ((Math.round(absoluteMinutes) % 1440) + 1440) % 1440;
  const hour24 = Math.floor(minutesOfDay / 60);
  const minute = minutesOfDay % 60;
  const period = hour24 < 12 ? "AM" : "PM";
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${String(minute).padStart(2, "0")} ${period}`;
}

/** "09:00", the value an <input type="time"> reads and writes, as minutes from midnight — the
 * same minute-of-day convention a SessionTemplate stores. Null if it isn't a clock time. */
export function minutesFromClockInput(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** The inverse of minutesFromClockInput: minutes from midnight to the "HH:MM" an
 * <input type="time"> expects. The input itself renders that in the viewer's locale — 9:00 AM
 * in a 12-hour one — so the stored minutes stay a plain number while the field reads as a clock. */
export function clockInputValue(minutesOfDay: number): string {
  const wrapped = ((Math.round(minutesOfDay) % 1440) + 1440) % 1440;
  return `${String(Math.floor(wrapped / 60)).padStart(2, "0")}:${String(wrapped % 60).padStart(2, "0")}`;
}

const WEEKDAY_LABELS: Record<Weekday, string> = { SUN: "Sun", MON: "Mon", TUE: "Tue", WED: "Wed", THU: "Thu", FRI: "Fri", SAT: "Sat" };
const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Sat 19 Sep" — the day half of a timestamp, for anywhere a slot label alone is ambiguous
 * (two clinic days both have a 9:00 AM). Locale-free, like the rest of this module. */
export function formatDayLabel(absoluteMinutes: number): string {
  const day = Math.floor(absoluteMinutes / 1440);
  const [, month, date] = dayNumberToDate(day).split("-");
  return `${WEEKDAY_LABELS[weekdayFromDayNumber(day)]} ${Number(date)} ${MONTH_LABELS[Number(month) - 1]}`;
}
