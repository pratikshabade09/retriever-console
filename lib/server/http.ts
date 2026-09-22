// Shared HTTP boundary helpers. Routes validate with zod, resolve the actor, dispatch — and
// never contain domain logic themselves.

import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { DomainError } from "@/lib/engine/errors";

export function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export function handleRouteError(err: unknown) {
  if (err instanceof DomainError) return jsonError(err.message, 400);
  if (err instanceof ZodError) return jsonError(err.issues.map((i) => i.message).join("; "), 400);
  console.error(err);
  return jsonError("Internal error", 500);
}
