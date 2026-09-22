import { NextRequest, NextResponse } from "next/server";
import { destroyPatientSession } from "@/lib/server/patientAuthStore";
import { PATIENT_SESSION_COOKIE } from "@/lib/server/patientSession";
import { clearedCookieOptions } from "@/lib/server/cookieOptions";

export async function POST(req: NextRequest) {
  const token = req.cookies.get(PATIENT_SESSION_COOKIE)?.value;
  if (token) destroyPatientSession(token);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(PATIENT_SESSION_COOKIE, "", clearedCookieOptions());
  return res;
}
