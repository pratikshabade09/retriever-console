import { NextRequest, NextResponse } from "next/server";
import { getClock, getState } from "@/lib/server/world";
import { jsonError } from "@/lib/server/http";
import { appointmentViewByToken } from "@/lib/engine/projections";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ tokenNumber: string }> }) {
  const { tokenNumber: tokenParam } = await ctx.params;
  const tokenNumber = Number(tokenParam);
  if (!Number.isFinite(tokenNumber)) return jsonError("tokenNumber must be a number", 400);

  const { now } = getClock();
  const view = appointmentViewByToken(getState(), tokenNumber, now);
  if (!view) return jsonError("Appointment not found", 404);

  return NextResponse.json({
    status: view.status,
    doctorName: view.doctorName,
    slotLabel: view.slotLabel,
    likelyOpdTime: view.likelyOpdTimeLabel,
    patientsAhead: view.patientsAhead,
    paymentStatus: view.paymentStatus,
  });
}
