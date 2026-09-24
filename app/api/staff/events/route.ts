import { NextResponse } from "next/server";
import { loadAllEvents } from "@/lib/server/store";
import { getCurrentUser } from "@/lib/server/session";
import { jsonError } from "@/lib/server/http";

// The raw event log — used by the Admin surface's proof panel (walking CapacityReclaimed
// events directly, not the folded state) and its "rebuild now" replay check.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return jsonError("Not signed in", 401);
  return NextResponse.json(loadAllEvents());
}
