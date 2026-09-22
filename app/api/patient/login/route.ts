import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifyPatientLogin, createPatientSession, PatientAuthError } from "@/lib/server/patientAuthStore";
import { PATIENT_SESSION_COOKIE } from "@/lib/server/patientSession";
import { sessionCookieOptions } from "@/lib/server/cookieOptions";
import { jsonError } from "@/lib/server/http";

const body = z.object({ email: z.string().min(1), password: z.string().min(1) });

export async function POST(req: NextRequest) {
  try {
    const input = body.parse(await req.json());
    const account = verifyPatientLogin(input.email, input.password);
    const token = createPatientSession(account.id);
    const res = NextResponse.json({ patient: account });
    res.cookies.set(PATIENT_SESSION_COOKIE, token, sessionCookieOptions());
    return res;
  } catch (err) {
    if (err instanceof PatientAuthError) return jsonError(err.message, 401);
    if (err instanceof z.ZodError) return jsonError(err.issues.map((i) => i.message).join("; "), 400);
    console.error(err);
    return jsonError("Internal error", 500);
  }
}
