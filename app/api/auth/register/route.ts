import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { registerUser, createSession, AuthError } from "@/lib/server/authStore";
import { SESSION_COOKIE } from "@/lib/server/session";
import { sessionCookieOptions } from "@/lib/server/cookieOptions";
import { jsonError } from "@/lib/server/http";

// Self-signup, for the two non-clinical staff roles. A DOCTOR account is not self-created: it
// has to be bound to a doctor the clinic actually has, so an admin adds it alongside the doctor
// itself (see app/api/staff/doctors/route.ts).
const body = z.object({
  name: z.string().min(1),
  email: z.string().min(1),
  password: z.string().min(1),
  role: z.enum(["RECEPTION", "ADMIN"]),
});

export async function POST(req: NextRequest) {
  try {
    const input = body.parse(await req.json());
    const user = registerUser({ ...input, doctorId: null });
    const token = createSession(user.id);
    const res = NextResponse.json({ user });
    res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
    return res;
  } catch (err) {
    if (err instanceof AuthError) return jsonError(err.message, 400);
    if (err instanceof z.ZodError) return jsonError(err.issues.map((i) => i.message).join("; "), 400);
    console.error(err);
    return jsonError("Internal error", 500);
  }
}
