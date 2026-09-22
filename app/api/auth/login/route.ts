import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifyLogin, createSession, AuthError } from "@/lib/server/authStore";
import { SESSION_COOKIE } from "@/lib/server/session";
import { sessionCookieOptions } from "@/lib/server/cookieOptions";
import { jsonError } from "@/lib/server/http";

const body = z.object({ email: z.string().min(1), password: z.string().min(1) });

export async function POST(req: NextRequest) {
  try {
    const input = body.parse(await req.json());
    const user = verifyLogin(input.email, input.password);
    const token = createSession(user.id);
    const res = NextResponse.json({ user });
    res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
    return res;
  } catch (err) {
    if (err instanceof AuthError) return jsonError(err.message, 401);
    if (err instanceof z.ZodError) return jsonError(err.issues.map((i) => i.message).join("; "), 400);
    console.error(err);
    return jsonError("Internal error", 500);
  }
}
