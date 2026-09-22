import { NextRequest, NextResponse } from "next/server";
import { destroySession } from "@/lib/server/authStore";
import { SESSION_COOKIE } from "@/lib/server/session";
import { clearedCookieOptions } from "@/lib/server/cookieOptions";

export async function POST(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (token) destroySession(token);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", clearedCookieOptions());
  return res;
}
