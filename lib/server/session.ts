// Reading the current staff session from the request cookie. Setting/clearing the cookie
// happens in the auth route handlers themselves (via NextResponse's cookie API); this module
// is the read side, used by server components to find out who's asking.

import { cookies } from "next/headers";
import { getUserBySession, type StaffUser } from "./authStore";

export const SESSION_COOKIE = "rc_session";

export async function getCurrentUser(): Promise<StaffUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return getUserBySession(token);
}
