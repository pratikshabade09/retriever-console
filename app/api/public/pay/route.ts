import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { dispatch, getState } from "@/lib/server/world";
import { handleRouteError, jsonError } from "@/lib/server/http";
import { findAppointmentByToken } from "@/lib/engine/projections";

const body = z.object({ tokenNumber: z.number() });

export async function POST(req: NextRequest) {
  try {
    const { tokenNumber } = body.parse(await req.json());
    const appt = findAppointmentByToken(getState(), tokenNumber);
    if (!appt) return jsonError("Appointment not found", 404);

    dispatch({ type: "MarkPrepaid", appointmentId: appt.id, actorRole: "PATIENT", actorId: "bot" });
    return NextResponse.json({ paymentStatus: "PREPAID" });
  } catch (err) {
    return handleRouteError(err);
  }
}
