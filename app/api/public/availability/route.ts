import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getClock, getState } from "@/lib/server/world";
import { ensureSessionOpen } from "@/lib/server/booking";
import { availabilityForDoctorDate } from "@/lib/engine/projections";
import { handleRouteError } from "@/lib/server/http";

const query = z.object({
  doctorId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
});

export async function GET(req: NextRequest) {
  try {
    const { doctorId, date } = query.parse(Object.fromEntries(req.nextUrl.searchParams));
    ensureSessionOpen(doctorId, date);
    const slots = availabilityForDoctorDate(getState(), doctorId, date, getClock().now);
    return NextResponse.json({ date, slots });
  } catch (err) {
    return handleRouteError(err);
  }
}
