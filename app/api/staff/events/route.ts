import { NextResponse } from "next/server";
import { loadAllEvents } from "@/lib/server/store";

// The raw event log — used by the Admin surface's proof panel (walking CapacityReclaimed
// events directly, not the folded state) and its "rebuild now" replay check.
export async function GET() {
  return NextResponse.json(loadAllEvents());
}
