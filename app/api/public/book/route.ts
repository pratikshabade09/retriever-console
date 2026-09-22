import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { dispatch, getClock, getState } from "@/lib/server/world";
import { handleRouteError } from "@/lib/server/http";
import { formatClockLabel } from "@/lib/engine/time";
import { currentFee } from "@/lib/engine/money";
import { likelyOpdTimeBeforeArrival } from "@/lib/engine/opd";

const body = z.object({
  doctorId: z.string().min(1),
  slotId: z.string().min(1),
  name: z.string().min(1),
  phone: z.string().min(1),
  reason: z.string().min(1),
});

export async function POST(req: NextRequest) {
  try {
    const input = body.parse(await req.json());
    let state = getState();
    let patient = Object.values(state.patients).find((p) => p.phone === input.phone);
    if (!patient) {
      dispatch({ type: "RegisterPatient", name: input.name, phone: input.phone, actorRole: "PATIENT", actorId: "bot" });
      state = getState();
      patient = Object.values(state.patients).find((p) => p.phone === input.phone)!;
    }

    dispatch({
      type: "BookAppointment",
      patientId: patient.id,
      doctorId: input.doctorId,
      slotId: input.slotId,
      reason: input.reason,
      bookingSource: "PATIENT",
      paymentStatus: "PAY_AT_CLINIC",
      actorRole: "PATIENT",
      actorId: "bot",
    });

    state = getState();
    const appt = Object.values(state.appointments).find((a) => a.patientId === patient!.id && a.slotId === input.slotId)!;
    const doctor = state.doctors[input.doctorId];
    const { now } = getClock();

    return NextResponse.json({
      tokenNumber: appt.tokenNumber,
      appointmentId: appt.id,
      doctorName: doctor.name,
      slotLabel: formatClockLabel(appt.slotTime),
      likelyOpdTime: formatClockLabel(likelyOpdTimeBeforeArrival(state, appt, now)),
      consultationFee: currentFee(state, input.doctorId, now),
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
