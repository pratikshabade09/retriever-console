"use client";

// Thin fetch wrappers. No domain logic — every mutation goes through /api/staff/command,
// which is the HTTP boundary in front of decide(). The server takes the actor from the session
// cookie, not from these payloads, so any actorRole/actorId a caller sends is ignored.

import type { EngineState } from "@/lib/engine/state";
import type { Event } from "@/lib/engine/events";

export interface ClockView {
  now: number;
}

export interface StateResponse {
  state: EngineState;
  clock: ClockView;
}

export async function fetchState(): Promise<StateResponse> {
  const res = await fetch("/api/staff/state", { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to load state");
  return res.json();
}

export async function fetchEvents(): Promise<Event[]> {
  const res = await fetch("/api/staff/events", { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to load events");
  return res.json();
}

export interface CommandResult {
  events?: unknown[];
  error?: string;
}

export async function sendCommand(command: Record<string, unknown>): Promise<CommandResult> {
  const res = await fetch("/api/staff/command", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(command),
  });
  return res.json();
}

export async function logout(): Promise<void> {
  await fetch("/api/auth/logout", { method: "POST" });
}
