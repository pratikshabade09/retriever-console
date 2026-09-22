import { NextResponse } from "next/server";
import { getCurrentPatient } from "@/lib/server/patientSession";
import { getClock, getState } from "@/lib/server/world";
import { appointmentsForPatient } from "@/lib/engine/projections";
import { jsonError } from "@/lib/server/http";

export async function GET() {
  const patient = await getCurrentPatient();
  if (!patient) return jsonError("Not signed in", 401);
  const views = appointmentsForPatient(getState(), patient.patientId, getClock().now);
  const appointments = views.map((v) => ({
    tokenNumber: v.tokenNumber,
    status: v.status,
    doctorName: v.doctorName,
    slotLabel: v.slotLabel,
    likelyOpdTime: v.likelyOpdTimeLabel,
    patientsAhead: v.patientsAhead,
    paymentStatus: v.paymentStatus,
  }));
  return NextResponse.json({ appointments });
}
