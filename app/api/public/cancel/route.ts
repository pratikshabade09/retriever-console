import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { dispatch, getState } from "@/lib/server/world";
import { handleRouteError, jsonError } from "@/lib/server/http";
import { findAppointment } from "@/lib/engine/projections";

// tokenNumber keeps the documented public/bot contract working; appointmentId is what the
// logged-in patient UI sends, because a token number is only unique within a clinic day.
const body = z.object({ tokenNumber: z.number().optional(), appointmentId: z.string().min(1).optional() });

export async function POST(req: NextRequest) {
  try {
    const input = body.parse(await req.json());
    const appt = findAppointment(getState(), input);
    if (!appt) return jsonError("Appointment not found", 404);

    dispatch({ type: "CancelAppointment", appointmentId: appt.id, actorRole: "PATIENT", actorId: "bot" });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleRouteError(err);
  }
}
