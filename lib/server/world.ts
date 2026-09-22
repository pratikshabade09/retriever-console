// The live world: one in-memory EngineState (rebuilt from the event store at startup), running
// on real wall-clock time. This is the only place decide()'s result gets appended and folded —
// the one mutation path's server-side half. Cached on globalThis so Next's dev-mode module
// reloads don't spawn a second, out-of-sync world or a second scheduler interval.

import { createInitialState, reduce } from "@/lib/engine/reducer";
import type { EngineState } from "@/lib/engine/state";
import type { Command } from "@/lib/engine/commands";
import type { Event } from "@/lib/engine/events";
import { decide } from "@/lib/engine/decide";
import { dateToAbsoluteMinutes } from "@/lib/engine/time";
import { authorize } from "./authorize";
import { appendEvents, loadAllEvents, resetStore } from "./store";
import { schedulerCommandsForTick } from "./scheduler";

const SCHEDULER_INTERVAL_MS = 20_000;

interface World {
  state: EngineState;
  timer: ReturnType<typeof setInterval> | null;
}

function todayDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** The engine's "absolute minutes" are anchored to local calendar days (see time.ts), so real
 * time is converted the same way slot times are — never a raw epoch-minute count, which would
 * drift from local slot boundaries outside UTC. */
export function nowInAbsoluteMinutes(): number {
  const d = new Date();
  return dateToAbsoluteMinutes(todayDateString(d), d.getHours() * 60 + d.getMinutes());
}

function freshWorld(): World {
  const events = loadAllEvents();
  const state = events.reduce(reduce, createInitialState());
  return { state, timer: null };
}

declare global {
  var __retrieverConsoleWorld__: World | undefined;
}

function getWorld(): World {
  if (!globalThis.__retrieverConsoleWorld__) {
    globalThis.__retrieverConsoleWorld__ = freshWorld();
  }
  return globalThis.__retrieverConsoleWorld__;
}

export function getState(): EngineState {
  return getWorld().state;
}

/** Kept as `{ now }` (not a bare number) so callers read the same shape the UI always has —
 * it's just derived fresh from the real clock now instead of from stored simulated state. */
export function getClock(): { now: number } {
  return { now: nowInAbsoluteMinutes() };
}

export function dispatch(command: Command): Event[] {
  const world = getWorld();
  authorize(command);
  const events = decide(command, world.state, nowInAbsoluteMinutes());
  if (events.length > 0) {
    appendEvents(events);
    world.state = events.reduce(reduce, world.state);
  }
  return events;
}

/** Runs whatever the scheduler wants to do at this real moment — never mutates state
 * directly, only ever dispatches ordinary commands, exactly like any other caller. */
function tick(): void {
  const world = getWorld();
  const now = nowInAbsoluteMinutes();
  const commands = schedulerCommandsForTick(world.state, now);
  for (const command of commands) {
    try {
      dispatch(command);
    } catch {
      // Scheduler-issued commands are best-effort re-evaluations; a stale one (e.g. a session
      // that closed between being listed and being evaluated) should not crash the scheduler.
    }
  }
}

function ensureSchedulerRunning(): void {
  const world = getWorld();
  if (world.timer) return;
  tick();
  world.timer = setInterval(tick, SCHEDULER_INTERVAL_MS);
}

// The scheduler starts as soon as the server process loads this module — a live system has no
// "play" button, it's just running. Except during `next build`: Next imports every route
// module to collect its metadata, which would otherwise open/create the SQLite file (and
// start a real interval) at build time, on whatever machine happens to be running the build.
if (process.env.NEXT_PHASE !== "phase-production-build") {
  ensureSchedulerRunning();
}

/** Dev/test only — never wired to a route. Wipes the log and rebuilds an empty world. */
export function resetWorld(): void {
  resetStore();
  globalThis.__retrieverConsoleWorld__ = freshWorld();
  ensureSchedulerRunning();
}
