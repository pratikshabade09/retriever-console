import { NextResponse } from "next/server";
import { getClock, getState } from "@/lib/server/world";
import { getCurrentUser } from "@/lib/server/session";
import { jsonError } from "@/lib/server/http";

// The whole engine state plus the clock, as JSON. A demo clinic's state is small — every
// staff surface polls this and derives its own view client-side rather than needing a
// specialized read endpoint per screen.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return jsonError("Not signed in", 401);
  return NextResponse.json({ state: getState(), clock: getClock() });
}
