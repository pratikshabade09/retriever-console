import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { registerUser, createSession, AuthError } from "@/lib/server/authStore";
import { SESSION_COOKIE } from "@/lib/server/session";
import { sessionCookieOptions } from "@/lib/server/cookieOptions";
import { getState } from "@/lib/server/world";
import { jsonError } from "@/lib/server/http";

const body = z.object({
  name: z.string().min(1),
  email: z.string().min(1),
  password: z.string().min(1),
  role: z.enum(["RECEPTION", "DOCTOR", "ADMIN"]),
  doctorId: z.string().nullable().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const input = body.parse(await req.json());
    if (input.role === "DOCTOR" && (!input.doctorId || !getState().doctors[input.doctorId])) {
      return jsonError("Select a valid doctor for this account", 400);
    }
    const user = registerUser({ ...input, doctorId: input.role === "DOCTOR" ? (input.doctorId ?? null) : null });
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
