// The signed-in patient's own updates. Scoped to their patientId, so a token number that
// repeats on another clinic day — or belongs to somebody else — can never surface here.
//
// The public /api/public/notifications/:tokenNumber route stays as the bot contract, where a
// token number is all the caller has; this is the logged-in patient's version of the same feed.

import { NextRequest, NextResponse } from "next/server";
import { getCurrentPatient } from "@/lib/server/patientSession";
import { getState } from "@/lib/server/world";
import { jsonError } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const patient = await getCurrentPatient();
  if (!patient) return jsonError("Not signed in", 401);

  const sinceParam = req.nextUrl.searchParams.get("since");
  const since = sinceParam ? Number(sinceParam) : 0;

  const notifications = getState()
    .notifications.filter((n) => n.patientId === patient.patientId && n.ts > since)
    .map((n) => ({
      ts: n.ts,
      kind: n.kind,
      message: n.message,
      // Which booking it belongs to: appointmentId for a booked appointment, visitId for a walk-in.
      appointmentId: n.appointmentId,
      visitId: n.visitId,
    }));

  return NextResponse.json({ notifications });
}
