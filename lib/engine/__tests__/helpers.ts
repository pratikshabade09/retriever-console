// Shared test scaffolding: dispatch() runs decide() then folds the result, exactly as
// lib/server's dispatcher will in stage 5 — but here, directly, with no I/O.

import { decide } from "../decide";
import { reduce, createInitialState } from "../reducer";
import type { Command } from "../commands";
import type { EngineState } from "../state";
import type { ActorRole } from "../types";
import type { Event } from "../events";

export { createInitialState };

// Omit distributed over the Command union (a plain Omit<Command, ...> would collapse the
// union to its common fields only, losing each variant's specific properties).
type TestCommand = { [K in Command["type"]]: Omit<Extract<Command, { type: K }>, "actorRole" | "actorId"> & { actorRole?: ActorRole; actorId?: string } }[Command["type"]];

export function dispatch(state: EngineState, command: TestCommand, now: number): { events: Event[]; state: EngineState } {
  const full = { actorRole: "SYSTEM" as ActorRole, actorId: "system", ...command } as Command;
  const events = decide(full, state, now);
  return { events, state: events.reduce(reduce, state) };
}

export const MONDAY = "2026-01-05";
export const TUESDAY = "2026-01-06";
