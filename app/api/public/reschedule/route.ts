import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { dispatch, getClock, getState } from "@/lib/server/world";
import { handleRouteError, jsonError } from "@/lib/server/http";
import { findAppointment } from "@/lib/engine/projections";
import { formatClockLabel } from "@/lib/engine/time";
import { likelyOpdTimeBeforeArrival } from "@/lib/engine/opd";

// tokenNumber keeps the documented public/bot contract working; appointmentId is what the
// logged-in patient UI sends, because a token number is only unique within a clinic day.
const body = z.object({
  tokenNumber: z.number().optional(),
  appointmentId: z.string().min(1).optional(),
  slotId: z.string().min(1),
});

export async function POST(req: NextRequest) {
  try {
    const input = body.parse(await req.json());
    const appt = findAppointment(getState(), input);
    if (!appt) return jsonError("Appointment not found", 404);

    dispatch({ type: "RescheduleAppointment", appointmentId: appt.id, newSlotId: input.slotId, actorRole: "PATIENT", actorId: "bot" });

    const state = getState();
    const updated = state.appointments[appt.id];
    const { now } = getClock();
    return NextResponse.json({
      tokenNumber: updated.tokenNumber,
      slotLabel: formatClockLabel(updated.slotTime),
      likelyOpdTime: formatClockLabel(likelyOpdTimeBeforeArrival(state, updated, now)),
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
