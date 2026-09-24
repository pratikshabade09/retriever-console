// Adding a doctor, admin-only. Two things have to happen together:
//
//   1. the doctor record itself — a DoctorRegistered event through the ordinary command path
//      (which also gives them a default week of sessions, or they'd have no bookable slots);
//   2. their staff account, bound to the doctor id the first step minted.
//
// Step 2 is infrastructure, not a clinic event (who can log in isn't clinical state — see
// authStore.ts), so it doesn't go through decide(). The email is checked first so a duplicate
// can't leave a doctor stranded with no way to sign in.
//
// Note this is deliberately NOT the generic /api/staff/command route: creating a login is
// outside that route's contract, and this one needs a role it can trust.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { dispatch } from "@/lib/server/world";
import { getCurrentUser } from "@/lib/server/session";
import { AuthError, isEmailTaken, registerUser } from "@/lib/server/authStore";
import { handleRouteError, jsonError } from "@/lib/server/http";
import { DomainError } from "@/lib/engine/errors";

const body = z.object({
  name: z.string().min(1),
  specialty: z.string().min(1),
  room: z.string().min(1),
  consultationFee: z.number().int().nonnegative(),
  email: z.string().min(1),
  password: z.string().min(8),
});

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return jsonError("Not signed in", 401);
    if (user.role !== "ADMIN") return jsonError("Only an admin can add a doctor", 403);

    const input = body.parse(await req.json());
    if (isEmailTaken(input.email)) return jsonError("An account with that email already exists", 400);

    const events = dispatch({
      type: "RegisterDoctor",
      name: input.name,
      specialty: input.specialty,
      room: input.room,
      consultationFee: input.consultationFee,
      actorRole: "ADMIN",
      actorId: user.id,
    });
    const registered = events.find((e) => e.type === "DoctorRegistered");
    if (!registered || registered.type !== "DoctorRegistered") return jsonError("Could not register the doctor", 500);

    try {
      const account = registerUser({
        name: registered.name,
        email: input.email,
        password: input.password,
        role: "DOCTOR",
        doctorId: registered.doctorId,
      });
      return NextResponse.json({ doctorId: registered.doctorId, user: account });
    } catch (err) {
      // The doctor is on the board but has no login — say so plainly rather than pretending
      // the whole thing failed.
      if (err instanceof AuthError) return jsonError(`Doctor added, but their login could not be created: ${err.message}`, 400);
      throw err;
    }
  } catch (err) {
    if (err instanceof DomainError) return jsonError(err.message, 400);
    return handleRouteError(err);
  }
}
